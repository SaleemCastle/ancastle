import { randomUUID } from 'node:crypto';

import { temporaryDatabase } from '../../test/temporary-database.js';
import { Prisma } from '../../generated/prisma/client.js';
import { OrganizationContext } from '../authorization/organization-context.js';
import { FarmAccessService } from '../authorization/farm-access.service.js';
import { AuthorizationService } from '../authorization/authorization.service.js';
import { InventoryStockService } from '../inventory/inventory-stock.service.js';
import { FeedUsageService } from './feed-usage.service.js';
import { FlockMetricsService } from './flock-metrics.service.js';
import { FlocksService } from './flocks.service.js';
import { MortalityService } from './mortality.service.js';
import { lockMutation } from '../../database/mutation-locks.js';
import { calculateFlockPopulation } from './flock-metrics.js';
import { effectivePopulation } from './poultry-history.js';

describe('Derived flock metrics and mortality posting (PostgreSQL)', () => {
  let database: Awaited<ReturnType<typeof temporaryDatabase>>;
  let metrics: FlockMetricsService;
  let mortality: MortalityService;
  let flocks: FlocksService;
  let feed: FeedUsageService;
  let stock: InventoryStockService;
  let context: OrganizationContext;
  let contextB: OrganizationContext;
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
    flocks = new FlocksService(database.prisma, farms, metrics);
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
    const membershipB = await prisma.organizationMembership.create({
      data: { organizationId: orgB, userId, role: 'ADMIN' },
    });
    contextB = new OrganizationContext(orgB, membershipB.id, userId, 'ADMIN');
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
      expectedInventoryUnit: 'KG',
      farmId: farmA,
      inventoryItemId: item,
      quantity: new Prisma.Decimal('10'),
      reason: 'RECEIPT',
      occurredAt,
    });
  });

  const post = (deathCount: number, farmId = farmA, flockId = flockA) =>
    mortality.post(context, farmId, { flockId, deathCount, occurredAt });

  async function postSaleBirds(
    birdCount: number,
    flockId = flockA,
    farmId = farmA,
    scopedContext = context,
  ) {
    const prisma = database.prisma;
    const product = await prisma.salesProduct.create({
      data: {
        organizationId: scopedContext.organizationId,
        code: randomUUID(),
        name: 'Poultry',
        kind: 'POULTRY',
        unit: 'EACH',
      },
    });
    const customer = await prisma.customer.create({
      data: {
        organizationId: scopedContext.organizationId,
        code: randomUUID(),
        type: 'INDIVIDUAL',
        name: 'Customer',
      },
    });
    const source = await prisma.poultryProductSource.create({
      data: {
        organizationId: scopedContext.organizationId,
        productId: product.id,
        farmId,
        flockId,
        actorUserId: scopedContext.userId,
      },
    });
    const order = await prisma.order.create({
      data: {
        organizationId: scopedContext.organizationId,
        customerId: customer.id,
        code: randomUUID(),
        actorUserId: scopedContext.userId,
        customerCode: customer.code,
        customerName: customer.name,
        saleType: 'CASH',
      },
    });
    const line = await prisma.orderLine.create({
      data: {
        organizationId: scopedContext.organizationId,
        orderId: order.id,
        lineNumber: 1,
        productId: product.id,
        productCode: product.code,
        productName: product.name,
        kind: 'POULTRY',
        unit: 'EACH',
        orderedQuantity: birdCount,
        unitPrice: '1.0000',
      },
    });
    const confirmedOrder = await prisma.order.update({
      where: { id: order.id },
      data: { commercialState: 'CONFIRMED', version: { increment: 1 } },
    });
    await prisma.$transaction(async (tx) => {
      await lockMutation(tx, scopedContext, {
        command: { farmId, operation: 'POST', key: randomUUID() },
        orderId: order.id,
        definitions: {
          sales_products: [{ id: product.id }],
          poultry_product_sources: [{ id: source.id }],
        },
        flocks: [{ farmId, flockId }],
      });
      const flock = await tx.flock.findFirstOrThrow({
        where: {
          id: flockId,
          organizationId: scopedContext.organizationId,
          farmId,
        },
      });
      const history = await effectivePopulation(tx, {
        organizationId: scopedContext.organizationId,
        farmId,
        flockId,
      });
      calculateFlockPopulation(
        flock.startingBirdCount,
        history.mortality,
        history.fulfilledBirds.plus(birdCount),
        {
          code: 'FLOCK_OVER_MORTALITY',
          message: 'Sale exceeds remaining live population',
        },
      );
      const event = await tx.fulfilment.create({
        data: {
          organizationId: scopedContext.organizationId,
          farmId,
          orderId: order.id,
          code: randomUUID(),
          actorUserId: scopedContext.userId,
          occurredAt,
          kind: 'POSTING',
        },
      });
      const allocation = await tx.fulfilmentLine.create({
        data: {
          organizationId: scopedContext.organizationId,
          farmId,
          orderId: order.id,
          fulfilmentId: event.id,
          orderLineId: line.id,
          kind: 'POULTRY',
          unit: 'EACH',
          quantity: birdCount,
          sourceCode: 'FLK',
          flockId,
          occurredAt,
        },
      });
      await tx.flockSaleDepletion.create({
        data: {
          organizationId: scopedContext.organizationId,
          farmId,
          flockId,
          fulfilmentLineId: allocation.id,
          birdCount,
          actorUserId: scopedContext.userId,
          occurredAt,
        },
      });
      await tx.fulfilmentCommand.create({
        data: {
          organizationId: scopedContext.organizationId,
          farmId,
          orderId: order.id,
          operation: 'POST',
          key: randomUUID(),
          requestHash: 'a'.repeat(64),
          hashVersion: 1,
          actorUserId: scopedContext.userId,
          fulfilmentId: event.id,
          orderVersion: confirmedOrder.version,
        },
      });
    });
  }

  async function reverseSaleBirds(
    birdCount: number,
    flockId = flockA,
    farmId = farmA,
  ) {
    const prisma = database.prisma;
    const original = await prisma.flockSaleDepletion.findFirstOrThrow({
      where: {
        organizationId: context.organizationId,
        farmId,
        flockId,
        reversesDepletionId: null,
      },
      include: { fulfilmentLine: { include: { fulfilment: true } } },
    });
    const order = await prisma.order.findFirstOrThrow({
      where: {
        organizationId: context.organizationId,
        fulfilments: { some: { id: original.fulfilmentLine.fulfilmentId } },
      },
    });
    await prisma.$transaction(async (tx) => {
      await lockMutation(tx, context, {
        command: { farmId, operation: 'REVERSE', key: randomUUID() },
        orderId: order.id,
        flocks: [{ farmId, flockId }],
      });
      const changedOrder = await tx.order.update({
        where: { id: order.id },
        data: { version: { increment: 1 } },
      });
      const event = await tx.fulfilment.create({
        data: {
          organizationId: context.organizationId,
          farmId,
          orderId: order.id,
          code: randomUUID(),
          actorUserId: context.userId,
          occurredAt,
          kind: 'REVERSAL',
          reversesFulfilmentId: original.fulfilmentLine.fulfilmentId,
          reason: 'Test full reversal',
          postingErrorConfirmed: true,
        },
      });
      const allocation = await tx.fulfilmentLine.create({
        data: {
          organizationId: context.organizationId,
          farmId,
          orderId: order.id,
          fulfilmentId: event.id,
          orderLineId: original.fulfilmentLine.orderLineId,
          kind: 'POULTRY',
          unit: 'EACH',
          quantity: birdCount,
          sourceCode: original.fulfilmentLine.sourceCode,
          flockId,
          occurredAt,
          reversesLineId: original.fulfilmentLine.id,
        },
      });
      await tx.flockSaleDepletion.create({
        data: {
          organizationId: context.organizationId,
          farmId,
          flockId,
          fulfilmentLineId: allocation.id,
          birdCount,
          actorUserId: context.userId,
          occurredAt,
          reversesDepletionId: original.id,
        },
      });
      await tx.fulfilmentCommand.create({
        data: {
          organizationId: context.organizationId,
          farmId,
          orderId: order.id,
          operation: 'REVERSE',
          key: randomUUID(),
          requestHash: 'b'.repeat(64),
          hashVersion: 1,
          actorUserId: context.userId,
          fulfilmentId: event.id,
          orderVersion: changedOrder.version,
        },
      });
    });
  }

  it('derives corrected mortality, live population and item-specific feed from history in a scoped snapshot', async () => {
    const cancelledDeath = await post(10);
    await mortality.reverse(context, farmA, flockA, cancelledDeath.id, {
      occurredAt,
    });
    await post(3);
    await post(2);
    const cancelledFeed = await feed.post(context, farmA, {
      expectedInventoryUnit: 'KG',
      flockId: flockA,
      inventoryItemId: item,
      quantity: new Prisma.Decimal('1.125'),
      occurredAt,
    });
    await feed.reverse(context, farmA, cancelledFeed.id, { occurredAt });
    await feed.post(context, farmA, {
      expectedInventoryUnit: 'KG',
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
      expectedInventoryUnit: 'EACH',
      farmId: farmA,
      inventoryItemId: other.id,
      quantity: new Prisma.Decimal('10'),
      reason: 'RECEIPT',
      occurredAt,
    });
    await feed.post(context, farmA, {
      expectedInventoryUnit: 'EACH',
      flockId: flockA,
      inventoryItemId: other.id,
      quantity: new Prisma.Decimal('3'),
      occurredAt,
    });
    const result = await metrics.get(context, farmA, flockA, '2026-11-15');
    expect(result).toMatchObject({
      startingBirdCount: 100,
      cumulativeMortality: 5,
      effectiveFulfilledBirdCount: 0,
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

  it('derives poultry depletion separately, restores it on full reversal, and preserves the M4 mortality percentage', async () => {
    await postSaleBirds(40);
    await post(20);
    expect(
      await metrics.get(context, farmA, flockA, '2026-11-15'),
    ).toMatchObject({
      startingBirdCount: 100,
      cumulativeMortality: 20,
      effectiveFulfilledBirdCount: 40,
      liveBirdCount: 40,
    });
    const result = await metrics.get(context, farmA, flockA, '2026-11-15');
    expect(result.mortalityPercentage.toString()).toBe('20');
    await reverseSaleBirds(40);
    expect(
      await metrics.get(context, farmA, flockA, '2026-11-15'),
    ).toMatchObject({
      cumulativeMortality: 20,
      effectiveFulfilledBirdCount: 0,
      liveBirdCount: 80,
    });
    expect(
      (
        await metrics.get(context, farmA, flockA, '2026-11-15')
      ).mortalityPercentage.toString(),
    ).toBe('20');
    await postSaleBirds(50);
    expect(
      await metrics.get(context, farmA, flockA, '2026-11-15'),
    ).toMatchObject({
      cumulativeMortality: 20,
      effectiveFulfilledBirdCount: 50,
      liveBirdCount: 30,
    });
  });

  it('rejects baseline reduction below existing sales depletion and isolates sales by organization and farm', async () => {
    await postSaleBirds(70);
    await expect(
      flocks.update(context, farmA, flockA, { startingBirdCount: 60 }),
    ).rejects.toMatchObject({
      code: 'FLOCK_OVER_MORTALITY',
    });
    expect(
      await metrics.get(context, farmA, flockA, '2026-11-15'),
    ).toMatchObject({
      effectiveFulfilledBirdCount: 70,
      liveBirdCount: 30,
    });
    await postSaleBirds(10, flockA2, farmA2);
    await postSaleBirds(90, flockA2, farmA2);
    await postSaleBirds(15, flockB, farmB, contextB);
    expect(
      await metrics.get(context, farmA, flockA, '2026-11-15'),
    ).toMatchObject({ effectiveFulfilledBirdCount: 70 });
    expect(
      await metrics.get(context, farmA2, flockA2, '2026-11-15'),
    ).toMatchObject({ effectiveFulfilledBirdCount: 100, liveBirdCount: 0 });
    expect(
      await metrics.get(contextB, farmB, flockB, '2026-11-15'),
    ).toMatchObject({ effectiveFulfilledBirdCount: 15 });
    await expect(
      metrics.get(context, farmB, flockB, '2026-11-15'),
    ).rejects.toMatchObject({ code: 'FLOCK_NOT_FOUND' });
  });

  it('serializes mortality against a concurrent sale-ledger writer using the shared flock lock', async () => {
    const product = await database.prisma.salesProduct.create({
      data: {
        organizationId: context.organizationId,
        code: randomUUID(),
        name: 'Poultry',
        kind: 'POULTRY',
        unit: 'EACH',
      },
    });
    const customer = await database.prisma.customer.create({
      data: {
        organizationId: context.organizationId,
        code: randomUUID(),
        type: 'INDIVIDUAL',
        name: 'Customer',
      },
    });
    const source = await database.prisma.poultryProductSource.create({
      data: {
        organizationId: context.organizationId,
        productId: product.id,
        farmId: farmA,
        flockId: flockA,
        actorUserId: context.userId,
      },
    });
    const order = await database.prisma.order.create({
      data: {
        organizationId: context.organizationId,
        customerId: customer.id,
        code: randomUUID(),
        actorUserId: context.userId,
        customerCode: customer.code,
        customerName: customer.name,
        saleType: 'CASH',
      },
    });
    const line = await database.prisma.orderLine.create({
      data: {
        organizationId: context.organizationId,
        orderId: order.id,
        lineNumber: 1,
        productId: product.id,
        productCode: product.code,
        productName: product.name,
        kind: 'POULTRY',
        unit: 'EACH',
        orderedQuantity: 70,
        unitPrice: '1.0000',
      },
    });
    const confirmedOrder = await database.prisma.order.update({
      where: { id: order.id },
      data: { commercialState: 'CONFIRMED', version: { increment: 1 } },
    });
    let release!: () => void;
    let acquired!: (pid: number) => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const pidReady = new Promise<number>((resolve) => {
      acquired = resolve;
    });
    const sale = database.prisma.$transaction(async (tx) => {
      await lockMutation(tx, context, {
        command: { farmId: farmA, operation: 'POST', key: randomUUID() },
        orderId: order.id,
        definitions: {
          sales_products: [{ id: product.id }],
          poultry_product_sources: [{ id: source.id }],
        },
        flocks: [{ farmId: farmA, flockId: flockA }],
      });
      const [backend] = await tx.$queryRaw<
        { pid: number }[]
      >`SELECT pg_backend_pid() AS pid`;
      acquired(backend!.pid);
      await held;
      const event = await tx.fulfilment.create({
        data: {
          organizationId: context.organizationId,
          farmId: farmA,
          orderId: order.id,
          code: randomUUID(),
          actorUserId: context.userId,
          occurredAt,
          kind: 'POSTING',
        },
      });
      const allocation = await tx.fulfilmentLine.create({
        data: {
          organizationId: context.organizationId,
          farmId: farmA,
          orderId: order.id,
          fulfilmentId: event.id,
          orderLineId: line.id,
          kind: 'POULTRY',
          unit: 'EACH',
          quantity: 70,
          sourceCode: 'FLK-1',
          flockId: flockA,
          occurredAt,
        },
      });
      await tx.flockSaleDepletion.create({
        data: {
          organizationId: context.organizationId,
          farmId: farmA,
          flockId: flockA,
          fulfilmentLineId: allocation.id,
          birdCount: 70,
          actorUserId: context.userId,
          occurredAt,
        },
      });
      await tx.fulfilmentCommand.create({
        data: {
          organizationId: context.organizationId,
          farmId: farmA,
          orderId: order.id,
          operation: 'POST',
          key: randomUUID(),
          requestHash: 'c'.repeat(64),
          hashVersion: 1,
          actorUserId: context.userId,
          fulfilmentId: event.id,
          orderVersion: confirmedOrder.version,
        },
      });
    });
    void sale.catch(() => {});
    const holderPid = await pidReady;
    const pendingMortality = post(31);
    void pendingMortality.catch(() => {});
    const deadline = Date.now() + 5000;
    let blocked = false;
    while (Date.now() < deadline) {
      const result = await database.prisma.$queryRaw<
        { waiting: boolean }[]
      >`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE ${holderPid} = ANY(pg_blocking_pids(pid))) AS waiting`;
      if (result[0]!.waiting) {
        blocked = true;
        break;
      }
    }
    release();
    await sale;
    expect(blocked).toBe(true);
    await expect(pendingMortality).rejects.toMatchObject({
      code: 'FLOCK_OVER_MORTALITY',
    });
    expect(
      await database.prisma.mortalityEvent.count({
        where: { organizationId: context.organizationId },
      }),
    ).toBe(0);
    expect(
      await metrics.get(context, farmA, flockA, '2026-11-15'),
    ).toMatchObject({ effectiveFulfilledBirdCount: 70, liveBirdCount: 30 });
  });
});
