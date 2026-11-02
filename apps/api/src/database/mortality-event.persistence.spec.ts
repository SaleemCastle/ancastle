import { randomUUID } from 'node:crypto';

import { PrismaService } from './prisma.service.js';
import type { Prisma } from '../generated/prisma/client.js';

describe('Mortality event persistence', () => {
  const prisma = new PrismaService();
  const orgA = randomUUID();
  const orgB = randomUUID();
  const farmA = randomUUID();
  const farmA2 = randomUUID();
  const farmB = randomUUID();
  const flockA = randomUUID();
  const flockA2 = randomUUID();
  const flockB = randomUUID();
  const actorUserId = randomUUID();
  const occurredAt = new Date('2026-11-02T08:00:00.000Z');
  const rollback = new Error('Rollback mortality test fixtures');

  const eventData = () => ({
    organizationId: orgA,
    farmId: farmA,
    flockId: flockA,
    actorUserId,
    deathCount: 3,
    occurredAt,
  });

  beforeAll(async () => {
    await prisma.$connect();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  // Roll back fixtures instead of deleting protected history or disabling triggers.
  async function withLedger(
    work: (tx: Prisma.TransactionClient) => Promise<void>,
  ) {
    try {
      await prisma.$transaction(
        async (tx) => {
          await tx.organization.createMany({
            data: [orgA, orgB].map((id) => ({
              id,
              name: 'Mortality persistence',
              slug: `mortality-${id}`,
            })),
          });
          await tx.user.create({
            data: {
              id: actorUserId,
              email: `${actorUserId}@example.com`,
              passwordHash: 'unused-test-hash',
            },
          });
          await tx.organizationMembership.create({
            data: { organizationId: orgA, userId: actorUserId },
          });
          await tx.farm.createMany({
            data: [
              { id: farmA, organizationId: orgA, code: 'NORTH', name: 'North' },
              {
                id: farmA2,
                organizationId: orgA,
                code: 'SOUTH',
                name: 'South',
              },
              { id: farmB, organizationId: orgB, code: 'NORTH', name: 'North' },
            ],
          });
          await tx.flock.createMany({
            data: [
              {
                id: flockA,
                organizationId: orgA,
                farmId: farmA,
                code: 'FLK-000001',
              },
              {
                id: flockA2,
                organizationId: orgA,
                farmId: farmA2,
                code: 'FLK-000002',
              },
              {
                id: flockB,
                organizationId: orgB,
                farmId: farmB,
                code: 'FLK-000001',
              },
            ].map((flock) => ({
              ...flock,
              name: 'Placement',
              startingBirdCount: 100,
              placementDate: new Date('2026-11-01'),
            })),
          });
          await work(tx);
          throw rollback;
        },
        { timeout: 20_000 },
      );
    } catch (error) {
      if (error !== rollback) throw error;
    }
  }

  // A rejected PostgreSQL statement aborts its transaction; isolate each expected
  // rejection so later assertions still exercise the same intact ledger.
  async function rejects(
    tx: Prisma.TransactionClient,
    operation: () => Promise<unknown>,
  ) {
    await tx.$executeRaw`SAVEPOINT mortality_rejection`;
    try {
      await expect(operation()).rejects.toThrow();
    } finally {
      await tx.$executeRaw`ROLLBACK TO SAVEPOINT mortality_rejection`;
      await tx.$executeRaw`RELEASE SAVEPOINT mortality_rejection`;
    }
  }

  it('persists whole-bird mortality with audit identity, timestamps and optional metadata', async () => {
    await withLedger(async (tx) => {
      const event = await tx.mortalityEvent.create({
        data: {
          ...eventData(),
          cause: 'Unknown',
          note: 'Morning inspection',
          reference: 'ROUND-1',
        },
      });
      expect(
        await tx.mortalityEvent.findFirst({
          where: {
            id: event.id,
            organizationId: orgA,
            farmId: farmA,
            flockId: flockA,
          },
        }),
      ).toMatchObject({
        ...eventData(),
        cause: 'Unknown',
        note: 'Morning inspection',
        reference: 'ROUND-1',
        reversesEventId: null,
        createdAt: expect.any(Date),
      });
      expect(event.id).toMatch(/^[0-9a-f-]{36}$/);
      // Posting mortality changes neither the placement baseline nor inventory.
      expect(
        await tx.flock.findUniqueOrThrow({ where: { id: flockA } }),
      ).toMatchObject({ startingBirdCount: 100 });
      expect(
        await tx.inventoryMovement.count({ where: { organizationId: orgA } }),
      ).toBe(0);
    });
  });

  it('rejects cross-tenant/cross-farm flock links and missing actor identity', async () => {
    await withLedger(async (tx) => {
      for (const scope of [
        { flockId: flockB },
        { flockId: flockA2 },
        { farmId: farmA2 },
        { organizationId: orgB },
        { farmId: farmB },
        { flockId: randomUUID() },
        { actorUserId: randomUUID() },
      ]) {
        await rejects(tx, () =>
          tx.mortalityEvent.create({ data: { ...eventData(), ...scope } }),
        );
      }
    });
  });

  it('rejects a real actor who belongs only to another organization', async () => {
    await withLedger(async (tx) => {
      const foreignActor = await tx.user.create({
        data: {
          email: `${randomUUID()}@example.com`,
          passwordHash: 'unused-test-hash',
          memberships: { create: { organizationId: orgB } },
        },
      });

      await expect(
        tx.mortalityEvent.create({
          data: { ...eventData(), actorUserId: foreignActor.id },
        }),
      ).rejects.toMatchObject({ code: 'P2003' });
    });
  });

  it('rejects zero, negative and fractional mortality counts at the database boundary', async () => {
    await withLedger(async (tx) => {
      for (const deathCount of [0, -1]) {
        await rejects(tx, () =>
          tx.mortalityEvent.create({ data: { ...eventData(), deathCount } }),
        );
      }
      // Like Flock Int fields, Prisma truncates JS fractions before SQL. Exercise
      // PostgreSQL directly; later posting contracts must validate integer input.
      await rejects(
        tx,
        () => tx.$executeRaw`
        INSERT INTO "mortality_events" ("id", "organizationId", "farmId", "flockId", "actorUserId", "deathCount", "occurredAt")
        VALUES (${randomUUID()}::uuid, ${orgA}::uuid, ${farmA}::uuid,
          ${flockA}::uuid, ${actorUserId}::uuid, '1.5', ${occurredAt})
      `,
      );
    });
  });

  it('blocks updates, deletion and truncation without changing posted history', async () => {
    await withLedger(async (tx) => {
      const event = await tx.mortalityEvent.create({ data: eventData() });
      await rejects(tx, () =>
        tx.mortalityEvent.update({
          where: { id: event.id },
          data: { deathCount: 2 },
        }),
      );
      await rejects(tx, () =>
        tx.mortalityEvent.delete({ where: { id: event.id } }),
      );
      await rejects(
        tx,
        () => tx.$executeRaw`TRUNCATE TABLE "mortality_events"`,
      );
      expect(
        await tx.mortalityEvent.findUnique({ where: { id: event.id } }),
      ).toEqual(event);
    });
  });

  it('appends a full reversal and replacement while preserving the original event', async () => {
    await withLedger(async (tx) => {
      const original = await tx.mortalityEvent.create({ data: eventData() });
      const reversal = await tx.mortalityEvent.create({
        data: {
          ...eventData(),
          reversesEventId: original.id,
          note: 'Corrected inspection count',
        },
      });
      const replacement = await tx.mortalityEvent.create({
        data: { ...eventData(), deathCount: 2 },
      });
      expect(reversal).toMatchObject({
        reversesEventId: original.id,
        deathCount: 3,
        actorUserId,
      });
      expect(replacement).toMatchObject({
        reversesEventId: null,
        deathCount: 2,
      });
      expect(
        await tx.mortalityEvent.findUnique({ where: { id: original.id } }),
      ).toEqual(original);
      expect(
        await tx.mortalityEvent.count({
          where: { organizationId: orgA, farmId: farmA, flockId: flockA },
        }),
      ).toBe(3);
      await rejects(tx, () =>
        tx.mortalityEvent.create({
          data: { ...eventData(), reversesEventId: original.id },
        }),
      );
      await rejects(tx, () =>
        tx.mortalityEvent.create({
          data: { ...eventData(), reversesEventId: reversal.id },
        }),
      );
    });
  });

  it('rejects partial, foreign-flock, missing and self reversals', async () => {
    await withLedger(async (tx) => {
      const original = await tx.mortalityEvent.create({ data: eventData() });
      await rejects(tx, () =>
        tx.mortalityEvent.create({
          data: { ...eventData(), deathCount: 2, reversesEventId: original.id },
        }),
      );
      for (const scope of [
        { organizationId: orgA, farmId: farmA2, flockId: flockA2 },
        { organizationId: orgB, farmId: farmB, flockId: flockB },
      ]) {
        await rejects(tx, () =>
          tx.mortalityEvent.create({
            data: { ...eventData(), ...scope, reversesEventId: original.id },
          }),
        );
      }
      const id = randomUUID();
      await rejects(tx, () =>
        tx.mortalityEvent.create({
          data: { ...eventData(), reversesEventId: randomUUID() },
        }),
      );
      await rejects(tx, () =>
        tx.mortalityEvent.create({
          data: { ...eventData(), id, reversesEventId: id },
        }),
      );
    });
  });

  it('bounds free-text metadata without a cause taxonomy', async () => {
    await withLedger(async (tx) => {
      await tx.mortalityEvent.create({
        data: {
          ...eventData(),
          cause: 'x'.repeat(120),
          note: 'x'.repeat(2000),
          reference: 'x'.repeat(120),
        },
      });
      for (const metadata of [
        { cause: 'x'.repeat(121) },
        { note: 'x'.repeat(2001) },
        { reference: 'x'.repeat(121) },
      ]) {
        await rejects(tx, () =>
          tx.mortalityEvent.create({ data: { ...eventData(), ...metadata } }),
        );
      }
    });
  });

  it('protects flock ownership and audit identity after mortality has been posted', async () => {
    await withLedger(async (tx) => {
      await tx.mortalityEvent.create({ data: eventData() });
      await rejects(tx, () =>
        tx.flock.update({ where: { id: flockA }, data: { farmId: farmA2 } }),
      );
      await rejects(tx, () => tx.flock.delete({ where: { id: flockA } }));
      await rejects(tx, () => tx.user.delete({ where: { id: actorUserId } }));
    });
  });
});
