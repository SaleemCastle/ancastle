import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import {
  customerOrderHistoryResponseSchema,
  fulfilmentCommandResponseSchema,
  fulfilmentListResponseSchema,
  type PostFulfilmentInput,
} from '@ancastle/validation';
import type { CustomerOrderHistoryEntry, Order } from '@ancastle/types';
import { temporaryDatabase } from '../../test/temporary-database.js';
import { DatabaseModule } from '../../database/database.module.js';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { HttpExceptionFilter } from '../../common/filters/http-exception.filter.js';
import { TokenService } from '../auth/token.service.js';
import { AuthorizationService } from '../authorization/authorization.service.js';
import { FarmAccessService } from '../authorization/farm-access.service.js';
import { OrganizationContext } from '../authorization/organization-context.js';
import { InventoryStockService } from '../inventory/inventory-stock.service.js';
import { MortalityService } from '../poultry/mortality.service.js';
import { FeedUsageService } from '../poultry/feed-usage.service.js';
import { effectivePopulation } from '../poultry/poultry-history.js';
import { SalesOrdersModule } from '../sales-orders/sales-orders.module.js';
import { SalesOrdersService } from '../sales-orders/sales-orders.service.js';
import { CustomersModule } from '../customers/customers.module.js';
import { FulfilmentActivationService } from './fulfilment-activation.service.js';
import { FulfilmentsModule } from './fulfilments.module.js';
import { FulfilmentsService } from './fulfilments.service.js';

