import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaService } from '../../database/prisma.service.js';
import { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import { OrganizationContext } from '../authorization/organization-context.js';
import { AuthorizationService } from '../authorization/authorization.service.js';
import { FarmAccessService } from '../authorization/farm-access.service.js';
import { InventoryStockService } from '../inventory/inventory-stock.service.js';
import { FeedUsageService } from './feed-usage.service.js';

describe('Feed usage and inventory (PostgreSQL)', () => {
  // Real committed transactions are needed to prove cross-service rollback and
  // advisory-lock concurrency. Isolate this suite in an owned temporary database
  // so cleanup never deletes append-only history or disables its protections.
  const admin = new PrismaService();
  const databaseName = `feed_test_${randomUUID().replaceAll('-', '')}`;
  let databaseCreated = false;
  let prisma: PrismaService;
  let stock: InventoryStockService;
  let service: FeedUsageService;
  let context: OrganizationContext;
  let orgA: string, orgB: string, farmA: string, farmA2: string, farmB: string;
  let flockA: string, flockA2: string, flockB: string;
  let feedA: string, feedB: string, supplyA: string, foreignActor: string;
  const occurredAt = new Date('2026-11-02T12:00:00.000Z');
  const quantity = (value: string) => new Prisma.Decimal(value);
  const input = (value = '1.125') => ({
    flockId: flockA,
    inventoryItemId: feedA,
    quantity: quantity(value),
    occurredAt,
  });

  beforeAll(async () => {
    await admin.$connect();
    await admin.$executeRawUnsafe(`CREATE DATABASE "${databaseName}"`);
    databaseCreated = true;
    const url = new URL(process.env.DATABASE_URL!);
    url.pathname = `/${databaseName}`;
    const adapter = new PrismaPg({ connectionString: url.toString() });
    const setup = await adapter.connect();
    try {
      const migrations = new URL(
        '../../../prisma/migrations/',
        import.meta.url,
      );
      for (const entry of (
        await readdir(migrations, { withFileTypes: true })
      ).sort((a, b) => a.name.localeCompare(b.name))) {
        if (entry.isDirectory()) {
          // Send the whole migration through pg's simple-query protocol. The
          // adapter's executeScript splitter cannot handle PL/pgSQL semicolons.
          await setup
            .underlyingDriver()
            .query(
              await readFile(
                new URL(`${entry.name}/migration.sql`, migrations),
                'utf8',
              ),
            );
        }
      }
    } finally {
      await setup.dispose();
    }
    // PrismaService only adds lifecycle hooks; the isolated client supplies the
    // same database operations to these directly constructed domain services.
    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: url.toString() }),
    }) as PrismaService;
    await prisma.$connect();
    stock = new InventoryStockService(prisma);
    service = new FeedUsageService(
      prisma,
      stock,
      new FarmAccessService(prisma, new AuthorizationService()),
    );
  }, 60_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    if (databaseCreated && /^feed_test_[a-f0-9]{32}$/.test(databaseName)) {
      await admin.$executeRawUnsafe(
        `DROP DATABASE "${databaseName}" WITH (FORCE)`,
      );
    }
    await admin.$disconnect();
  });

  beforeEach(async () => {
    orgA = randomUUID();
    orgB = randomUUID();
    farmA = randomUUID();
    farmA2 = randomUUID();
    farmB = randomUUID();
    flockA = randomUUID();
    flockA2 = randomUUID();
    flockB = randomUUID();
    feedA = randomUUID();
    feedB = randomUUID();
    supplyA = randomUUID();
    foreignActor = randomUUID();
    const actor = randomUUID(),
      membership = randomUUID();
    context = new OrganizationContext(orgA, membership, actor, 'ADMIN');
    await prisma.organization.createMany({
      data: [orgA, orgB].map((id) => ({
        id,
        name: 'Feed test',
        slug: `feed-${id}`,
      })),
    });
    await prisma.user.createMany({
      data: [actor, foreignActor].map((id) => ({
        id,
        email: `${id}@example.com`,
        passwordHash: 'unused',
      })),
    });
    await prisma.organizationMembership.createMany({
      data: [
        { id: membership, organizationId: orgA, userId: actor, role: 'ADMIN' },
        { organizationId: orgB, userId: foreignActor, role: 'ADMIN' },
      ],
    });
    await prisma.farm.createMany({
      data: [
        { id: farmA, organizationId: orgA, code: 'NORTH', name: 'North' },
        { id: farmA2, organizationId: orgA, code: 'SOUTH', name: 'South' },
        { id: farmB, organizationId: orgB, code: 'NORTH', name: 'North' },
      ],
    });
    await prisma.flock.createMany({
      data: [
        { id: flockA, organizationId: orgA, farmId: farmA, code: 'FLK-1' },
        { id: flockA2, organizationId: orgA, farmId: farmA2, code: 'FLK-2' },
        { id: flockB, organizationId: orgB, farmId: farmB, code: 'FLK-1' },
      ].map((flock) => ({
        ...flock,
        name: 'Placement',
        startingBirdCount: 100,
        placementDate: new Date('2026-11-01'),
      })),
    });
    await prisma.inventoryItem.createMany({
      data: [
        { id: feedA, organizationId: orgA, code: 'INV-1', category: 'FEED' },
        { id: feedB, organizationId: orgB, code: 'INV-1', category: 'FEED' },
        {
          id: supplyA,
          organizationId: orgA,
          code: 'INV-2',
          category: 'SUPPLY',
        },
      ].map((item) => ({
        ...item,
        category: item.category as 'FEED' | 'SUPPLY',
        name: 'Item',
        unit: 'KG' as const,
      })),
    });
    await stock.postMovement(context, {
      farmId: farmA,
      inventoryItemId: feedA,
      quantity: quantity('10'),
      reason: 'RECEIPT',
      occurredAt,
    });
  });

  async function assertNoConsumption() {
    expect(
      await prisma.feedUsage.count({ where: { organizationId: orgA } }),
    ).toBe(0);
    expect(
      await prisma.inventoryMovement.count({ where: { organizationId: orgA } }),
    ).toBe(1);
    expect((await stock.getStockOnHand(context, farmA, feedA)).toString()).toBe(
      '10',
    );
  }

  it('records positive consumption and exactly one matching negative movement with precise derived stock', async () => {
    const usage = await service.post(context, farmA, input());
    const movement = await prisma.inventoryMovement.findUniqueOrThrow({
      where: { id: usage.inventoryMovementId },
    });
    expect(usage.quantity.toString()).toBe('1.125');
    expect(movement.quantity.toString()).toBe('-1.125');
    expect(movement).toMatchObject({
      organizationId: orgA,
      farmId: farmA,
      inventoryItemId: feedA,
      actorUserId: context.userId,
      reason: 'ISSUE',
      occurredAt,
    });
    expect(
      await prisma.feedUsage.count({ where: { organizationId: orgA } }),
    ).toBe(1);
    expect(
      await prisma.inventoryMovement.count({
        where: { organizationId: orgA, reason: 'ISSUE' },
      }),
    ).toBe(1);
    expect((await stock.getStockOnHand(context, farmA, feedA)).toString()).toBe(
      '8.875',
    );
  });

  it('rejects non-positive, non-finite, over-precision and out-of-range quantities before posting', async () => {
    for (const value of [
      '0',
      '-1',
      'NaN',
      'Infinity',
      '0.0001',
      '1000000000000000',
    ]) {
      await expect(
        service.post(context, farmA, input(value)),
      ).rejects.toMatchObject({ code: 'FEED_USAGE_INVALID_QUANTITY' });
    }
    await assertNoConsumption();
  });

  it('retains the M3 negative-stock policy and advisory lock across concurrent feed posts', async () => {
    await expect(
      service.post(context, farmA, input('11')),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_INVENTORY_STOCK' });
    await assertNoConsumption();
    const results = await Promise.allSettled([
      service.post(context, farmA, input('8')),
      service.post(context, farmA, input('8')),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect(
      await prisma.feedUsage.count({ where: { organizationId: orgA } }),
    ).toBe(1);
    expect(
      await prisma.inventoryMovement.count({
        where: { organizationId: orgA, reason: 'ISSUE' },
      }),
    ).toBe(1);
    expect((await stock.getStockOnHand(context, farmA, feedA)).toString()).toBe(
      '2',
    );
  });

  it('rejects foreign farm/flock/item and non-feed items without posting either side', async () => {
    for (const badInput of [
      { flockId: flockB },
      { flockId: flockA2 },
      { inventoryItemId: feedB },
      { inventoryItemId: supplyA },
    ]) {
      await expect(
        service.post(context, farmA, { ...input(), ...badInput }),
      ).rejects.toMatchObject({ code: 'FEED_USAGE_SCOPE_NOT_FOUND' });
    }
    await expect(
      service.post(context, farmB, {
        ...input(),
        flockId: flockB,
        inventoryItemId: feedB,
      }),
    ).rejects.toMatchObject({ code: 'FEED_USAGE_SCOPE_NOT_FOUND' });
    await assertNoConsumption();
  });

  it('rolls back the complete operation on either inventory or feed persistence failure', async () => {
    // The real inventory INSERT fails its metadata constraint.
    await expect(
      service.post(context, farmA, { ...input(), note: 'x'.repeat(2001) }),
    ).rejects.toThrow();
    await assertNoConsumption();

    // Inject a broken link after the real inventory INSERT succeeds; FeedUsage
    // must fail and the caller-owned transaction must roll that INSERT back.
    const realPost = stock.postMovementInTransaction.bind(stock);
    const spy = vi
      .spyOn(stock, 'postMovementInTransaction')
      .mockImplementationOnce(async (...args) => {
        const movement = await realPost(...args);
        return { ...movement, id: randomUUID() };
      });
    try {
      await expect(service.post(context, farmA, input())).rejects.toThrow();
    } finally {
      spy.mockRestore();
    }
    await assertNoConsumption();
  });

  it('enforces direct persistence scope, matching movement semantics and organization-safe actor attribution', async () => {
    const movement = await stock.postMovement(context, {
      farmId: farmA,
      inventoryItemId: feedA,
      quantity: quantity('-1'),
      reason: 'ISSUE',
      occurredAt,
    });
    const data = {
      organizationId: orgA,
      farmId: farmA,
      flockId: flockA,
      inventoryItemId: feedA,
      actorUserId: context.userId,
      quantity: '1',
      inventoryMovementId: movement.id,
      occurredAt,
    };
    for (const mismatch of [
      { flockId: flockA2 },
      { flockId: flockB },
      { farmId: farmA2 },
      { inventoryItemId: feedB },
      { quantity: '2' },
      { quantity: '0' },
      { quantity: '-1' },
      { occurredAt: new Date('2026-11-03') },
    ]) {
      await expect(
        prisma.feedUsage.create({ data: { ...data, ...mismatch } }),
      ).rejects.toThrow();
    }
    const foreignAudit = await prisma.inventoryMovement.create({
      data: {
        organizationId: orgA,
        farmId: farmA,
        inventoryItemId: feedA,
        actorUserId: foreignActor,
        quantity: '-1',
        reason: 'ISSUE',
        occurredAt,
      },
    });
    await expect(
      prisma.feedUsage.create({
        data: {
          ...data,
          inventoryMovementId: foreignAudit.id,
          actorUserId: foreignActor,
        },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
    // A valid direct insertion proves the rejected cases were otherwise valid.
    await prisma.feedUsage.create({ data });
  });

  it('protects posted feed history and its unique linked inventory movement', async () => {
    const usage = await service.post(context, farmA, input());
    const { id: _id, ...duplicate } = usage;
    await expect(
      prisma.feedUsage.create({ data: duplicate }),
    ).rejects.toMatchObject({ code: 'P2002' });
    await expect(
      prisma.feedUsage.update({
        where: { id: usage.id },
        data: { note: 'Rewrite' },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.feedUsage.delete({ where: { id: usage.id } }),
    ).rejects.toThrow();
    await expect(
      prisma.$executeRaw`TRUNCATE TABLE "feed_usages"`,
    ).rejects.toThrow();
    await expect(
      prisma.inventoryMovement.update({
        where: { id: usage.inventoryMovementId },
        data: { quantity: '-2' },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.inventoryMovement.delete({
        where: { id: usage.inventoryMovementId },
      }),
    ).rejects.toThrow();
    expect(
      await prisma.feedUsage.findUnique({ where: { id: usage.id } }),
    ).toEqual(usage);
    expect((await stock.getStockOnHand(context, farmA, feedA)).toString()).toBe(
      '8.875',
    );
  });

  it('fully compensates once through append-only usage and inventory history', async () => {
    const original = await service.post(context, farmA, input());
    const originalMovement = await prisma.inventoryMovement.findUnique({
      where: { id: original.inventoryMovementId },
    });
    const reversal = await service.reverse(context, farmA, original.id, {
      occurredAt,
      note: 'Incorrect posting',
    });
    const movement = await prisma.inventoryMovement.findUniqueOrThrow({
      where: { id: reversal.inventoryMovementId },
    });
    expect(reversal.quantity.toString()).toBe('1.125');
    expect(reversal.reversesUsageId).toBe(original.id);
    expect(movement.quantity.toString()).toBe('1.125');
    expect(movement.reason).toBe('ADJUSTMENT');
    expect((await stock.getStockOnHand(context, farmA, feedA)).toString()).toBe(
      '10',
    );
    await expect(
      service.reverse(context, farmA, original.id, { occurredAt }),
    ).rejects.toMatchObject({ code: 'FEED_USAGE_ALREADY_REVERSED' });
    await expect(
      service.reverse(context, farmA, reversal.id, { occurredAt }),
    ).rejects.toMatchObject({ code: 'FEED_USAGE_SCOPE_NOT_FOUND' });
    expect(
      await prisma.inventoryMovement.count({ where: { organizationId: orgA } }),
    ).toBe(3);
    expect(
      await prisma.feedUsage.findUnique({ where: { id: original.id } }),
    ).toEqual(original);
    expect(
      await prisma.inventoryMovement.findUnique({
        where: { id: original.inventoryMovementId },
      }),
    ).toEqual(originalMovement);
    await service.post(context, farmA, input('2'));
    expect((await stock.getStockOnHand(context, farmA, feedA)).toString()).toBe(
      '8',
    );
  });
});
