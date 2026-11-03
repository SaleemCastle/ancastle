import { randomUUID } from 'node:crypto';

import { temporaryDatabase } from '../../test/temporary-database.js';
import { Prisma } from '../../generated/prisma/client.js';
import { OrganizationContext } from '../authorization/organization-context.js';
import { FarmAccessService } from '../authorization/farm-access.service.js';
import { AuthorizationService } from '../authorization/authorization.service.js';
import { InventoryStockService } from '../inventory/inventory-stock.service.js';
import { FeedUsageService } from './feed-usage.service.js';
import { FlockMetricsService } from './flock-metrics.service.js';
import { MortalityService } from './mortality.service.js';

describe('Derived flock metrics and mortality posting (PostgreSQL)', () => {
  let database: Awaited<ReturnType<typeof temporaryDatabase>>;
  let metrics: FlockMetricsService;
  let mortality: MortalityService;
  let feed: FeedUsageService;
  let stock: InventoryStockService;
  let context: OrganizationContext;
  let orgB: string, farmA: string, farmA2: string, farmB: string;
  let flockA: string, flockA2: string, flockB: string, item: string;
  const occurredAt = new Date('2026-11-02T12:00:00.000Z');

  beforeAll(async () => {
    database = await temporaryDatabase();
    const farms = new FarmAccessService(
      database.prisma,
      new AuthorizationService(),
    );
    metrics = new FlockMetricsService(database.prisma, farms);
    mortality = new MortalityService(database.prisma, farms);
    stock = new InventoryStockService(database.prisma);
    feed = new FeedUsageService(database.prisma, stock, farms);
  }, 60_000);

  afterAll(async () => {
    await database?.dispose();
  });

  beforeEach(async () => {
    const prisma = database.prisma;
    const organizationId = randomUUID(),
      userId = randomUUID(),
      membershipId = randomUUID();
    orgB = randomUUID();
    farmA = randomUUID();
    farmA2 = randomUUID();
    farmB = randomUUID();
    flockA = randomUUID();
    flockA2 = randomUUID();
    flockB = randomUUID();
    item = randomUUID();
    context = new OrganizationContext(
      organizationId,
      membershipId,
      userId,
      'ADMIN',
    );
    await prisma.organization.createMany({
      data: [organizationId, orgB].map((id) => ({
        id,
        name: 'Metrics',
        slug: `metrics-${id}`,
      })),
    });
    await prisma.user.create({
      data: {
        id: userId,
        email: `${userId}@example.com`,
        passwordHash: 'unused',
      },
    });
    await prisma.organizationMembership.create({
      data: { id: membershipId, organizationId, userId, role: 'ADMIN' },
    });
    await prisma.farm.createMany({
      data: [
        { id: farmA, organizationId, code: 'NORTH' },
        { id: farmA2, organizationId, code: 'SOUTH' },
        { id: farmB, organizationId: orgB, code: 'NORTH' },
      ].map((farm) => ({ ...farm, name: 'Farm' })),
    });
    await prisma.flock.createMany({
      data: [
        { id: flockA, organizationId, farmId: farmA, code: 'FLK-1' },
        { id: flockA2, organizationId, farmId: farmA2, code: 'FLK-2' },
        { id: flockB, organizationId: orgB, farmId: farmB, code: 'FLK-1' },
      ].map((flock) => ({
        ...flock,
        name: 'Placement',
        startingBirdCount: 100,
        placementDate: new Date('2026-11-01'),
        expectedMaturityDate: new Date('2026-11-22'),
      })),
    });
    await prisma.inventoryItem.create({
      data: {
        id: item,
        organizationId,
        name: 'Feed',
        code: 'INV-1',
        unit: 'KG',
        category: 'FEED',
      },
    });
    await stock.postMovement(context, {
      farmId: farmA,
      inventoryItemId: item,
      quantity: new Prisma.Decimal('10'),
      reason: 'RECEIPT',
      occurredAt,
    });
  });

  const post = (deathCount: number, farmId = farmA, flockId = flockA) =>
    mortality.post(context, farmId, { flockId, deathCount, occurredAt });

  it('derives corrected mortality, live population and item-specific feed from history in a scoped snapshot', async () => {
    const cancelledDeath = await post(10);
    await mortality.reverse(context, farmA, flockA, cancelledDeath.id, {
      occurredAt,
    });
    await post(3);
    await post(2);
    const cancelledFeed = await feed.post(context, farmA, {
      flockId: flockA,
      inventoryItemId: item,
      quantity: new Prisma.Decimal('1.125'),
      occurredAt,
    });
    await feed.reverse(context, farmA, cancelledFeed.id, { occurredAt });
    await feed.post(context, farmA, {
      flockId: flockA,
      inventoryItemId: item,
      quantity: new Prisma.Decimal('2.375'),
      occurredAt,
    });
    // Another unit must not be added to kilograms as an ambiguous grand total.
    const other = await database.prisma.inventoryItem.create({
      data: {
        organizationId: context.organizationId,
        name: 'Counted feed',
        code: 'INV-2',
        unit: 'EACH',
        category: 'FEED',
      },
    });
    await stock.postMovement(context, {
      farmId: farmA,
      inventoryItemId: other.id,
      quantity: new Prisma.Decimal('10'),
      reason: 'RECEIPT',
      occurredAt,
    });
    await feed.post(context, farmA, {
      flockId: flockA,
      inventoryItemId: other.id,
      quantity: new Prisma.Decimal('3'),
      occurredAt,
    });
    const result = await metrics.get(context, farmA, flockA, '2026-11-15');
    expect(result).toMatchObject({
      startingBirdCount: 100,
      cumulativeMortality: 5,
      liveBirdCount: 95,
      ageDays: 14,
      ageWeeks: 2,
      daysToMaturity: 7,
      maturityState: 'BEFORE_EXPECTED_MATURITY',
    });
    expect(result.mortalityPercentage.toString()).toBe('5');
    expect(
      result.cumulativeFeedUsage.map((row) => ({
        ...row,
        quantity: row.quantity.toString(),
      })),
    ).toEqual(
      expect.arrayContaining([
        { inventoryItemId: item, unit: 'KG', quantity: '2.375' },
        { inventoryItemId: other.id, unit: 'EACH', quantity: '3' },
      ]),
    );
    expect(result.cumulativeFeedUsage).toHaveLength(2);
    // asOfDate changes calendar metrics only, never silently filters posted history.
    expect(
      await metrics.get(context, farmA, flockA, '2026-11-01'),
    ).toMatchObject({ cumulativeMortality: 5, liveBirdCount: 95, ageDays: 0 });
  });

  it('keeps farm/flock/organization history isolated on metrics and mortality operations', async () => {
    await post(7);
    await post(40, farmA2, flockA2);
    expect(
      await metrics.get(context, farmA, flockA, '2026-11-15'),
    ).toMatchObject({ cumulativeMortality: 7, liveBirdCount: 93 });
    expect(
      await metrics.get(context, farmA2, flockA2, '2026-11-15'),
    ).toMatchObject({ cumulativeMortality: 40, liveBirdCount: 60 });
    for (const [farmId, flockId] of [
      [farmA, flockA2],
      [farmA, flockB],
      [farmB, flockB],
      [farmA, randomUUID()],
    ]) {
      await expect(
        metrics.get(context, farmId, flockId, '2026-11-15'),
      ).rejects.toMatchObject({ code: 'FLOCK_NOT_FOUND' });
      await expect(post(1, farmId, flockId)).rejects.toMatchObject({
        code: 'FLOCK_NOT_FOUND',
      });
    }
  });

  it('rejects over-mortality, allows the exact remaining population, and restores headroom after reversal', async () => {
    for (const count of [0, -1, 1.5]) {
      await expect(post(count)).rejects.toMatchObject({
        code: 'MORTALITY_INVALID_COUNT',
      });
    }
    const original = await post(30);
    await expect(post(71)).rejects.toMatchObject({
      code: 'FLOCK_OVER_MORTALITY',
    });
    expect(
      await database.prisma.mortalityEvent.count({
        where: { organizationId: context.organizationId },
      }),
    ).toBe(1);
    await post(70);
    const exhausted = await metrics.get(context, farmA, flockA, '2026-11-15');
    expect(exhausted.liveBirdCount).toBe(0);
    expect(exhausted.mortalityPercentage.toString()).toBe('100');
    await mortality.reverse(context, farmA, flockA, original.id, {
      occurredAt,
    });
    expect(
      await metrics.get(context, farmA, flockA, '2026-11-15'),
    ).toMatchObject({ liveBirdCount: 30, cumulativeMortality: 70 });
    await post(30);
    await expect(post(1)).rejects.toMatchObject({
      code: 'FLOCK_OVER_MORTALITY',
    });
  });

  it('serializes simultaneous mortality so only one request can consume the remaining population', async () => {
    const results = await Promise.allSettled([post(60), post(60)]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toEqual([
      expect.objectContaining({
        reason: expect.objectContaining({ code: 'FLOCK_OVER_MORTALITY' }),
      }),
    ]);
    expect(
      await metrics.get(context, farmA, flockA, '2026-11-15'),
    ).toMatchObject({ liveBirdCount: 40, cumulativeMortality: 60 });
    expect(
      await database.prisma.mortalityEvent.count({
        where: { organizationId: context.organizationId },
      }),
    ).toBe(1);
  });
});