function barrier<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('Atomic fulfilment API and concurrency (PostgreSQL)', () => {
  let database: Awaited<ReturnType<typeof temporaryDatabase>>;
  let prisma: PrismaService, app: INestApplication;
  let service: FulfilmentsService,
    orders: SalesOrdersService,
    stock: InventoryStockService;
  let farms: FarmAccessService;
  const authorization = new AuthorizationService();
  const activation = new FulfilmentActivationService();
  let context: OrganizationContext,
    staff: OrganizationContext,
    manager: OrganizationContext;
  let farmId: string,
    secondFarm: string,
    flockId: string,
    secondFlock: string,
    itemId: string,
    poultryId: string,
    produceId: string,
    customerId: string;
  let adminToken: string, staffToken: string, managerToken: string;
  const occurredAt = '2026-11-15T12:00:00.000Z';
  const api = () => request(app.getHttpServer());
  const route = (farm = farmId) =>
    `/api/organizations/${context.organizationId}/farms/${farm}`;
  const customerHistoryRoute = (
    customer = customerId,
    organization = context.organizationId,
  ) => `/api/organizations/${organization}/customers/${customer}/orders`;
  const body = (
    order: Order,
    kind: 'PRODUCE' | 'POULTRY' = 'PRODUCE',
    quantity = '3',
  ): PostFulfilmentInput => ({
    expectedOrderVersion: order.version,
    occurredAt,
    allocations: [
      kind === 'PRODUCE'
        ? {
            kind,
            orderLineId: order.lines.find((l) => l.kind === kind)!.id,
            inventoryItemId: itemId,
            quantity,
          }
        : {
            kind,
            orderLineId: order.lines.find((l) => l.kind === kind)!.id,
            flockId,
            quantity,
          },
    ],
  });
  const reversal = (version: number) => ({
    expectedOrderVersion: version,
    occurredAt,
    reason: 'Recorded in error; no handover occurred',
    postingErrorConfirmed: true as const,
  });
  async function order(
    kind: 'PRODUCE' | 'POULTRY' | 'MIXED' = 'PRODUCE',
    quantity = '10',
  ) {
    const draft = await orders.create(context, {
      customerId,
      currency: 'JMD',
      terms: { saleType: 'CASH', creditTermDays: null },
      lines: [
        ...(kind !== 'POULTRY'
          ? [
              {
                productId: produceId,
                expectedProduct: {
                  kind: 'PRODUCE' as const,
                  unit: 'KG' as const,
                  inventoryItemId: itemId,
                },
                quantity,
                unitPrice: '2',
              },
            ]
          : []),
        ...(kind !== 'PRODUCE'
          ? [
              {
                productId: poultryId,
                expectedProduct: {
                  kind: 'POULTRY' as const,
                  unit: 'EACH' as const,
                },
                quantity,
                unitPrice: '10',
              },
            ]
          : []),
      ],
    });
    return orders.confirm(context, draft.id, {
      expectedOrderVersion: draft.version,
    });
  }
  async function draftOrder(kind: 'PRODUCE' | 'POULTRY' | 'MIXED' = 'PRODUCE') {
    return orders.create(context, {
      customerId,
      currency: 'JMD',
      terms: { saleType: 'CREDIT', creditTermDays: 30 },
      lines: [
        ...(kind !== 'POULTRY'
          ? [
              {
                productId: produceId,
                expectedProduct: {
                  kind: 'PRODUCE' as const,
                  unit: 'KG' as const,
                  inventoryItemId: itemId,
                },
                quantity: '10',
                unitPrice: '2.1250',
              },
            ]
          : []),
        ...(kind !== 'PRODUCE'
          ? [
              {
                productId: poultryId,
                expectedProduct: {
                  kind: 'POULTRY' as const,
                  unit: 'EACH' as const,
                },
                quantity: '10',
                unitPrice: '10.0000',
              },
            ]
          : []),
      ],
    });
  }
  const post = (
    order: Order,
    input = body(order),
    key = randomUUID(),
    farm = farmId,
  ) => service.post(context, farm, order.id, key, input);
  async function counts() {
    const where = { organizationId: context.organizationId };
    return {
      batches: await prisma.fulfilment.count({ where }),
      lines: await prisma.fulfilmentLine.count({ where }),
      depletions: await prisma.flockSaleDepletion.count({ where }),
      receipts: await prisma.fulfilmentCommand.count({ where }),
      movements: await prisma.inventoryMovement.count({ where }),
    };
  }
  const balance = () => stock.getStockOnHand(context, farmId, itemId);
  const population = () =>
    prisma.$transaction((tx) =>
      effectivePopulation(tx, {
        organizationId: context.organizationId,
        farmId,
        flockId,
      }),
    );

  beforeAll(async () => {
    vi.stubEnv('JWT_SECRET', 'fulfilment-integration-secret-long-enough');
    vi.stubEnv('SALES_FULFILMENT_ENABLED', 'true');
    database = await temporaryDatabase();
    prisma = database.prisma;
    const module = await Test.createTestingModule({
      imports: [
        DatabaseModule,
        SalesOrdersModule,
        FulfilmentsModule,
        CustomersModule,
      ],
    })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
    service = module.get(FulfilmentsService);
    orders = module.get(SalesOrdersService);
    stock = module.get(InventoryStockService);
    farms = module.get(FarmAccessService);
  }, 120_000);
  afterAll(async () => {
    await app?.close();
    await database?.dispose();
    vi.unstubAllEnvs();
  });
  beforeEach(async () => {
    vi.stubEnv('SALES_FULFILMENT_ENABLED', 'true');
    const org = await prisma.organization.create({
      data: { name: 'Sales', slug: randomUUID() },
    });
    async function member(role: 'ADMIN' | 'STAFF' | 'MANAGER') {
      const user = await prisma.user.create({
        data: { email: `${randomUUID()}@example.com`, passwordHash: 'unused' },
      });
      const membership = await prisma.organizationMembership.create({
        data: { organizationId: org.id, userId: user.id, role },
      });
      return new OrganizationContext(org.id, membership.id, user.id, role);
    }
    context = await member('ADMIN');
    staff = await member('STAFF');
    manager = await member('MANAGER');
    const tokens = app.get(TokenService);
    adminToken = await tokens.createAccessToken(
      context.userId,
      'admin@example.com',
    );
    staffToken = await tokens.createAccessToken(
      staff.userId,
      'staff@example.com',
    );
    managerToken = await tokens.createAccessToken(
      manager.userId,
      'manager@example.com',
    );
    farmId = (
      await prisma.farm.create({
        data: { organizationId: org.id, code: 'NORTH', name: 'North' },
      })
    ).id;
    secondFarm = (
      await prisma.farm.create({
        data: { organizationId: org.id, code: 'SOUTH', name: 'South' },
      })
    ).id;
    await prisma.farmAccessAssignment.createMany({
      data: [staff, manager].map((m) => ({
        organizationId: org.id,
        farmId,
        membershipId: m.membershipId,
      })),
    });
    customerId = (
      await prisma.customer.create({
        data: {
          organizationId: org.id,
          code: 'CUS-1',
          name: 'Market',
          type: 'BUSINESS',
        },
      })
    ).id;
    itemId = (
      await prisma.inventoryItem.create({
        data: {
          organizationId: org.id,
          code: 'INV-1',
          name: 'Pumpkin',
          unit: 'KG',
          category: 'PRODUCE',
        },
      })
    ).id;
    produceId = (
      await prisma.salesProduct.create({
        data: {
          organizationId: org.id,
          code: 'PRD-1',
          name: 'Pumpkin',
          kind: 'PRODUCE',
          unit: 'KG',
          inventoryItemId: itemId,
        },
      })
    ).id;
    poultryId = (
      await prisma.salesProduct.create({
        data: {
          organizationId: org.id,
          code: 'PRD-2',
          name: 'Birds',
          kind: 'POULTRY',
          unit: 'EACH',
        },
      })
    ).id;
    for (const farm of [farmId, secondFarm]) {
      const flock = await prisma.flock.create({
        data: {
          organizationId: org.id,
          farmId: farm,
          code: `FLK-${farm}`,
          name: 'Birds',
          startingBirdCount: 10,
          placementDate: new Date(occurredAt),
        },
      });
      if (farm === farmId) flockId = flock.id;
      else secondFlock = flock.id;
      await prisma.poultryProductSource.create({
        data: {
          organizationId: org.id,
          farmId: farm,
          productId: poultryId,
          flockId: flock.id,
          actorUserId: context.userId,
        },
      });
      await stock.postMovement(context, {
        farmId: farm,
        inventoryItemId: itemId,
        expectedInventoryUnit: 'KG',
        quantity: new Prisma.Decimal(10),
        reason: 'RECEIPT',
        occurredAt: new Date(occurredAt),
      });
    }
  });

  it.each(['PRODUCE', 'POULTRY', 'MIXED'] as const)(
    'commits %s allocations and matching physical ledgers once',
    async (kind) => {
      const o = await order(kind);
      const input = body(o, kind === 'POULTRY' ? 'POULTRY' : 'PRODUCE', '2');
      if (kind === 'MIXED')
        input.allocations.push(...body(o, 'POULTRY', '3').allocations);
      const response = await api()
        .post(`${route()}/orders/${o.id}/fulfilments`)
        .set('Authorization', `Bearer ${staffToken}`)
        .set('Idempotency-Key', randomUUID())
        .send(input)
        .expect(201);
      expect(
        fulfilmentCommandResponseSchema.safeParse(response.body).success,
      ).toBe(true);
      expect(response.body.data.orderVersion).toBe(3);
      expect((await balance()).toString()).toBe(
        kind === 'POULTRY' ? '10' : '8',
      );
      const p = await population();
      expect(p.fulfilledBirds.toString()).toBe(
        kind === 'PRODUCE' ? '0' : kind === 'POULTRY' ? '2' : '3',
      );
      expect(p.mortality.toString()).toBe('0');
      expect(
        await prisma.orderEvent.count({
          where: { organizationId: context.organizationId },
        }),
      ).toBe(2);
      expect(await counts()).toMatchObject({
        batches: 1,
        receipts: 1,
        lines: kind === 'MIXED' ? 2 : 1,
      });
      // This schema has no invoice/payment models and posting adds no commercial event.
      expect(Object.keys(prisma)).not.toContain('invoice');
      expect(Object.keys(prisma)).not.toContain('payment');
    },
  );

  it('fulfils one order at two farms and redacts all sources from commercial reads', async () => {
    const o = await order('MIXED');
    const sharedKey = randomUUID();
    const first = body(o, 'PRODUCE', '4');
    first.allocations.push(...body(o, 'POULTRY', '3').allocations);
    const result = await post(o, first, sharedKey);
    const next = { ...o, version: result.receipt.orderVersion };
    const second = body(next, 'PRODUCE', '6');
    second.allocations.push({
      kind: 'POULTRY',
      orderLineId: o.lines[1]!.id,
      flockId: secondFlock,
      quantity: '7',
    });
    await post(next, second, sharedKey, secondFarm);
    const response = await api()
      .get(`/api/organizations/${context.organizationId}/orders/${o.id}`)
      .set('Authorization', `Bearer ${staffToken}`)
      .expect(200);
    expect(response.body.data.fulfilmentProgress).toBe('FULFILLED');
    expect(
      response.body.data.lines.map(
        (l: { fulfilledQuantity: string }) => l.fulfilledQuantity,
      ),
    ).toEqual(['10', '10']);
    expect(response.body.data.sourceDetails).toEqual({
      visibility: 'REDACTED',
    });
    for (const secret of [secondFarm, secondFlock, itemId, flockId])
      expect(JSON.stringify(response.body)).not.toContain(secret);
    const history = await api()
      .get(`${route()}/fulfilments`)
      .set('Authorization', `Bearer ${staffToken}`)
      .expect(200);
    expect(fulfilmentListResponseSchema.safeParse(history.body).success).toBe(
      true,
    );
    expect(history.body.meta.totalItems).toBe(1);
    expect(history.body.data[0].farmId).toBe(farmId);
    await api()
      .get(`${route(secondFarm)}/fulfilments`)
      .set('Authorization', `Bearer ${staffToken}`)
      .expect(403);
    const foreignBatch = await prisma.fulfilment.findFirstOrThrow({
      where: { organizationId: context.organizationId, farmId: secondFarm },
    });
    await api()
      .get(`${route()}/fulfilments/${foreignBatch.id}`)
      .set('Authorization', `Bearer ${staffToken}`)
      .expect(404);
  });

  it.each(['PRODUCE', 'POULTRY'] as const)(
    'rejects insufficient %s and leaves no receipt or partial effects',
    async (kind) => {
      const o = await order('MIXED', '20');
      const input = body(o, kind, '11');
      const before = await counts();
      await expect(post(o, input)).rejects.toThrow(
        kind === 'PRODUCE' ? 'negative stock' : 'Insufficient live birds',
      );
      expect(await counts()).toEqual(before);
      expect((await balance()).toString()).toBe('10');
      expect((await population()).fulfilledBirds.toString()).toBe('0');
    },
  );

  it('rolls back an earlier produce ISSUE and poultry depletion when a later source fails', async () => {
    // Another line using the same produce stock is a distinct allocation.
    // Use an ordinary draft rather than mutate confirmed history.
    const draft = await orders.create(context, {
      customerId,
      currency: 'JMD',
      terms: { saleType: 'CASH', creditTermDays: null },
      lines: [
        {
          productId: poultryId,
          expectedProduct: { kind: 'POULTRY', unit: 'EACH' },
          quantity: '20',
          unitPrice: '1',
        },
        ...[1, 2].map(() => ({
          productId: produceId,
          expectedProduct: {
            kind: 'PRODUCE' as const,
            unit: 'KG' as const,
            inventoryItemId: itemId,
          },
          quantity: '20',
          unitPrice: '1',
        })),
      ],
    });
    const mixed = await orders.confirm(context, draft.id, {
      expectedOrderVersion: draft.version,
    });
    const fail: PostFulfilmentInput = {
      expectedOrderVersion: mixed.version,
      occurredAt,
      allocations: [
        {
          kind: 'POULTRY',
          orderLineId: mixed.lines[0]!.id,
          flockId,
          quantity: '3',
        },
        {
          kind: 'PRODUCE',
          orderLineId: mixed.lines[1]!.id,
          inventoryItemId: itemId,
          quantity: '3',
        },
        {
          kind: 'PRODUCE',
          orderLineId: mixed.lines[2]!.id,
          inventoryItemId: itemId,
          quantity: '8',
        },
      ],
    };
    const before = await counts();
    const key = randomUUID();
    await expect(post(mixed, fail, key)).rejects.toThrow('negative stock');
    expect(await counts()).toEqual(before);
    expect((await orders.get(context, mixed.id)).version).toBe(mixed.version);
    await stock.postMovement(context, {
      farmId,
      inventoryItemId: itemId,
      expectedInventoryUnit: 'KG',
      quantity: new Prisma.Decimal(1),
      reason: 'RECEIPT',
      occurredAt: new Date(occurredAt),
    });
    await post(mixed, fail, key); // failed command did not consume its key
    expect((await balance()).isZero()).toBe(true);
  });

  it('aggregates demand and flock consumption across allocations before checking limits', async () => {
    const o = await order('POULTRY', '5');
    const extra = await prisma.flock.create({
      data: {
        organizationId: context.organizationId,
        farmId,
        code: 'OTHER',
        name: 'Other',
        startingBirdCount: 10,
        placementDate: new Date(occurredAt),
      },
    });
    await prisma.poultryProductSource.create({
      data: {
        organizationId: context.organizationId,
        farmId,
        productId: poultryId,
        flockId: extra.id,
        actorUserId: context.userId,
      },
    });
    const input = body(o, 'POULTRY', '3');
    input.allocations.push({
      kind: 'POULTRY',
      orderLineId: o.lines[0]!.id,
      flockId: extra.id,
      quantity: '3',
    });
    await expect(post(o, input)).rejects.toThrow('remaining order demand');
    expect(await counts()).toMatchObject({ batches: 0, receipts: 0 });
    input.allocations[1]!.quantity = '2';
    const accepted = await post(o, input);
    expect(accepted.receipt.fulfilment.lines).toHaveLength(2);
    expect((await orders.get(context, o.id)).fulfilmentProgress).toBe(
      'FULFILLED',
    );
  });

  it('replays canonical payloads after cancellation, reversal and source deactivation; conflicts stay safe', async () => {
    const o = await order('MIXED');
    const key = randomUUID();
    const input = body(o, 'PRODUCE', '2.000');
    input.allocations.push(...body(o, 'POULTRY', '2').allocations);
    const first = await post(o, input, key);
    await orders.cancel(context, o.id, {
      expectedOrderVersion: first.receipt.orderVersion,
      reason: 'Cancel remainder',
    });
    await service.reverse(
      context,
      farmId,
      first.receipt.fulfilment.id,
      randomUUID(),
      reversal(4),
    );
    await prisma.salesProduct.update({
      where: { id: produceId },
      data: { isActive: false },
    });
    const equivalent = {
      ...input,
      occurredAt: '2026-11-15T07:00:00-05:00',
      allocations: [...input.allocations]
        .reverse()
        .map((a) => ({ ...a, quantity: '2' })),
    };
    expect(await post(o, equivalent, key)).toEqual(first);
    await expect(
      post(o, { ...input, note: 'Different intent' }, key),
    ).rejects.toThrow('another command');
    await expect(service.post(staff, farmId, o.id, key, input)).rejects.toThrow(
      'another command',
    );
    await prisma.farmAccessAssignment.updateMany({
      where: { membershipId: staff.membershipId },
      data: { isActive: false },
    });
    await expect(service.post(staff, farmId, o.id, key, input)).rejects.toThrow(
      'permission',
    );
    expect(await counts()).toMatchObject({ batches: 2, receipts: 2 });
  });

  it('reverses the full mixed batch once, preserves history, and permits correction after cancellation', async () => {
    const o = await order('MIXED');
    const input = body(o);
    input.allocations.push(...body(o, 'POULTRY').allocations);
    const posted = await post(o, input);
    await orders.cancel(context, o.id, {
      expectedOrderVersion: 3,
      reason: 'No more demand',
    });
    await prisma.flock.update({
      where: { id: flockId },
      data: { isActive: false },
    });
    await prisma.inventoryItem.update({
      where: { id: itemId },
      data: { isActive: false },
    });
    const key = randomUUID();
    const reverseInput = reversal(4);
    const result = await service.reverse(
      context,
      farmId,
      posted.receipt.fulfilment.id,
      key,
      reverseInput,
    );
    expect(result.receipt.fulfilment.kind).toBe('REVERSAL');
    expect(
      await service.reverse(
        context,
        farmId,
        posted.receipt.fulfilment.id,
        key,
        reverseInput,
      ),
    ).toEqual(result);
    expect((await balance()).toString()).toBe('10');
    expect((await population()).fulfilledBirds.toString()).toBe('0');
    expect(
      await service.get(context, farmId, posted.receipt.fulfilment.id),
    ).toEqual(posted.receipt.fulfilment);
    await expect(
      service.reverse(
        context,
        farmId,
        posted.receipt.fulfilment.id,
        randomUUID(),
        reversal(5),
      ),
    ).rejects.toThrow('already been reversed');
    await expect(
      service.reverse(
        context,
        farmId,
        result.receipt.fulfilment.id,
        randomUUID(),
        reversal(5),
      ),
    ).rejects.toThrow('original postings');
    const cancelled = await orders.get(context, o.id);
    expect(cancelled.lines.map((l) => l.cancelledQuantity)).toEqual([
      '10',
      '10',
    ]);
    expect(cancelled.lines.map((l) => l.remainingQuantity)).toEqual(['0', '0']);
  });

  it('keeps original postings when cancelling partial demand and forbids further posting', async () => {
    const o = await order();
    const posted = await post(o);
    const cancelled = await orders.cancel(context, o.id, {
      expectedOrderVersion: 3,
      reason: 'Close remainder',
    });
    expect(cancelled.lines[0]).toMatchObject({
      fulfilledQuantity: '3',
      cancelledQuantity: '7',
      remainingQuantity: '0',
    });
    expect(
      await service.get(context, farmId, posted.receipt.fulfilment.id),
    ).toEqual(posted.receipt.fulfilment);
    await expect(post({ ...o, version: 4 })).rejects.toThrow(
      'state transition',
    );
    expect(await counts()).toMatchObject({ batches: 1, receipts: 1 });
    expect((await balance()).toString()).toBe('7');
  });

  it('rejects attempts to mutate or delete committed history and seals against extra allocations', async () => {
    const o = await order('POULTRY');
    const posted = await post(o, body(o, 'POULTRY'));
    const id = posted.receipt.fulfilment.id;
    await expect(
      prisma.fulfilment.update({ where: { id }, data: { note: 'rewrite' } }),
    ).rejects.toThrow();
    await expect(prisma.fulfilment.delete({ where: { id } })).rejects.toThrow();
    await expect(
      prisma.fulfilmentLine.deleteMany({ where: { fulfilmentId: id } }),
    ).rejects.toThrow();
    await expect(
      prisma.flockSaleDepletion.deleteMany({
        where: { organizationId: context.organizationId },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.fulfilmentCommand.deleteMany({ where: { fulfilmentId: id } }),
    ).rejects.toThrow();
    const line = await prisma.fulfilmentLine.findFirstOrThrow({
      where: { fulfilmentId: id },
    });
    await expect(
      prisma.fulfilmentLine.create({
        data: { ...line, id: randomUUID(), flockId: secondFlock },
      }),
    ).rejects.toThrow();
    expect(await service.get(context, farmId, id)).toEqual(
      posted.receipt.fulfilment,
    );
  });

  it('enforces authentication, farm grants, inactive states and organization-specific permissions', async () => {
    const o = await order();
    const input = body(o);
    const url = `${route()}/orders/${o.id}/fulfilments`;
    await api().post(url).send(input).expect(401);
    await api()
      .post(`${route(secondFarm)}/orders/${o.id}/fulfilments`)
      .set('Authorization', `Bearer ${staffToken}`)
      .set('Idempotency-Key', randomUUID())
      .send(input)
      .expect(403);
    const first = await post(o);
    for (const token of [staffToken, managerToken])
      await api()
        .post(`${route()}/fulfilments/${first.receipt.fulfilment.id}/reverse`)
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', randomUUID())
        .send(reversal(3))
        .expect(403);
    await prisma.organizationMembership.update({
      where: { id: staff.membershipId },
      data: { isActive: false },
    });
    await api()
      .post(url)
      .set('Authorization', `Bearer ${staffToken}`)
      .set('Idempotency-Key', randomUUID())
      .send(input)
      .expect(403);
    await prisma.user.update({
      where: { id: context.userId },
      data: { isActive: false },
    });
    await api()
      .get(`${route()}/fulfilments`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(401);
    await expect(post(o)).rejects.toThrow('permission'); // internal caller also checks current user
  });

  it('does not authorize foreign order/source IDs or leak source identities through errors', async () => {
    const o = await order('MIXED');
    const foreign = await prisma.organization.create({
      data: { name: 'Foreign', slug: randomUUID() },
    });
    await prisma.organizationMembership.create({
      data: {
        organizationId: foreign.id,
        userId: context.userId,
        role: 'STAFF',
      },
    });
    const f = await prisma.farm.create({
      data: { organizationId: foreign.id, name: 'Private', code: 'PRIVATE' },
    });
    const flock = await prisma.flock.create({
      data: {
        organizationId: foreign.id,
        farmId: f.id,
        name: 'Secret flock',
        code: 'SECRET-FLOCK',
        startingBirdCount: 10,
        placementDate: new Date(occurredAt),
      },
    });
    const input = body(o, 'POULTRY');
    input.allocations = [
      { ...input.allocations[0]!, kind: 'POULTRY', flockId: flock.id },
    ];
    const response = await api()
      .post(`${route()}/orders/${o.id}/fulfilments`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', randomUUID())
      .send(input)
      .expect(409);
    expect(JSON.stringify(response.body)).not.toContain(flock.id);
    expect(JSON.stringify(response.body)).not.toContain('SECRET');
    await api()
      .post(
        `/api/organizations/${foreign.id}/farms/${f.id}/orders/${o.id}/fulfilments`,
      )
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', randomUUID())
      .send(input)
      .expect(403);
    await expect(
      service.post(context, farmId, randomUUID(), randomUUID(), body(o)),
    ).rejects.toThrow('Order was not found');
    const ownOtherFarm = body(o, 'POULTRY');
    ownOtherFarm.allocations = [
      {
        kind: 'POULTRY',
        orderLineId: o.lines[1]!.id,
        flockId: secondFlock,
        quantity: '3',
      },
    ];
    await expect(post(o, ownOtherFarm)).rejects.toThrow(
      'source is unavailable',
    );
    expect(await counts()).toMatchObject({ batches: 0, receipts: 0 });
  });

  it.each(['false', undefined, 'TRUE', '1'])(
    'fails closed at both controller and internal writer for activation %s',
    async (setting) => {
      const o = await order();
      vi.stubEnv('SALES_FULFILMENT_ENABLED', setting);
      await expect(post(o)).rejects.toThrow('not enabled');
      await api()
        .post(`${route()}/orders/${o.id}/fulfilments`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('Idempotency-Key', randomUUID())
        .send({ ...body(o), enabled: true })
        .expect(400);
      await api()
        .post(`${route()}/orders/${o.id}/fulfilments`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('Idempotency-Key', randomUUID())
        .send(body(o))
        .expect(503);
      expect(await counts()).toMatchObject({ batches: 0, receipts: 0 });
    },
  );

  it('rejects malformed quantities, missing keys, payload authority and duplicate allocations', async () => {
    const o = await order('MIXED');
    const url = `${route()}/orders/${o.id}/fulfilments`;
    const input = body(o);
    for (const invalid of [
      { ...input, organizationId: context.organizationId },
      { ...input, farmId: secondFarm },
      { ...input, actorUserId: staff.userId },
      { ...input, allocations: [input.allocations[0], input.allocations[0]] },
      {
        ...input,
        allocations: [{ ...input.allocations[0], quantity: '1.0001' }],
      },
      {
        ...body(o, 'POULTRY'),
        allocations: [
          { ...body(o, 'POULTRY').allocations[0], quantity: '1.5' },
        ],
      },
    ])
      await api()
        .post(url)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('Idempotency-Key', randomUUID())
        .send(invalid)
        .expect(400);
    await api()
      .post(url)
      .set('Authorization', `Bearer ${adminToken}`)
      .send(input)
      .expect(400);
    await api()
      .post(url)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', 'invalid')
      .send(input)
      .expect(400);
    const posted = await post(o);
    await api()
      .post(`${route()}/fulfilments/${posted.receipt.fulfilment.id}/reverse`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({ ...reversal(3), postingErrorConfirmed: false })
      .expect(400);
  });

  it('aggregates one flock across different product lines before writing any depletion', async () => {
    const draft = await orders.create(context, {
      customerId,
      currency: 'JMD',
      terms: { saleType: 'CASH', creditTermDays: null },
      lines: [1, 2].map(() => ({
        productId: poultryId,
        expectedProduct: { kind: 'POULTRY', unit: 'EACH' },
        quantity: '10',
        unitPrice: '1',
      })),
    });
    const o = await orders.confirm(context, draft.id, {
      expectedOrderVersion: draft.version,
    });
    const input: PostFulfilmentInput = {
      expectedOrderVersion: o.version,
      occurredAt,
      allocations: o.lines.map((line) => ({
        kind: 'POULTRY',
        orderLineId: line.id,
        flockId,
        quantity: '6',
      })),
    };
    await expect(post(o, input)).rejects.toThrow('Insufficient live birds');
    expect(await counts()).toMatchObject({
      batches: 0,
      depletions: 0,
      receipts: 0,
    });
  });

  it.each([
    'CUSTOMER',
    'PRODUCT',
    'SOURCE',
    'FLOCK',
    'ITEM',
    'FARM',
    'ORGANIZATION',
  ] as const)('rejects inactive %s without partial effects', async (kind) => {
    const o = await order('MIXED');
    const input = body(o);
    input.allocations.push(...body(o, 'POULTRY').allocations);
    switch (kind) {
      case 'CUSTOMER':
        await prisma.customer.update({
          where: { id: customerId },
          data: { isActive: false },
        });
        break;
      case 'PRODUCT':
        await prisma.salesProduct.update({
          where: { id: produceId },
          data: { isActive: false },
        });
        break;
      case 'SOURCE':
        await prisma.poultryProductSource.updateMany({
          where: { organizationId: context.organizationId, farmId },
          data: { isActive: false },
        });
        break;
      case 'FLOCK':
        await prisma.flock.update({
          where: { id: flockId },
          data: { isActive: false },
        });
        break;
      case 'ITEM':
        await prisma.inventoryItem.update({
          where: { id: itemId },
          data: { isActive: false },
        });
        break;
      case 'FARM':
        await prisma.farm.update({
          where: { id: farmId },
          data: { isActive: false },
        });
        break;
      case 'ORGANIZATION':
        await prisma.organization.update({
          where: { id: context.organizationId },
          data: { isActive: false },
        });
        break;
    }
    const before = await counts();
    await expect(post(o, input)).rejects.toThrow();
    expect(await counts()).toEqual(before);
  });

  it('rejects draft posting and enforces whole-unit produce with authoritative units', async () => {
    const eachItem = await prisma.inventoryItem.create({
      data: {
        organizationId: context.organizationId,
        code: 'EACH-ITEM',
        name: 'Melons',
        unit: 'EACH',
        category: 'PRODUCE',
      },
    });
    const product = await prisma.salesProduct.create({
      data: {
        organizationId: context.organizationId,
        code: 'EACH-PRD',
        name: 'Melons',
        kind: 'PRODUCE',
        unit: 'EACH',
        inventoryItemId: eachItem.id,
      },
    });
    const draft = await orders.create(context, {
      customerId,
      currency: 'JMD',
      terms: { saleType: 'CASH', creditTermDays: null },
      lines: [
        {
          productId: product.id,
          expectedProduct: {
            kind: 'PRODUCE',
            unit: 'EACH',
            inventoryItemId: eachItem.id,
          },
          quantity: '10',
          unitPrice: '1',
        },
      ],
    });
    const input: PostFulfilmentInput = {
      expectedOrderVersion: draft.version,
      occurredAt,
      allocations: [
        {
          kind: 'PRODUCE',
          orderLineId: draft.lines[0]!.id,
          inventoryItemId: eachItem.id,
          quantity: '1.5',
        },
      ],
    };
    await expect(post(draft, input)).rejects.toThrow('state transition');
    const confirmed = await orders.confirm(context, draft.id, {
      expectedOrderVersion: draft.version,
    });
    await expect(
      post(confirmed, { ...input, expectedOrderVersion: confirmed.version }),
    ).rejects.toThrow('Whole units');
    expect(await counts()).toMatchObject({ batches: 0, receipts: 0 });
  });

  it('normalizes UUID case before rejecting duplicate sources', async () => {
    const o = await order();
    const input = body(o);
    input.allocations.push({
      kind: 'PRODUCE',
      orderLineId: o.lines[0]!.id.toUpperCase(),
      inventoryItemId: itemId.toUpperCase(),
      quantity: '1',
    });
    await expect(post(o, input)).rejects.toThrow('Duplicate');
    expect(await counts()).toMatchObject({ batches: 0, receipts: 0 });
  });

  // A real domain transaction pauses after its writes, before commit. The other
  // operation must appear in pg_blocking_pids before release, not merely race
  // by Promise.all scheduling. No production hook or timing sleep is needed.
  function holdCommit(commitFailure?: Error) {
    const acquired = barrier<number>(),
      release = barrier();
    const client = new Proxy(prisma, {
      get(target, prop, receiver) {
        if (prop === '$transaction')
          return (
            fn: (tx: Prisma.TransactionClient) => Promise<unknown>,
            options: { isolationLevel?: Prisma.TransactionIsolationLevel },
          ) =>
            target.$transaction(async (tx) => {
              const result = await fn(tx);
              const [row] = await tx.$queryRaw<
                { pid: number }[]
              >`SELECT pg_backend_pid() AS pid`;
              acquired.resolve(row!.pid);
              await release.promise;
              if (commitFailure) throw commitFailure;
              return result;
            }, options);
        return Reflect.get(target, prop, receiver);
      },
    });
    return {
      client,
      acquired: acquired.promise,
      release: () => release.resolve(),
    };
  }
  function writer(client: PrismaService) {
    return new FulfilmentsService(
      client,
      stock,
      farms,
      authorization,
      activation,
    );
  }
  async function blockedBy(pid: number) {
    const deadline = Date.now() + 2500;
    while (Date.now() < deadline) {
      const [row] = await prisma.$queryRaw<
        { waiting: boolean }[]
      >`SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE ${pid} = ANY(pg_blocking_pids(pid))) AS waiting`;
      if (row!.waiting) return;
    }
    throw new Error('Expected overlapping PostgreSQL lock wait');
  }
  async function overlapping<T, U>(
    first: (client: PrismaService) => Promise<T>,
    second: () => Promise<U>,
  ) {
    const hold = holdCommit();
    const winner = first(hold.client);
    // Observe failures immediately so a failing barrier does not mask a writer error.
    void winner.catch(() => {});
    const pid = await Promise.race([
      hold.acquired,
      winner.then(() => {
        throw new Error('Writer did not pause');
      }),
    ]);
    const waiting = second();
    void waiting.catch(() => {});
    try {
      await blockedBy(pid);
    } finally {
      hold.release();
    }
    return Promise.allSettled([winner, waiting]);
  }

  it.each(['PRODUCE', 'POULTRY'] as const)(
    'serializes competing fulfilments for %s availability',
    async (kind) => {
      const a = await order(kind),
        b = await order(kind);
      const result = await overlapping(
        (client) =>
          writer(client).post(
            context,
            farmId,
            a.id,
            randomUUID(),
            body(a, kind, '7'),
          ),
        () => post(b, body(b, kind, '7')),
      );
      expect(result.map((r) => r.status)).toEqual(['fulfilled', 'rejected']);
      expect(await counts()).toMatchObject({ batches: 1, receipts: 1 });
      if (kind === 'PRODUCE') expect((await balance()).toString()).toBe('3');
      else expect((await population()).fulfilledBirds.toString()).toBe('7');
    },
  );

  it('serializes concurrent identical keys and returns the same committed receipt', async () => {
    const o = await order();
    const key = randomUUID();
    const input = body(o);
    const result = await overlapping(
      (client) => writer(client).post(context, farmId, o.id, key, input),
      () => post(o, input, key),
    );
    expect(result[0]).toEqual(result[1]);
    expect(result[0]!.status).toBe('fulfilled');
    expect(await counts()).toMatchObject({ batches: 1, receipts: 1 });
  });

  it.each(['PRODUCE', 'POULTRY', 'MIXED'] as const)(
    'rolls back a sealed %s posting and reversal on failure before commit',
    async (kind) => {
      const o = await order(kind);
      const input = body(o, kind === 'POULTRY' ? 'POULTRY' : 'PRODUCE');
      if (kind === 'MIXED')
        input.allocations.push(...body(o, 'POULTRY').allocations);
      const before = await counts();
      const key = randomUUID();
      const failedPost = holdCommit(new Error('Simulated pre-commit failure'));
      const pending = writer(failedPost.client).post(
        context,
        farmId,
        o.id,
        key,
        input,
      );
      void pending.catch(() => {});
      await failedPost.acquired;
      failedPost.release();
      await expect(pending).rejects.toThrow('pre-commit failure');
      expect(await counts()).toEqual(before);
      const posted = await post(o, input, key);
      const afterPost = await counts();
      const reverseKey = randomUUID();
      const failedReverse = holdCommit(new Error('Simulated reversal failure'));
      const reversalPending = writer(failedReverse.client).reverse(
        context,
        farmId,
        posted.receipt.fulfilment.id,
        reverseKey,
        reversal(3),
      );
      void reversalPending.catch(() => {});
      await failedReverse.acquired;
      failedReverse.release();
      await expect(reversalPending).rejects.toThrow('reversal failure');
      expect(await counts()).toEqual(afterPost);
      expect((await balance()).toString()).toBe(
        kind === 'POULTRY' ? '10' : '7',
      );
      expect((await population()).fulfilledBirds.toString()).toBe(
        kind === 'PRODUCE' ? '0' : '3',
      );
      await service.reverse(
        context,
        farmId,
        posted.receipt.fulfilment.id,
        reverseKey,
        reversal(3),
      );
      expect((await balance()).toString()).toBe('10');
      expect((await population()).fulfilledBirds.toString()).toBe('0');
    },
  );

  it('conflicts a concurrent different payload on the same key without exposing the original', async () => {
    const o = await order();
    const key = randomUUID();
    const result = await overlapping(
      (client) => writer(client).post(context, farmId, o.id, key, body(o)),
      () => post(o, body(o, 'PRODUCE', '4'), key),
    );
    expect(result.map((r) => r.status)).toEqual(['fulfilled', 'rejected']);
    expect(await counts()).toMatchObject({ batches: 1, receipts: 1 });
    expect((await balance()).toString()).toBe('7');
  });

  it('serializes distinct keys against one order version and prevents excess demand', async () => {
    const o = await order();
    const result = await overlapping(
      (client) =>
        writer(client).post(
          context,
          farmId,
          o.id,
          randomUUID(),
          body(o, 'PRODUCE', '6'),
        ),
      () => post(o, body(o, 'PRODUCE', '6')),
    );
    expect(result.map((r) => r.status)).toEqual(['fulfilled', 'rejected']);
    await expect(
      post({ ...o, version: 3 }, body({ ...o, version: 3 }, 'PRODUCE', '5')),
    ).rejects.toThrow('remaining order demand');
    expect((await balance()).toString()).toBe('4');
  });

  it('serializes farm grant revocation against an in-flight fulfilment', async () => {
    const o = await order('PRODUCE');
    const hold = holdCommit();
    const posting = writer(hold.client).post(
      staff,
      farmId,
      o.id,
      randomUUID(),
      body(o, 'PRODUCE', '2'),
    );
    void posting.catch(() => {});
    const pid = await Promise.race([
      hold.acquired,
      posting.then(() => {
        throw new Error('Fulfilment did not pause before commit');
      }),
    ]);

    const revocation = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT "id" FROM "organizations"
        WHERE "id" = ${staff.organizationId}::uuid FOR UPDATE
      `;
      await tx.farmAccessAssignment.updateMany({
        where: {
          organizationId: staff.organizationId,
          membershipId: staff.membershipId,
          farmId,
        },
        data: { isActive: false },
      });
    });
    void revocation.catch(() => {});
    try {
      await blockedBy(pid);
    } finally {
      hold.release();
    }

    await expect(posting).resolves.toMatchObject({ status: 201 });
    await expect(revocation).resolves.toBeUndefined();
    const nextOrder = await order('PRODUCE');
    await expect(
      writer(prisma).post(
        staff,
        farmId,
        nextOrder.id,
        randomUUID(),
        body(nextOrder, 'PRODUCE', '1'),
      ),
    ).rejects.toThrow('permission');
    expect(
      await prisma.fulfilmentCommand.count({
        where: { organizationId: staff.organizationId },
      }),
    ).toBe(1);
  });

  it.each(['SALE', 'ADJUSTMENT'] as const)(
    'fulfilment versus outbound inventory adjustment with %s committing first',
    async (first) => {
      const o = await order('PRODUCE');
      const adjustment = (client = prisma) =>
        new InventoryStockService(client).postMovement(context, {
          farmId,
          inventoryItemId: itemId,
          expectedInventoryUnit: 'KG',
          quantity: new Prisma.Decimal(-7),
          reason: 'ADJUSTMENT',
          occurredAt: new Date(occurredAt),
        });
      const result =
        first === 'SALE'
          ? await overlapping(
              (client) =>
                writer(client).post(
                  context,
                  farmId,
                  o.id,
                  randomUUID(),
                  body(o, 'PRODUCE', '7'),
                ),
              () => adjustment(),
            )
          : await overlapping(
              (client) => adjustment(client),
              () => post(o, body(o, 'PRODUCE', '7')),
            );
      expect(result.map((entry) => entry.status)).toEqual([
        'fulfilled',
        'rejected',
      ]);
      expect((await balance()).toString()).toBe('3');
      expect(
        await prisma.fulfilmentCommand.count({
          where: { organizationId: context.organizationId },
        }),
      ).toBe(first === 'SALE' ? 1 : 0);
    },
  );

  it.each(['SALE', 'MORTALITY'] as const)(
    'fulfilment versus mortality with %s committing first',
    async (first) => {
      const o = await order('POULTRY');
      const mortality = (client = prisma) =>
        new MortalityService(client, farms).post(context, farmId, {
          flockId,
          deathCount: 7,
          occurredAt: new Date(occurredAt),
        });
      const result =
        first === 'SALE'
          ? await overlapping(
              (client) =>
                writer(client).post(
                  context,
                  farmId,
                  o.id,
                  randomUUID(),
                  body(o, 'POULTRY', '7'),
                ),
              () => mortality(),
            )
          : await overlapping(
              (client) => mortality(client),
              () => post(o, body(o, 'POULTRY', '7')),
            );
      expect(result.map((r) => r.status)).toEqual(['fulfilled', 'rejected']);
      const p = await population();
      expect(p.mortality.plus(p.fulfilledBirds).toString()).toBe('7');
    },
  );

  it('fulfilment and feed usage share the flock lock and preserve separate ledgers', async () => {
    const feedId = (
      await prisma.inventoryItem.create({
        data: {
          organizationId: context.organizationId,
          code: 'FEED',
          name: 'Feed',
          category: 'FEED',
          unit: 'KG',
        },
      })
    ).id;
    await stock.postMovement(context, {
      farmId,
      inventoryItemId: feedId,
      expectedInventoryUnit: 'KG',
      quantity: new Prisma.Decimal(10),
      reason: 'RECEIPT',
      occurredAt: new Date(occurredAt),
    });
    const o = await order('MIXED');
    const input = body(o);
    input.allocations.push(...body(o, 'POULTRY').allocations);
    const result = await overlapping(
      (client) =>
        writer(client).post(context, farmId, o.id, randomUUID(), input),
      () =>
        new FeedUsageService(prisma, stock, farms).post(context, farmId, {
          flockId,
          inventoryItemId: feedId,
          expectedInventoryUnit: 'KG',
          quantity: new Prisma.Decimal(2),
          occurredAt: new Date(occurredAt),
        }),
    );
    expect(result.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
    expect((await population()).fulfilledBirds.toString()).toBe('3');
    expect(
      await prisma.feedUsage.count({
        where: { organizationId: context.organizationId },
      }),
    ).toBe(1);
    expect(
      (await stock.getStockOnHand(context, farmId, feedId)).toString(),
    ).toBe('8');
  });

  it.each(['SALE', 'CANCEL'] as const)(
    'fulfilment versus cancellation with %s committing first',
    async (first) => {
      const o = await order('MIXED');
      const input = body(o);
      input.allocations.push(...body(o, 'POULTRY').allocations);
      const cancelInput = {
        expectedOrderVersion: o.version,
        reason: 'Cancel remainder',
      };
      const result =
        first === 'SALE'
          ? await overlapping(
              (client) =>
                writer(client).post(context, farmId, o.id, randomUUID(), input),
              () => orders.cancel(context, o.id, cancelInput),
            )
          : await overlapping(
              (client) =>
                new SalesOrdersService(client).cancel(
                  context,
                  o.id,
                  cancelInput,
                ),
              () => post(o, input),
            );
      expect(result.map((r) => r.status)).toEqual(['fulfilled', 'rejected']);
      if (first === 'SALE') {
        const cancelled = await orders.cancel(context, o.id, {
          ...cancelInput,
          expectedOrderVersion: 3,
        });
        expect(cancelled.lines[0]).toMatchObject({
          cancelledQuantity: '7',
          fulfilledQuantity: '3',
        });
        expect(await counts()).toMatchObject({ batches: 1, receipts: 1 });
      } else {
        await expect(
          post({ ...o, version: 3 }, { ...input, expectedOrderVersion: 3 }),
        ).rejects.toThrow('state transition');
        expect(await counts()).toMatchObject({ batches: 0, receipts: 0 });
        expect((await balance()).toString()).toBe('10');
      }
    },
  );

  it('serializes reversal against stock ISSUE and concurrent double reversal', async () => {
    const o = await order();
    const posted = await post(o, body(o, 'PRODUCE', '10'));
    const result = await overlapping(
      (client) =>
        writer(client).reverse(
          context,
          farmId,
          posted.receipt.fulfilment.id,
          randomUUID(),
          reversal(3),
        ),
      () =>
        stock.postMovement(context, {
          farmId,
          inventoryItemId: itemId,
          expectedInventoryUnit: 'KG',
          quantity: new Prisma.Decimal(-7),
          reason: 'ISSUE',
          occurredAt: new Date(occurredAt),
        }),
    );
    expect(result.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
    expect((await balance()).toString()).toBe('3');
    await expect(
      service.reverse(
        context,
        farmId,
        posted.receipt.fulfilment.id,
        randomUUID(),
        reversal(4),
      ),
    ).rejects.toThrow('already been reversed');
    const other = await order('POULTRY');
    const poultry = await post(other, body(other, 'POULTRY'));
    const double = await overlapping(
      (client) =>
        writer(client).reverse(
          context,
          farmId,
          poultry.receipt.fulfilment.id,
          randomUUID(),
          reversal(3),
        ),
      () =>
        service.reverse(
          context,
          farmId,
          poultry.receipt.fulfilment.id,
          randomUUID(),
          reversal(3),
        ),
    );
    expect(double.map((r) => r.status)).toEqual(['fulfilled', 'rejected']);
    expect((await population()).fulfilledBirds.toString()).toBe('0');
  });

  it('returns reversal-key conflict before looking up an unavailable target and denies revoked replay', async () => {
    const o = await order();
    const posted = await post(o);
    const key = randomUUID();
    const reverseUrl = (id: string) => `${route()}/fulfilments/${id}/reverse`;
    const first = await api()
      .post(reverseUrl(posted.receipt.fulfilment.id))
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', key)
      .send(reversal(3))
      .expect(201);
    const replay = await api()
      .post(reverseUrl(posted.receipt.fulfilment.id))
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', key)
      .send(reversal(3))
      .expect(201);
    expect(replay.body).toEqual(first.body);
    expect(fulfilmentCommandResponseSchema.safeParse(first.body).success).toBe(
      true,
    );
    await api()
      .post(reverseUrl(randomUUID()))
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', randomUUID())
      .send(reversal(3))
      .expect(404);
    const conflict = await api()
      .post(reverseUrl(randomUUID()))
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', key)
      .send(reversal(3))
      .expect(409);
    expect(conflict.body).toEqual({
      error: {
        code: 'IDEMPOTENCY_CONFLICT',
        message: 'Idempotency key is already bound to another command',
      },
    });
    const before = await counts();
    await prisma.organizationMembership.update({
      where: { id: context.membershipId },
      data: { isActive: false },
    });
    await api()
      .post(reverseUrl(posted.receipt.fulfilment.id))
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', key)
      .send(reversal(3))
      .expect(403);
    await expect(
      service.reverse(
        context,
        farmId,
        posted.receipt.fulfilment.id,
        key,
        reversal(3),
      ),
    ).rejects.toThrow('permission');
    expect(await counts()).toEqual(before);
  });

  it('preserves exact fractional produce accounting and immutable commercial snapshots', async () => {
    const o = await order();
    const snapshot = () =>
      prisma.order.findFirstOrThrow({
        where: { id: o.id, organizationId: context.organizationId },
        select: {
          currency: true,
          saleType: true,
          creditTermDays: true,
          customerId: true,
          customerCode: true,
          customerName: true,
          lines: {
            select: {
              id: true,
              productId: true,
              productCode: true,
              productName: true,
              kind: true,
              unit: true,
              inventoryItemId: true,
              orderedQuantity: true,
              unitPrice: true,
            },
            orderBy: { id: 'asc' },
          },
        },
      });
    const original = await snapshot();
    const posted = await post(o, body(o, 'PRODUCE', '1.125'));
    expect((await balance()).toString()).toBe('8.875');
    expect(posted.receipt.fulfilment.lines[0]!.quantity).toBe('1.125');
    expect((await orders.get(context, o.id)).lines[0]).toMatchObject({
      fulfilledQuantity: '1.125',
      remainingQuantity: '8.875',
      unitPrice: o.lines[0]!.unitPrice,
      lineAmount: o.lines[0]!.lineAmount,
    });
    await prisma.salesProduct.update({
      where: { id: produceId },
      data: { name: 'Renamed catalog product' },
    });
    await service.reverse(
      context,
      farmId,
      posted.receipt.fulfilment.id,
      randomUUID(),
      reversal(3),
    );
    expect((await balance()).toString()).toBe('10');
    expect(await snapshot()).toEqual(original);
    expect((await orders.get(context, o.id)).totalAmount).toBe(o.totalAmount);
  });

  it('serializes feed-first against mixed fulfilment', async () => {
    const feedItem = await prisma.inventoryItem.create({
      data: {
        organizationId: context.organizationId,
        code: 'FEED-FIRST',
        name: 'Feed',
        category: 'FEED',
        unit: 'KG',
      },
    });
    await stock.postMovement(context, {
      farmId,
      inventoryItemId: feedItem.id,
      expectedInventoryUnit: 'KG',
      quantity: new Prisma.Decimal(10),
      reason: 'RECEIPT',
      occurredAt: new Date(occurredAt),
    });
    const o = await order('MIXED');
    const input = body(o);
    input.allocations.push(...body(o, 'POULTRY').allocations);
    const result = await overlapping(
      (client) =>
        new FeedUsageService(client, stock, farms).post(context, farmId, {
          flockId,
          inventoryItemId: feedItem.id,
          expectedInventoryUnit: 'KG',
          quantity: new Prisma.Decimal(2),
          occurredAt: new Date(occurredAt),
        }),
      () => post(o, input),
    );
    expect(result.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
    expect((await population()).fulfilledBirds.toString()).toBe('3');
    expect((await balance()).toString()).toBe('7');
    expect(
      (await stock.getStockOnHand(context, farmId, feedItem.id)).toString(),
    ).toBe('8');
  });

  it('serializes stock ISSUE-first against full reversal', async () => {
    const o = await order();
    const posted = await post(o);
    const result = await overlapping(
      (client) =>
        new InventoryStockService(client).postMovement(context, {
          farmId,
          inventoryItemId: itemId,
          expectedInventoryUnit: 'KG',
          quantity: new Prisma.Decimal(-7),
          reason: 'ISSUE',
          occurredAt: new Date(occurredAt),
        }),
      () =>
        service.reverse(
          context,
          farmId,
          posted.receipt.fulfilment.id,
          randomUUID(),
          reversal(3),
        ),
    );
    expect(result.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
    expect((await balance()).toString()).toBe('3');
    expect(await counts()).toMatchObject({ batches: 2, receipts: 2 });
  });

  it('serializes concurrent identical reversal keys and replays exactly one compensation', async () => {
    const o = await order('MIXED');
    const input = body(o);
    input.allocations.push(...body(o, 'POULTRY').allocations);
    const posted = await post(o, input);
    const key = randomUUID();
    const result = await overlapping(
      (client) =>
        writer(client).reverse(
          context,
          farmId,
          posted.receipt.fulfilment.id,
          key,
          reversal(3),
        ),
      () =>
        service.reverse(
          context,
          farmId,
          posted.receipt.fulfilment.id,
          key,
          reversal(3),
        ),
    );
    expect(result[0]!.status).toBe('fulfilled');
    expect(result[0]).toEqual(result[1]);
    expect((await balance()).toString()).toBe('10');
    expect((await population()).fulfilledBirds.toString()).toBe('0');
    expect(await counts()).toMatchObject({
      batches: 2,
      receipts: 2,
      depletions: 2,
    });
  });

  it('derives customer purchases from posted quantities less reversals across order states', async () => {
    const draft = await draftOrder('MIXED');
    const confirmedDraft = await draftOrder('MIXED');
    const confirmed = await orders.confirm(context, confirmedDraft.id, {
      expectedOrderVersion: confirmedDraft.version,
    });
    const partial = await order('MIXED');
    const partialInput = body(partial, 'PRODUCE', '2.375');
    partialInput.allocations.push(...body(partial, 'POULTRY', '3').allocations);
    await post(partial, partialInput);

    const complete = await order('PRODUCE', '1');
    await post(complete, body(complete, 'PRODUCE', '1'));

    const reversed = await order('MIXED');
    const reversedInput = body(reversed, 'PRODUCE', '4');
    reversedInput.allocations.push(
      ...body(reversed, 'POULTRY', '5').allocations,
    );
    const original = await post(reversed, reversedInput);
    await service.reverse(
      context,
      farmId,
      original.receipt.fulfilment.id,
      randomUUID(),
      reversal(original.receipt.orderVersion),
    );

    const cancelled = await order('PRODUCE');
    const cancelledPost = await post(
      cancelled,
      body(cancelled, 'PRODUCE', '4.25'),
    );
    await orders.cancel(context, cancelled.id, {
      expectedOrderVersion: cancelledPost.receipt.orderVersion,
      reason: 'Close remaining demand',
    });
    await prisma.salesProduct.updateMany({
      where: { organizationId: context.organizationId },
      data: { name: 'Renamed catalog label' },
    });
    await prisma.customer.update({
      where: { id: customerId },
      data: { name: 'Renamed customer identity' },
    });

    const response = await api()
      .get(customerHistoryRoute())
      .set('Authorization', `Bearer ${staffToken}`)
      .expect(200);
    expect(
      customerOrderHistoryResponseSchema.safeParse(response.body).success,
    ).toBe(true);
    expect(response.body.meta.totalItems).toBe(6);
    const historyEntries = response.body.data as CustomerOrderHistoryEntry[];
    const byId = new Map(
      historyEntries.map((entry) => [entry.id, entry] as const),
    );
    const draftEntry = byId.get(draft.id)!;
    expect(draftEntry.commercialState).toBe('DRAFT');
    expect(draftEntry.confirmedAt).toBeNull();
    expect(
      draftEntry.lines.map(
        (line: { fulfilledQuantity: string }) => line.fulfilledQuantity,
      ),
    ).toEqual(['0', '0']);
    const confirmedEntry = byId.get(confirmed.id)!;
    expect(confirmedEntry.commercialState).toBe('CONFIRMED');
    expect(confirmedEntry.confirmedAt).toEqual(expect.any(String));
    expect(confirmedEntry.terms).toEqual({
      saleType: 'CREDIT',
      creditTermDays: 30,
    });
    expect(confirmedEntry.customer.name).toBe('Market');
    expect(confirmedEntry.lines[0]).toMatchObject({
      unitPrice: '2.1250',
      lineAmount: '21.25',
    });
    expect(confirmedEntry.totalAmount).toBe('121.25');
    expect(confirmedEntry.lines[0].fulfilledQuantity).toBe('0');
    expect(confirmedEntry.lines[0].productName).toBe('Pumpkin');
    expect(
      byId
        .get(partial.id)!
        .lines.map(
          (line: { fulfilledQuantity: string }) => line.fulfilledQuantity,
        ),
    ).toEqual(['2.375', '3']);
    expect(byId.get(complete.id)!.lines[0].fulfilledQuantity).toBe('1');
    expect(
      byId
        .get(reversed.id)!
        .lines.map(
          (line: { fulfilledQuantity: string }) => line.fulfilledQuantity,
        ),
    ).toEqual(['0', '0']);
    expect(byId.get(cancelled.id)).toMatchObject({
      commercialState: 'CANCELLED',
      lines: [
        {
          orderedQuantity: '10',
          fulfilledQuantity: '4.25',
          remainingQuantity: '0',
          cancelledQuantity: '5.75',
        },
      ],
    });
    for (const entry of response.body.data) {
      for (const forbidden of [
        'paidAmount',
        'outstandingBalance',
        'receivable',
        'invoiceStatus',
        'paymentStatus',
        'creditUtilization',
        'dueDate',
      ])
        expect(entry).not.toHaveProperty(forbidden);
    }
    expect(Object.keys(prisma)).not.toContain('invoice');
    expect(Object.keys(prisma)).not.toContain('payment');
  });

  it('bounds, filters and stably paginates tenant-scoped customer history', async () => {
    const drafts = await Promise.all([
      draftOrder(),
      draftOrder(),
      draftOrder(),
    ]);
    const expected = await prisma.order.findMany({
      where: {
        organizationId: context.organizationId,
        id: { in: drafts.map((entry) => entry.id) },
      },
      select: { id: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    const expectedIds = expected.map((entry) => entry.id);
    const firstPage = await api()
      .get(
        `${customerHistoryRoute()}?page=1&pageSize=2&state=DRAFT&search=Market`,
      )
      .set('Authorization', `Bearer ${staffToken}`)
      .expect(200);
    expect(
      firstPage.body.data.map((entry: { id: string }) => entry.id),
    ).toEqual(expectedIds.slice(0, 2));
    expect(firstPage.body.meta).toMatchObject({
      page: 1,
      pageSize: 2,
      totalItems: 3,
      totalPages: 2,
    });
    const secondPage = await api()
      .get(`${customerHistoryRoute()}?page=2&pageSize=2&state=DRAFT`)
      .set('Authorization', `Bearer ${staffToken}`)
      .expect(200);
    expect(
      secondPage.body.data.map((entry: { id: string }) => entry.id),
    ).toEqual(expectedIds.slice(2));
    await api()
      .get(`${customerHistoryRoute()}?pageSize=101`)
      .set('Authorization', `Bearer ${staffToken}`)
      .expect(400);
    await api()
      .get(`${customerHistoryRoute()}?customerId=${randomUUID()}`)
      .set('Authorization', `Bearer ${staffToken}`)
      .expect(400);

    const confirmed = await order();
    const progress = await api()
      .get(`${customerHistoryRoute()}?state=CONFIRMED&progress=UNFULFILLED`)
      .set('Authorization', `Bearer ${staffToken}`)
      .expect(200);
    expect(progress.body.data.map((entry: { id: string }) => entry.id)).toEqual(
      [confirmed.id],
    );

    const foreignOrganization = await prisma.organization.create({
      data: { name: 'Foreign', slug: randomUUID() },
    });
    const foreignCustomer = await prisma.customer.create({
      data: {
        organizationId: foreignOrganization.id,
        code: 'CUS-FOREIGN',
        name: 'Restricted identity',
        type: 'BUSINESS',
      },
    });
    const missing = await api()
      .get(customerHistoryRoute(foreignCustomer.id))
      .set('Authorization', `Bearer ${staffToken}`)
      .expect(404);
    expect(JSON.stringify(missing.body)).not.toContain(foreignCustomer.id);
    expect(JSON.stringify(missing.body)).not.toContain('Restricted identity');
    await api()
      .get(customerHistoryRoute(foreignCustomer.id, foreignOrganization.id))
      .set('Authorization', `Bearer ${staffToken}`)
      .expect(403);
    await api().get(customerHistoryRoute()).expect(401);
  });

  it('gives STAFF whole-order commercial progress without unauthorized farm sources', async () => {
    const mixed = await order('MIXED');
    const firstInput = body(mixed, 'PRODUCE', '2.5');
    firstInput.allocations.push(...body(mixed, 'POULTRY', '3').allocations);
    const first = await post(mixed, firstInput);
    const secondInput = body(
      { ...mixed, version: first.receipt.orderVersion },
      'PRODUCE',
      '1.5',
    );
    secondInput.allocations.push({
      kind: 'POULTRY',
      orderLineId: mixed.lines.find((line) => line.kind === 'POULTRY')!.id,
      flockId: secondFlock,
      quantity: '2',
    });
    await post(
      { ...mixed, version: first.receipt.orderVersion },
      secondInput,
      randomUUID(),
      secondFarm,
    );

    const response = await api()
      .get(`${customerHistoryRoute()}?progress=PARTIALLY_FULFILLED`)
      .set('Authorization', `Bearer ${staffToken}`)
      .expect(200);
    expect(response.body.data).toHaveLength(1);
    const entry = response.body.data[0];
    expect(entry.fulfilmentProgress).toBe('PARTIALLY_FULFILLED');
    expect(
      entry.lines.map(
        (line: { fulfilledQuantity: string }) => line.fulfilledQuantity,
      ),
    ).toEqual(['4', '5']);
    const serialized = JSON.stringify(response.body);
    for (const sourceId of [farmId, secondFarm, flockId, secondFlock, itemId])
      expect(serialized).not.toContain(sourceId);
    expect(entry).not.toHaveProperty('sourceDetails');
    expect(entry.lines[0]).not.toHaveProperty('allocations');
  });
});
