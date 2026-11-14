import { randomUUID } from 'node:crypto';
import { temporaryDatabase } from '../test/temporary-database.js';
import { Prisma } from '../generated/prisma/client.js';
import { lockMutation, type MutationLockPlan } from './mutation-locks.js';
import { OrganizationContext } from '../modules/authorization/organization-context.js';
import { AuthorizationService } from '../modules/authorization/authorization.service.js';
import { FarmAccessService } from '../modules/authorization/farm-access.service.js';
import { InventoryStockService } from '../modules/inventory/inventory-stock.service.js';
import { InventoryItemsService } from '../modules/inventory/inventory-items.service.js';
import { FeedUsageService } from '../modules/poultry/feed-usage.service.js';
import { lockFlockMutation } from '../modules/poultry/flock-mutation-lock.js';

function barrier<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('Canonical mutation locks (PostgreSQL)', () => {
  let database: Awaited<ReturnType<typeof temporaryDatabase>>;
  let prisma: Awaited<ReturnType<typeof temporaryDatabase>>['prisma'];
  let stock: InventoryStockService;
  let items: InventoryItemsService;
  let feed: FeedUsageService;
  let context: OrganizationContext;
  let farmId: string, flockId: string, itemId: string, produceId: string;
  const occurredAt = new Date('2026-11-13T12:00:00Z');
  const position = (id = itemId) => ({ farmId, inventoryItemId: id });
  const movement = (id = itemId, quantity = '10') => ({
    ...position(id),
    expectedInventoryUnit: 'KG' as const,
    quantity: new Prisma.Decimal(quantity),
    reason: (quantity.startsWith('-') ? 'ISSUE' : 'RECEIPT') as
      'ISSUE' | 'RECEIPT',
    occurredAt,
  });
  const feedInput = () => ({
    flockId,
    inventoryItemId: itemId,
    expectedInventoryUnit: 'KG' as const,
    quantity: new Prisma.Decimal(1),
    occurredAt,
  });

  beforeAll(async () => {
    database = await temporaryDatabase();
    prisma = database.prisma;
    stock = new InventoryStockService(prisma);
    items = new InventoryItemsService(prisma);
    feed = new FeedUsageService(
      prisma,
      stock,
      new FarmAccessService(prisma, new AuthorizationService()),
    );
  }, 60_000);
  afterAll(async () => {
    await database?.dispose();
  });
  beforeEach(async () => {
    const org = await prisma.organization.create({
      data: { name: 'Locks', slug: randomUUID() },
    });
    const user = await prisma.user.create({
      data: { email: `${randomUUID()}@example.com`, passwordHash: 'unused' },
    });
    const membership = await prisma.organizationMembership.create({
      data: { organizationId: org.id, userId: user.id, role: 'ADMIN' },
    });
    context = new OrganizationContext(org.id, membership.id, user.id, 'ADMIN');
    const farm = await prisma.farm.create({
      data: { organizationId: org.id, code: 'NORTH', name: 'North' },
    });
    farmId = farm.id;
    const flock = await prisma.flock.create({
      data: {
        organizationId: org.id,
        farmId,
        code: 'FLK-1',
        name: 'Birds',
        startingBirdCount: 100,
        placementDate: occurredAt,
      },
    });
    flockId = flock.id;
    // Deterministic source ordering makes the three-party schedule observable.
    const suffix = randomUUID().slice(9);
    itemId = `00000001-${suffix}`;
    produceId = `00000002-${suffix}`;
    await prisma.inventoryItem.createMany({
      data: [
        {
          id: itemId,
          organizationId: org.id,
          code: 'INV-1',
          name: 'Feed',
          unit: 'KG',
          category: 'FEED',
        },
        {
          id: produceId,
          organizationId: org.id,
          code: 'INV-2',
          name: 'Produce',
          unit: 'KG',
          category: 'PRODUCE',
        },
      ],
    });
  });

  async function hold(
    plan: MutationLockPlan,
    work?: (tx: Prisma.TransactionClient) => Promise<unknown>,
  ) {
    const acquired = barrier<number>(),
      release = barrier();
    const done = prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET LOCAL lock_timeout = '8s'`;
        await lockMutation(tx, context, plan);
        if (work) await work(tx);
        const [row] = await tx.$queryRaw<
          { pid: number }[]
        >`SELECT pg_backend_pid() AS pid`;
        acquired.resolve(row!.pid);
        await release.promise;
      },
      { timeout: 15_000 },
    );
    void done.catch(() => {});
    return {
      pid: await acquired.promise,
      release: () => release.resolve(),
      done,
    };
  }
  async function blockedBy(pid: number, waitingPid?: number) {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const rows = await prisma.$queryRaw<{ waiting: boolean }[]>`
        SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE ${pid} = ANY(pg_blocking_pids(pid))
          AND (${waitingPid ?? null}::int IS NULL OR pid = ${waitingPid ?? null}::int)) AS waiting`;
      if (rows[0]!.waiting) return;
    }
    throw new Error(
      'Expected independently running transaction to wait on the held lock',
    );
  }
  async function ordered<T>(
    plan: MutationLockPlan,
    work: (tx: Prisma.TransactionClient) => Promise<unknown>,
    start: () => Promise<T>,
  ) {
    const holder = await hold(plan, work);
    const pending = start();
    void pending.catch(() => {});
    try {
      await blockedBy(holder.pid);
    } finally {
      holder.release();
    }
    await holder.done;
    return pending;
  }
  const itemExclusive = () => ({
    definitions: { inventory_items: [{ id: itemId, mode: 'UPDATE' as const }] },
  });
  const stockPlan = (ids = [itemId]) => ({
    definitions: { inventory_items: ids.map((id) => ({ id })) },
    stock: ids.map((id) => position(id)),
  });
  async function balance(id = itemId) {
    return (await stock.getStockOnHand(context, farmId, id)).toString();
  }

  it('rejects a stale unit after a winning unit edit, without a stock effect', async () => {
    await expect(
      ordered(
        itemExclusive(),
        (tx) =>
          tx.inventoryItem.update({
            where: { id: itemId },
            data: { unit: 'EACH' },
          }),
        () => stock.postMovement(context, movement()),
      ),
    ).rejects.toMatchObject({
      code: 'INVENTORY_DEFINITION_CHANGED',
      status: 409,
    });
    expect(await balance()).toBe('0');
  });

  it('freezes unit after the first movement wins and preserves inactive-item M3 policy', async () => {
    await expect(
      ordered(
        stockPlan(),
        (tx) => stock.postMovementInTransaction(tx, context, movement()),
        () => items.update(context, itemId, { unit: 'EACH' }),
      ),
    ).rejects.toMatchObject({ code: 'INVENTORY_DEFINITION_FROZEN' });
    await items.deactivate(context, itemId);
    await expect(
      items.update(context, itemId, { unit: 'L' }),
    ).rejects.toMatchObject({ code: 'INVENTORY_DEFINITION_FROZEN' });
    // History alone freezes unit, not category. Preserve generic M3 inactive-item policy.
    await items.update(context, itemId, {
      category: 'SUPPLY',
      name: 'Renamed',
    });
    await stock.postMovement(context, movement(itemId, '-1'));
    expect(await balance()).toBe('9');
  });

  it('revalidates feed category after a winning category edit and rolls back usage/ISSUE', async () => {
    await stock.postMovement(context, movement());
    await expect(
      ordered(
        itemExclusive(),
        (tx) =>
          tx.inventoryItem.update({
            where: { id: itemId },
            data: { category: 'PRODUCE' },
          }),
        () => feed.post(context, farmId, feedInput()),
      ),
    ).rejects.toMatchObject({ code: 'FEED_USAGE_SCOPE_NOT_FOUND' });
    expect(await balance()).toBe('10');
    expect(
      await prisma.feedUsage.count({
        where: { organizationId: context.organizationId },
      }),
    ).toBe(0);
  });

  async function duringFeed(start: () => Promise<unknown>) {
    const acquired = barrier<number>(),
      release = barrier();
    const real = stock.postMovementInTransaction.bind(stock);
    const spy = vi
      .spyOn(stock, 'postMovementInTransaction')
      .mockImplementationOnce(async (tx, ctx, input) => {
        const result = await real(tx, ctx, input);
        const [row] = await tx.$queryRaw<
          { pid: number }[]
        >`SELECT pg_backend_pid() AS pid`;
        acquired.resolve(row!.pid);
        await release.promise;
        return result;
      });
    const posting = feed.post(context, farmId, feedInput());
    void posting.catch(() => {});
    try {
      const pid = await acquired.promise;
      const competing = start();
      void competing.catch(() => {});
      try {
        await blockedBy(pid);
      } finally {
        release.resolve();
      }
      await posting;
      return await competing;
    } finally {
      release.resolve();
      spy.mockRestore();
    }
  }

  it('freezes category when feed usage wins and retains protection after full reversal', async () => {
    await stock.postMovement(context, movement());
    await expect(
      duringFeed(() => items.update(context, itemId, { category: 'PRODUCE' })),
    ).rejects.toMatchObject({ code: 'INVENTORY_DEFINITION_FROZEN' });
    const usage = await prisma.feedUsage.findFirstOrThrow({
      where: { organizationId: context.organizationId },
    });
    await items.deactivate(context, itemId);
    await prisma.$transaction(async (tx) => {
      await lockFlockMutation(tx, context, farmId, flockId);
      await tx.flock.update({
        where: { id: flockId },
        data: { isActive: false },
      });
    });
    await feed.reverse(context, farmId, usage.id, { occurredAt });
    expect(await balance()).toBe('10');
    await expect(
      items.update(context, itemId, { category: 'SUPPLY' }),
    ).rejects.toMatchObject({ code: 'INVENTORY_DEFINITION_FROZEN' });
  });

  it('serializes deactivation with feed while preserving standalone M3 corrections', async () => {
    await stock.postMovement(context, movement());
    await expect(
      ordered(
        itemExclusive(),
        (tx) =>
          tx.inventoryItem.update({
            where: { id: itemId },
            data: { isActive: false },
          }),
        () => feed.post(context, farmId, feedInput()),
      ),
    ).rejects.toMatchObject({ code: 'FEED_USAGE_SCOPE_NOT_FOUND' });
    expect(await balance()).toBe('10');
    await stock.postMovement(context, movement(itemId, '-1'));
    expect(await balance()).toBe('9');
    await items.reactivate(context, itemId);
    await duringFeed(() => items.deactivate(context, itemId));
    expect(await balance()).toBe('8');
    expect(
      await prisma.feedUsage.count({
        where: { organizationId: context.organizationId },
      }),
    ).toBe(1);
  });

  it('preserves a feed posting ordered before flock close; close-first rejects feed', async () => {
    await stock.postMovement(context, movement());
    await duringFeed(() =>
      prisma.$transaction(async (tx) => {
        await lockFlockMutation(tx, context, farmId, flockId);
        await tx.flock.update({
          where: { id: flockId },
          data: { isActive: false },
        });
      }),
    );
    expect(await balance()).toBe('9');
    await expect(feed.post(context, farmId, feedInput())).rejects.toMatchObject(
      { code: 'FEED_USAGE_SCOPE_NOT_FOUND' },
    );
    expect(await balance()).toBe('9');
  });

  it('prevents the three-party flock/FEED/PRODUCE stock cycle with complete plans', async () => {
    await stock.postMovement(context, movement());
    await stock.postMovement(context, movement(produceId));
    const holder = await hold(
      { ...stockPlan([produceId]), flocks: [{ farmId, flockId }] },
      (tx) =>
        stock.postMovementInTransaction(tx, context, movement(produceId, '-1')),
    );
    const posting = feed.post(context, farmId, feedInput());
    void posting.catch(() => {});
    let composed: Promise<unknown> | undefined;
    const composing = barrier<number>();
    try {
      await blockedBy(holder.pid);
      // The waiting feed writer has not taken FEED stock. This participant can
      // acquire it first, then waits on PRODUCE in the same sorted stock stage.
      composed = prisma.$transaction(
        async (tx) => {
          await tx.$executeRaw`SET LOCAL lock_timeout = '8s'`;
          const [row] = await tx.$queryRaw<
            { pid: number }[]
          >`SELECT pg_backend_pid() AS pid`;
          composing.resolve(row!.pid);
          await lockMutation(tx, context, stockPlan([produceId, itemId]));
          await stock.postMovementInTransaction(
            tx,
            context,
            movement(itemId, '-1'),
          );
          await stock.postMovementInTransaction(
            tx,
            context,
            movement(produceId, '-1'),
          );
        },
        { timeout: 15_000 },
      );
      void composed.catch(() => {});
      await blockedBy(holder.pid, await composing.promise);
      const available = await prisma.$transaction(
        (tx) => tx.$queryRaw<{ held: boolean }[]>`
        SELECT pg_try_advisory_xact_lock(hashtext(${context.organizationId}), hashtext(${`${farmId}:${itemId}`})) AS held`,
      );
      expect(available[0]!.held).toBe(false);
    } finally {
      holder.release();
    }
    await Promise.all([holder.done, posting, composed]);
    expect(await balance()).toBe('8');
    expect(await balance(produceId)).toBe('8');
    expect(
      await prisma.feedUsage.count({
        where: { organizationId: context.organizationId },
      }),
    ).toBe(1);
  });

  it('sorts opposing multi-item plans and rejects attempts to extend a flock-stage plan', async () => {
    await stock.postMovement(context, movement());
    await stock.postMovement(context, movement(produceId));
    await ordered(
      stockPlan([itemId, produceId]),
      async (tx) => {
        for (const id of [itemId, produceId])
          await stock.postMovementInTransaction(
            tx,
            context,
            movement(id, '-2'),
          );
      },
      () =>
        prisma.$transaction(
          async (tx) => {
            await tx.$executeRaw`SET LOCAL lock_timeout = '5s'`;
            await lockMutation(tx, context, stockPlan([produceId, itemId]));
            for (const id of [produceId, itemId])
              await stock.postMovementInTransaction(
                tx,
                context,
                movement(id, '-2'),
              );
          },
          { timeout: 10_000 },
        ),
    );
    expect(await balance()).toBe('6');
    expect(await balance(produceId)).toBe('6');
    await expect(
      prisma.$transaction(async (tx) => {
        await lockFlockMutation(tx, context, farmId, flockId);
        await stock.postMovementInTransaction(tx, context, movement());
      }),
    ).rejects.toMatchObject({ code: 'MUTATION_LOCK_PLAN_INCOMPLETE' });
    expect(await balance()).toBe('6');
  });

  it('protects inactive catalog references and serializes a first link with definition edits', async () => {
    const plan = { definitions: { inventory_items: [{ id: produceId }] } };
    await expect(
      ordered(
        plan,
        (tx) =>
          tx.salesProduct.create({
            data: {
              organizationId: context.organizationId,
              code: 'PRD-1',
              name: 'Produce',
              kind: 'PRODUCE',
              unit: 'KG',
              inventoryItemId: produceId,
              isActive: false,
            },
          }),
        () =>
          items.update(context, produceId, { unit: 'EACH', category: 'OTHER' }),
      ),
    ).rejects.toMatchObject({ code: 'INVENTORY_DEFINITION_FROZEN' });
    await items.update(context, produceId, {
      name: 'New label',
      lowStockThreshold: 1,
    });
    await items.deactivate(context, produceId);
    await expect(
      items.update(context, produceId, { category: 'OTHER' }),
    ).rejects.toMatchObject({ code: 'INVENTORY_DEFINITION_FROZEN' });
  });

  it('validates stale feed units after a concurrent stock mutation without partial feed effects', async () => {
    await stock.postMovement(context, movement());
    await expect(
      ordered(
        stockPlan(),
        (tx) =>
          stock.postMovementInTransaction(tx, context, movement(itemId, '-1')),
        () =>
          feed.post(context, farmId, {
            ...feedInput(),
            expectedInventoryUnit: 'EACH',
          }),
      ),
    ).rejects.toMatchObject({ code: 'INVENTORY_DEFINITION_CHANGED' });
    // Only the winning manual ISSUE committed; the stale feed wrote neither side.
    expect(await balance()).toBe('9');
    expect(
      await prisma.feedUsage.count({
        where: { organizationId: context.organizationId },
      }),
    ).toBe(0);
  });

  it('rejects stale first catalog links after definition edits win', async () => {
    await expect(
      ordered(
        {
          definitions: { inventory_items: [{ id: produceId, mode: 'UPDATE' }] },
        },
        (tx) =>
          tx.inventoryItem.update({
            where: { id: produceId },
            data: { unit: 'EACH', category: 'OTHER' },
          }),
        () =>
          prisma.$transaction(async (tx) => {
            await lockMutation(tx, context, {
              definitions: { inventory_items: [{ id: produceId }] },
            });
            return tx.salesProduct.create({
              data: {
                organizationId: context.organizationId,
                code: 'STALE',
                name: 'Produce',
                kind: 'PRODUCE',
                unit: 'KG',
                inventoryItemId: produceId,
              },
            });
          }),
      ),
    ).rejects.toThrow();
    expect(
      await prisma.salesProduct.count({
        where: { organizationId: context.organizationId },
      }),
    ).toBe(0);
  });
});
