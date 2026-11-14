import { BusinessException } from '../common/exceptions/business.exception.js';
import { Prisma } from '../generated/prisma/client.js';
import type { OrganizationContext } from '../modules/authorization/organization-context.js';

const definitionTables = [
  'farms',
  'customers',
  'sales_products',
  'poultry_product_sources',
  'inventory_items',
] as const;
type DefinitionTable = (typeof definitionTables)[number];
type DefinitionLock = { id: string; mode?: 'SHARE' | 'UPDATE' };
type Position = { farmId: string; inventoryItemId: string };
type FlockPosition = { farmId: string; flockId: string };

/** Server-only complete lock plan, never an authorization claim or stock state. */
export interface MutationLockPlan {
  parent?: 'KEY SHARE' | 'UPDATE';
  command?: { farmId: string; operation: 'POST' | 'REVERSE'; key: string };
  orderId?: string;
  definitions?: Partial<Record<DefinitionTable, readonly DefinitionLock[]>>;
  flocks?: readonly FlockPosition[];
  stock?: readonly Position[];
}

const canonical = (id: string) => id.toLowerCase();
const stockKey = (p: Position) =>
  `${canonical(p.farmId)}:${canonical(p.inventoryItemId)}`;
const flockKey = (p: FlockPosition) =>
  `${canonical(p.farmId)}:${canonical(p.flockId)}`;

function normalize(organizationId: string, plan: MutationLockPlan) {
  const definitions = new Map<string, 'SHARE' | 'UPDATE'>();
  for (const table of definitionTables) {
    for (const lock of plan.definitions?.[table] ?? []) {
      const key = `${table}:${canonical(lock.id)}`;
      if (!definitions.has(key) || lock.mode === 'UPDATE')
        definitions.set(key, lock.mode ?? 'SHARE');
    }
  }
  // Cover farm lifecycle checks and implicit farm FKs before any flock/stock lock.
  for (const p of [...(plan.flocks ?? []), ...(plan.stock ?? [])]) {
    const key = `farms:${canonical(p.farmId)}`;
    if (!definitions.has(key)) definitions.set(key, 'SHARE');
  }
  return {
    organizationId: canonical(organizationId),
    parent: plan.parent ?? 'KEY SHARE',
    command: plan.command
      ? `${canonical(plan.command.farmId)}:${plan.command.operation}:${canonical(plan.command.key)}`
      : undefined,
    orderId: plan.orderId ? canonical(plan.orderId) : undefined,
    definitions,
    flocks: new Set((plan.flocks ?? []).map(flockKey)),
    stock: new Set((plan.stock ?? []).map(stockKey)),
  };
}
type HeldLocks = ReturnType<typeof normalize>;
// Transaction identity prevents a caller from manufacturing a prepared-lock token.
const prepared = new WeakMap<
  Prisma.TransactionClient,
  { locks: HeldLocks; ready: Promise<void> }
>();

function covers(held: HeldLocks, next: HeldLocks) {
  return (
    held.organizationId === next.organizationId &&
    (held.parent === 'UPDATE' || next.parent === 'KEY SHARE') &&
    (!next.command || next.command === held.command) &&
    (!next.orderId || next.orderId === held.orderId) &&
    [...next.definitions].every(
      ([key, mode]) =>
        held.definitions.has(key) &&
        (mode === 'SHARE' || held.definitions.get(key) === 'UPDATE'),
    ) &&
    [...next.flocks].every((key) => held.flocks.has(key)) &&
    [...next.stock].every((key) => held.stock.has(key))
  );
}

/** ADR stages 0-5, acquired once, in full, before stage 6 effects. Helpers may
 * reuse a subset; extending a plan after acquisition is rejected, never upgraded.
 * Caller owns the READ COMMITTED transaction and must propagate any failure.
 */
export async function lockMutation(
  tx: Prisma.TransactionClient,
  context: OrganizationContext,
  plan: MutationLockPlan,
): Promise<void> {
  const locks = normalize(context.organizationId, plan);
  const held = prepared.get(tx);
  if (held) {
    if (!covers(held.locks, locks))
      throw new BusinessException(
        'MUTATION_LOCK_PLAN_INCOMPLETE',
        'Mutation lock plan must be prepared before posting',
        500,
      );
    await held.ready;
    return;
  }
  // Register before yielding so overlapping helper calls cannot independently
  // interleave two different plans on the same transaction connection.
  const ready = acquireLocks(tx, locks);
  prepared.set(tx, { locks, ready });
  await ready;
}

async function acquireLocks(tx: Prisma.TransactionClient, locks: HeldLocks) {
  await tx.$queryRaw(
    Prisma.sql`SELECT "id" FROM "organizations" WHERE "id" = ${locks.organizationId}::uuid FOR ${Prisma.raw(locks.parent)}`,
  );
  if (locks.command) {
    await tx.$executeRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${locks.organizationId}), hashtext(${`fulfilment:${locks.command}`}))`,
    );
  }
  if (locks.orderId) {
    await tx.$queryRaw(
      Prisma.sql`SELECT "id" FROM "orders" WHERE "organizationId" = ${locks.organizationId}::uuid AND "id" = ${locks.orderId}::uuid FOR UPDATE`,
    );
  }
  for (const table of definitionTables) {
    const keys = [...locks.definitions.keys()]
      .filter((key) => key.startsWith(`${table}:`))
      .sort();
    for (const key of keys) {
      const id = key.slice(table.length + 1);
      await tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM ${Prisma.raw(`"${table}"`)} WHERE "organizationId" = ${locks.organizationId}::uuid AND "id" = ${id}::uuid FOR ${Prisma.raw(locks.definitions.get(key)!)}`,
      );
    }
  }
  for (const key of [...locks.flocks].sort()) {
    const [farmId, flockId] = key.split(':');
    await tx.$executeRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${locks.organizationId}), hashtext(${`flock:${key}`}))`,
    );
    await tx.$queryRaw(
      Prisma.sql`SELECT "id" FROM "flocks" WHERE "organizationId" = ${locks.organizationId}::uuid AND "farmId" = ${farmId}::uuid AND "id" = ${flockId}::uuid FOR UPDATE`,
    );
  }
  for (const key of [...locks.stock].sort()) {
    // Preserve the existing M3 stock advisory namespace exactly.
    await tx.$executeRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${locks.organizationId}), hashtext(${key}))`,
    );
  }
}
