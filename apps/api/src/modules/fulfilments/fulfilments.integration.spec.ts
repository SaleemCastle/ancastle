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
import { InvoicesModule } from '../invoices/invoices.module.js';
import { InvoicesService } from '../invoices/invoices.service.js';
import { PaymentsModule } from '../payments/payments.module.js';
import { PaymentsService } from '../payments/payments.service.js';

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
    stock: InventoryStockService,
    invoices: InvoicesService;
  let invoiceAuthorization: AuthorizationService;
  let payments: PaymentsService;
  let farms: FarmAccessService;
  const authorization = new AuthorizationService();
  const activation = new FulfilmentActivationService();
  let context: OrganizationContext,
    staff: OrganizationContext,
    manager: OrganizationContext,
    owner: OrganizationContext;
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
  async function insertInvoiceDirectly(
    fulfilmentId: string,
    options: {
      customerId?: string;
      currency?: string;
      grossAmount?: string;
      lineAmount?: string;
      issuanceEvents?: 'one' | 'none' | 'duplicate';
      lockSourceOrder?: boolean;
      holdBeforeCommit?: { reached: () => void; wait: Promise<void> };
    } = {},
  ) {
    const source = await prisma.fulfilment.findFirstOrThrow({
      where: { organizationId: context.organizationId, id: fulfilmentId },
      include: {
        order: true,
        lines: { include: { orderLine: true }, orderBy: { id: 'asc' } },
      },
    });
    const invoiceId = randomUUID();
    const issueKey = randomUUID();
    const issuedAt = new Date();
    const values = source.lines.map((line) => ({
      line,
      amount: new Prisma.Decimal(line.quantity)
        .mul(line.orderLine.unitPrice)
        .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP),
    }));
    const grossAmount = values.reduce(
      (total, value) => total.plus(value.amount),
      new Prisma.Decimal(0),
    );
    return prisma.$transaction(async (tx) => {
      if (options.lockSourceOrder)
        await tx.$queryRaw`
          SELECT "id" FROM "orders"
          WHERE "organizationId" = ${context.organizationId}::uuid
            AND "id" = ${source.orderId}::uuid
          FOR UPDATE
        `;
      await tx.invoice.create({
        data: {
          id: invoiceId,
          organizationId: context.organizationId,
          farmId: source.farmId,
          customerId: options.customerId ?? source.order.customerId,
          orderId: source.orderId,
          fulfilmentId,
          invoiceNumber: `DIRECT-${invoiceId}`,
          currency: options.currency ?? source.order.currency,
          issuedAt,
          dueAt: issuedAt,
          customerBillingSnapshot: { name: source.order.customerName },
          paymentTermsSnapshot: {
            saleType: source.order.saleType,
            creditTermDays: source.order.creditTermDays,
          },
          grossAmount: options.grossAmount ?? grossAmount,
          taxTreatmentStatus: 'APPROVED_POLICY_NOT_CALCULATED',
          taxPolicyReference: 'test-approved-policy',
          taxPolicyVersion: 'test-1',
          issuedByMembershipId: context.membershipId,
          status: 'ISSUED',
        },
      });
      await tx.invoiceLine.createMany({
        data: values.map(({ line, amount }) => ({
          organizationId: context.organizationId,
          farmId: source.farmId,
          orderId: source.orderId,
          invoiceId,
          orderLineId: line.orderLineId,
          fulfilmentLineId: line.id,
          description: line.orderLine.productName,
          quantity: line.quantity,
          unit: line.unit,
          unitPrice: line.orderLine.unitPrice,
          lineAmount: options.lineAmount ?? amount,
        })),
      });
      await tx.invoiceFulfilmentAllocation.createMany({
        data: source.lines.map((line) => ({
          organizationId: context.organizationId,
          farmId: source.farmId,
          orderId: source.orderId,
          orderLineId: line.orderLineId,
          fulfilmentLineId: line.id,
          invoiceId,
        })),
      });
      if (options.issuanceEvents !== 'none') {
        const event = {
          organizationId: context.organizationId,
          invoiceId,
          actorMembershipId: context.membershipId,
          type: 'ISSUED',
          details: { source: 'DIRECT_TEST' },
        };
        await tx.invoiceLifecycleEvent.create({ data: event });
        if (options.issuanceEvents === 'duplicate')
          await tx.invoiceLifecycleEvent.create({ data: event });
      }
      await tx.invoiceIssueCommand.create({
        data: {
          organizationId: context.organizationId,
          key: issueKey,
          fulfilmentId,
          actorMembershipId: context.membershipId,
          requestHash: 'a'.repeat(64),
          invoiceId,
        },
      });
      if (options.holdBeforeCommit) {
        options.holdBeforeCommit.reached();
        await options.holdBeforeCommit.wait;
      }
      return invoiceId;
    });
  }
  async function waitForDatabaseLockWait() {
    for (let attempt = 0; attempt < 100; attempt++) {
      const rows = await prisma.$queryRaw<{ waiting: number }[]>`
        SELECT count(*)::int AS waiting
        FROM pg_stat_activity
        WHERE datname = current_database()
          AND wait_event_type = 'Lock'
          AND pid <> pg_backend_pid()
      `;
      if ((rows[0]?.waiting ?? 0) > 0) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(
      'Expected a concurrent transaction to wait on a database lock',
    );
  }
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
        InvoicesModule,
        PaymentsModule,
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
    invoices = module.get(InvoicesService);
    invoiceAuthorization = module.get(AuthorizationService);
    payments = module.get(PaymentsService);
  }, 120_000);
  afterAll(async () => {
    await app?.close();
    await database?.dispose();
    vi.unstubAllEnvs();
  });
  beforeEach(async () => {
    vi.stubEnv('SALES_FULFILMENT_ENABLED', 'true');
    vi.stubEnv('M6_INVOICE_ISSUANCE_ENABLED', 'false');
    vi.stubEnv('M6_INVOICE_TAX_POLICY_READY', 'false');
    vi.stubEnv('M6_INVOICE_TAX_POLICY_CONFIG', '{"state":"PENDING_POLICY"}');
    const org = await prisma.organization.create({
      data: { name: 'Sales', slug: randomUUID() },
    });
    async function member(role: 'ADMIN' | 'STAFF' | 'MANAGER' | 'OWNER') {
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
    owner = await member('OWNER');
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
      // M5 physical posting does not create a financial invoice.
      expect(
        await prisma.invoice.count({
          where: { organizationId: context.organizationId },
        }),
      ).toBe(0);
      expect(
        await prisma.payment.count({
          where: { organizationId: context.organizationId },
        }),
      ).toBe(0);
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
    expect(
      await prisma.invoice.count({
        where: { organizationId: context.organizationId },
      }),
    ).toBe(0);
    expect(
      await prisma.payment.count({
        where: { organizationId: context.organizationId },
      }),
    ).toBe(0);
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

  it('commits M5 fulfilment with invoice issuance disabled or unavailable', async () => {
    const o = await order('PRODUCE', '4');
    const issueSpy = vi
      .spyOn(invoices, 'issue')
      .mockRejectedValue(new Error('invoice service unavailable'));
    const posted = await post(o, body(o, 'PRODUCE', '2'));
    expect(issueSpy).not.toHaveBeenCalled();
    expect(
      await prisma.fulfilmentCommand.count({
        where: {
          organizationId: context.organizationId,
          fulfilmentId: posted.receipt.fulfilment.id,
        },
      }),
    ).toBe(1);
    expect(
      await prisma.invoice.count({
        where: { organizationId: context.organizationId },
      }),
    ).toBe(0);
    issueSpy.mockRestore();
  });

  it('persists maximum supported M5 line and 100-line invoice amounts at full precision', async () => {
    const maxQuantity = '999999999999999.999';
    const maxUnitPrice = '999999999999999.9999';
    const maxLineAmount = '999999999999999998900000000000.00';
    const maxGrossAmount = '99999999999999999890000000000000.00';
    const draft = await orders.create(context, {
      customerId,
      currency: 'JMD',
      terms: { saleType: 'CASH', creditTermDays: null },
      lines: Array.from({ length: 100 }, () => ({
        productId: produceId,
        expectedProduct: {
          kind: 'PRODUCE' as const,
          unit: 'KG' as const,
          inventoryItemId: itemId,
        },
        quantity: maxQuantity,
        unitPrice: maxUnitPrice,
      })),
    });
    const confirmed = await orders.confirm(context, draft.id, {
      expectedOrderVersion: draft.version,
    });
    await prisma.inventoryMovement.createMany({
      data: confirmed.lines.map(() => ({
        organizationId: context.organizationId,
        farmId,
        inventoryItemId: itemId,
        actorUserId: context.userId,
        quantity: maxQuantity,
        reason: 'RECEIPT' as const,
        occurredAt: new Date(occurredAt),
      })),
    });
    const posted = await service.post(
      context,
      farmId,
      confirmed.id,
      randomUUID(),
      {
        expectedOrderVersion: confirmed.version,
        occurredAt,
        allocations: confirmed.lines.map((line) => ({
          kind: 'PRODUCE' as const,
          orderLineId: line.id,
          inventoryItemId: itemId,
          quantity: maxQuantity,
        })),
      },
    );
    vi.stubEnv('M6_INVOICE_ISSUANCE_ENABLED', 'true');
    vi.stubEnv('M6_INVOICE_TAX_POLICY_READY', 'true');
    vi.stubEnv(
      'M6_INVOICE_TAX_POLICY_CONFIG',
      '{"state":"APPROVED_POLICY_NOT_CALCULATED","reference":"test-approved-policy","version":"test-1"}',
    );
    const issued = await invoices.issue(
      context,
      posted.receipt.fulfilment.id,
      randomUUID(),
    );
    expect(issued.invoice.lines).toHaveLength(100);
    expect(
      issued.invoice.lines.every((line) => line.lineAmount === maxLineAmount),
    ).toBe(true);
    expect(issued.invoice.grossAmount).toBe(maxGrossAmount);
    const stored = await prisma.invoice.findFirstOrThrow({
      where: { organizationId: context.organizationId, id: issued.invoice.id },
      include: { lines: true },
    });
    expect(stored.grossAmount.toFixed(2)).toBe(maxGrossAmount);
    expect(
      stored.lines.every(
        (line) => line.lineAmount.toFixed(2) === maxLineAmount,
      ),
    ).toBe(true);
    await expect(
      prisma.$executeRaw`
        UPDATE "invoices"
        SET "grossAmount" = '199999999999999998900000000000000.00'
        WHERE "id" = ${stored.id}::uuid`,
    ).rejects.toThrow();
    await expect(
      prisma.$executeRaw`
        UPDATE "invoice_lines"
        SET "lineAmount" = '1999999999999999989000000000000.00'
        WHERE "id" = ${stored.lines[0]!.id}::uuid`,
    ).rejects.toThrow();
  });

  it('fails closed on unresolved tax policy without invalidating the committed fulfilment', async () => {
    const o = await order('PRODUCE', '3');
    const posted = await post(o, body(o, 'PRODUCE', '2'));
    vi.stubEnv('M6_INVOICE_ISSUANCE_ENABLED', 'true');
    vi.stubEnv('M6_INVOICE_TAX_POLICY_READY', 'true');
    vi.stubEnv('M6_INVOICE_TAX_POLICY_CONFIG', '{"state":"PENDING_POLICY"}');
    await expect(
      invoices.issue(context, posted.receipt.fulfilment.id, randomUUID()),
    ).rejects.toMatchObject({ code: 'INVOICE_TAX_POLICY_PENDING' });
    expect(
      await prisma.fulfilment.findFirst({
        where: {
          id: posted.receipt.fulfilment.id,
          organizationId: context.organizationId,
        },
      }),
    ).not.toBeNull();
    expect(
      await prisma.invoice.count({
        where: { organizationId: context.organizationId },
      }),
    ).toBe(0);
    expect(
      await prisma.invoiceSequence.count({
        where: { organizationId: context.organizationId },
      }),
    ).toBe(0);
  });

  it('rolls back invoice, sequence, lines, allocations, event, and receipt after a mid-write failure', async () => {
    const o = await order('PRODUCE', '4');
    const posted = await post(o, body(o, 'PRODUCE', '2'));
    vi.stubEnv('M6_INVOICE_ISSUANCE_ENABLED', 'true');
    vi.stubEnv('M6_INVOICE_TAX_POLICY_READY', 'true');
    vi.stubEnv(
      'M6_INVOICE_TAX_POLICY_CONFIG',
      '{"state":"APPROVED_POLICY_NOT_CALCULATED","reference":"rollback-test","version":"1"}',
    );
    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION fail_invoice_line_for_test() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected invoice line failure'; END; $$
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER fail_invoice_line_for_test
      BEFORE INSERT ON invoice_lines
      FOR EACH ROW EXECUTE FUNCTION fail_invoice_line_for_test()
    `);
    try {
      await expect(
        invoices.issue(context, posted.receipt.fulfilment.id, randomUUID()),
      ).rejects.toThrow(/injected invoice line failure/i);
    } finally {
      await prisma.$executeRawUnsafe(
        'DROP TRIGGER IF EXISTS fail_invoice_line_for_test ON invoice_lines',
      );
      await prisma.$executeRawUnsafe(
        'DROP FUNCTION IF EXISTS fail_invoice_line_for_test()',
      );
    }
    expect(
      await prisma.invoice.count({
        where: { organizationId: context.organizationId },
      }),
    ).toBe(0);
    expect(
      await prisma.invoiceSequence.count({
        where: { organizationId: context.organizationId },
      }),
    ).toBe(0);
    expect(
      await prisma.invoiceLine.count({
        where: { organizationId: context.organizationId },
      }),
    ).toBe(0);
    expect(
      await prisma.invoiceFulfilmentAllocation.count({
        where: { organizationId: context.organizationId },
      }),
    ).toBe(0);
    expect(
      await prisma.invoiceLifecycleEvent.count({
        where: { organizationId: context.organizationId },
      }),
    ).toBe(0);
    expect(
      await prisma.invoiceIssueCommand.count({
        where: { organizationId: context.organizationId },
      }),
    ).toBe(0);
    expect(
      await prisma.fulfilment.findFirst({
        where: {
          organizationId: context.organizationId,
          id: posted.receipt.fulfilment.id,
        },
      }),
    ).not.toBeNull();
  });

  it('issues separately against committed fulfilment, replays idempotently, and projects source snapshots', async () => {
    const o = await order('PRODUCE', '4');
    const posted = await post(o, body(o, 'PRODUCE', '2.375'));
    vi.stubEnv('M6_INVOICE_ISSUANCE_ENABLED', 'true');
    vi.stubEnv('M6_INVOICE_TAX_POLICY_READY', 'true');
    vi.stubEnv(
      'M6_INVOICE_TAX_POLICY_CONFIG',
      '{"state":"APPROVED_POLICY_NOT_CALCULATED","reference":"business-approval","version":"2026-01"}',
    );
    const key = randomUUID();
    const first = await invoices.issue(
      context,
      posted.receipt.fulfilment.id,
      key,
    );
    const replay = await invoices.issue(
      context,
      posted.receipt.fulfilment.id,
      key,
    );
    expect(first.status).toBe(201);
    expect(replay.status).toBe(200);
    expect(replay.invoice.id).toBe(first.invoice.id);
    expect(first.invoice.lines).toHaveLength(1);
    expect(first.invoice.lines[0]).toMatchObject({
      quantity: '2.375',
      unitPrice: '2.0000',
      lineAmount: '4.75',
    });
    expect(first.invoice.grossAmount).toBe('4.75');
    expect(first.invoice.paymentTermsSnapshot).toEqual({
      saleType: 'CASH',
      creditTermDays: null,
    });
    expect(first.invoice.taxTreatmentStatus).toBe(
      'APPROVED_POLICY_NOT_CALCULATED',
    );
    await expect(
      invoices.issue(context, posted.receipt.fulfilment.id, randomUUID()),
    ).rejects.toMatchObject({ code: 'FULFILMENT_ALREADY_INVOICED' });
    await expect(
      service.reverse(
        context,
        farmId,
        posted.receipt.fulfilment.id,
        randomUUID(),
        reversal(posted.receipt.orderVersion),
      ),
    ).rejects.toMatchObject({ code: 'INVOICED_FULFILMENT_REVERSAL_BLOCKED' });
  });

  it('rejects direct invoices for reversed sources and enforces event and source consistency', async () => {
    const reversedOrder = await order('PRODUCE', '4');
    const reversedPosting = await post(
      reversedOrder,
      body(reversedOrder, 'PRODUCE', '2'),
    );
    await service.reverse(
      context,
      farmId,
      reversedPosting.receipt.fulfilment.id,
      randomUUID(),
      reversal(reversedPosting.receipt.orderVersion),
    );
    await expect(
      insertInvoiceDirectly(reversedPosting.receipt.fulfilment.id),
    ).rejects.toThrow(/reconcile|reversed/i);

    const sourceOrder = await order('PRODUCE', '4');
    const posting = await post(sourceOrder, body(sourceOrder, 'PRODUCE', '2'));
    await expect(
      insertInvoiceDirectly(posting.receipt.fulfilment.id, {
        issuanceEvents: 'none',
      }),
    ).rejects.toThrow(/reconcile|issuance event/i);
    await expect(
      insertInvoiceDirectly(posting.receipt.fulfilment.id, {
        issuanceEvents: 'duplicate',
      }),
    ).rejects.toThrow();

    const secondCustomer = await prisma.customer.create({
      data: {
        organizationId: context.organizationId,
        code: `CUS-${randomUUID()}`,
        type: 'BUSINESS',
        name: 'Different billed customer',
      },
    });
    await expect(
      insertInvoiceDirectly(posting.receipt.fulfilment.id, {
        customerId: secondCustomer.id,
      }),
    ).rejects.toThrow(/reconcile|source/i);
    await expect(
      insertInvoiceDirectly(posting.receipt.fulfilment.id, {
        currency: 'USD',
      }),
    ).rejects.toThrow();
  });

  it('serializes issuance against reversal in both transaction directions', async () => {
    const o = await order('PRODUCE', '4');
    const posted = await post(o, body(o, 'PRODUCE', '2'));
    vi.stubEnv('M6_INVOICE_ISSUANCE_ENABLED', 'true');
    vi.stubEnv('M6_INVOICE_TAX_POLICY_READY', 'true');
    vi.stubEnv(
      'M6_INVOICE_TAX_POLICY_CONFIG',
      '{"state":"APPROVED_POLICY_NOT_CALCULATED","reference":"concurrency-test","version":"1"}',
    );
    const outcomes = await Promise.allSettled([
      invoices.issue(context, posted.receipt.fulfilment.id, randomUUID()),
      service.reverse(
        context,
        farmId,
        posted.receipt.fulfilment.id,
        randomUUID(),
        reversal(posted.receipt.orderVersion),
      ),
    ]);
    expect(
      outcomes.filter((outcome) => outcome.status === 'fulfilled'),
    ).toHaveLength(1);
    const invoice = await prisma.invoice.findFirst({
      where: {
        organizationId: context.organizationId,
        fulfilmentId: posted.receipt.fulfilment.id,
      },
    });
    const reversed = await prisma.fulfilment.findFirst({
      where: {
        organizationId: context.organizationId,
        reversesFulfilmentId: posted.receipt.fulfilment.id,
      },
    });
    expect(Boolean(invoice)).not.toBe(Boolean(reversed));
  });

  it('serializes direct invoice writes with M5 reversal whichever transaction holds the order first', async () => {
    vi.stubEnv('M6_INVOICE_ISSUANCE_ENABLED', 'true');
    vi.stubEnv('M6_INVOICE_TAX_POLICY_READY', 'true');
    vi.stubEnv(
      'M6_INVOICE_TAX_POLICY_CONFIG',
      '{"state":"APPROVED_POLICY_NOT_CALCULATED","reference":"direct-race-test","version":"1"}',
    );

    const invoiceFirstOrder = await order('PRODUCE', '4');
    const invoiceFirstPosting = await post(
      invoiceFirstOrder,
      body(invoiceFirstOrder, 'PRODUCE', '2'),
    );
    const directReached = barrier();
    const releaseDirect = barrier();
    const directInvoice = insertInvoiceDirectly(
      invoiceFirstPosting.receipt.fulfilment.id,
      {
        lockSourceOrder: true,
        holdBeforeCommit: {
          reached: () => directReached.resolve(),
          wait: releaseDirect.promise,
        },
      },
    );
    await directReached.promise;
    const waitingReversal = service.reverse(
      context,
      farmId,
      invoiceFirstPosting.receipt.fulfilment.id,
      randomUUID(),
      reversal(invoiceFirstPosting.receipt.orderVersion),
    );
    try {
      await waitForDatabaseLockWait();
    } finally {
      releaseDirect.resolve();
    }
    await directInvoice;
    await expect(waitingReversal).rejects.toMatchObject({
      code: 'INVOICED_FULFILMENT_REVERSAL_BLOCKED',
    });

    const reversalFirstOrder = await order('PRODUCE', '4');
    const reversalFirstPosting = await post(
      reversalFirstOrder,
      body(reversalFirstOrder, 'PRODUCE', '2'),
    );
    const reversalEntered = barrier();
    const continueReversal = barrier();
    const postMovement = stock.postMovementInTransaction.bind(stock);
    const movementBarrier = vi
      .spyOn(stock, 'postMovementInTransaction')
      .mockImplementation(async (...args) => {
        reversalEntered.resolve();
        await continueReversal.promise;
        return postMovement(...args);
      });
    try {
      const winningReversal = service.reverse(
        context,
        farmId,
        reversalFirstPosting.receipt.fulfilment.id,
        randomUUID(),
        reversal(reversalFirstPosting.receipt.orderVersion),
      );
      await reversalEntered.promise;
      const losingInvoice = insertInvoiceDirectly(
        reversalFirstPosting.receipt.fulfilment.id,
      );
      await waitForDatabaseLockWait();
      continueReversal.resolve();
      await winningReversal;
      await expect(losingInvoice).rejects.toThrow(/reconcile|reversed/i);
    } finally {
      continueReversal.resolve();
      movementBarrier.mockRestore();
    }
  });

  it('serializes concurrent issue attempts and supports partial invoices from separate postings', async () => {
    const o = await order('PRODUCE', '10');
    const firstPosted = await post(o, body(o, 'PRODUCE', '3.75'));
    vi.stubEnv('M6_INVOICE_ISSUANCE_ENABLED', 'true');
    vi.stubEnv('M6_INVOICE_TAX_POLICY_READY', 'true');
    vi.stubEnv(
      'M6_INVOICE_TAX_POLICY_CONFIG',
      '{"state":"APPROVED_POLICY_NOT_CALCULATED","reference":"business-approval","version":"2026-01"}',
    );
    const sameKey = randomUUID();
    const replayed = await Promise.all([
      invoices.issue(context, firstPosted.receipt.fulfilment.id, sameKey),
      invoices.issue(context, firstPosted.receipt.fulfilment.id, sameKey),
    ]);
    expect(
      replayed
        .map((result) => result.invoice.id)
        .filter((id, index, all) => all.indexOf(id) === index),
    ).toHaveLength(1);
    expect(
      await prisma.invoice.count({
        where: { organizationId: context.organizationId },
      }),
    ).toBe(1);

    const nextOrder = { ...o, version: firstPosted.receipt.orderVersion };
    const secondPosted = await post(
      nextOrder,
      body(nextOrder, 'PRODUCE', '6.25'),
    );
    await expect(
      invoices.issue(context, secondPosted.receipt.fulfilment.id, sameKey),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    const distinctKeys = await Promise.allSettled([
      invoices.issue(context, secondPosted.receipt.fulfilment.id, randomUUID()),
      invoices.issue(context, secondPosted.receipt.fulfilment.id, randomUUID()),
    ]);
    expect(
      distinctKeys.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      distinctKeys.filter((result) => result.status === 'rejected'),
    ).toHaveLength(1);
    const secondInvoice = distinctKeys.find(
      (
        result,
      ): result is PromiseFulfilledResult<
        Awaited<ReturnType<typeof invoices.issue>>
      > => result.status === 'fulfilled',
    )!.value;
    expect(secondInvoice.invoice.lines[0]?.quantity).toBe('6.25');
    const invoiceTotal = await prisma.invoice.aggregate({
      where: { organizationId: context.organizationId, orderId: o.id },
      _sum: { grossAmount: true },
    });
    expect(invoiceTotal._sum.grossAmount?.toFixed(2)).toBe('20.00');
  });

  it('rejects cross-organization invoice access and keeps STAFF read-only', async () => {
    const o = await order('PRODUCE', '2');
    const posted = await post(o, body(o, 'PRODUCE', '1'));
    const nextOrder = { ...o, version: posted.receipt.orderVersion };
    const unassignedFarmPosting = await post(
      nextOrder,
      body(nextOrder, 'PRODUCE', '1'),
      randomUUID(),
      secondFarm,
    );
    vi.stubEnv('M6_INVOICE_ISSUANCE_ENABLED', 'true');
    vi.stubEnv('M6_INVOICE_TAX_POLICY_READY', 'true');
    vi.stubEnv(
      'M6_INVOICE_TAX_POLICY_CONFIG',
      '{"state":"APPROVED_POLICY_NOT_CALCULATED","reference":"business-approval","version":"2026-01"}',
    );
    await expect(
      invoices.issue(staff, posted.receipt.fulfilment.id, randomUUID()),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const issued = await invoices.issue(
      context,
      posted.receipt.fulfilment.id,
      randomUUID(),
    );
    const unassignedFarmInvoice = await invoices.issue(
      context,
      unassignedFarmPosting.receipt.fulfilment.id,
      randomUUID(),
    );
    const otherOrg = await prisma.organization.create({
      data: { name: 'Other tenant', slug: randomUUID() },
    });
    const otherUser = await prisma.user.create({
      data: { email: `${randomUUID()}@example.com`, passwordHash: 'unused' },
    });
    const otherMembership = await prisma.organizationMembership.create({
      data: {
        organizationId: otherOrg.id,
        userId: otherUser.id,
        role: 'ADMIN',
      },
    });
    const otherContext = new OrganizationContext(
      otherOrg.id,
      otherMembership.id,
      otherUser.id,
      'ADMIN',
    );
    await expect(
      invoices.get(otherContext, issued.invoice.id),
    ).rejects.toMatchObject({ code: 'INVOICE_NOT_FOUND' });
    const list = await invoices.list(staff, { page: 1, pageSize: 20 });
    expect(list.meta.totalItems).toBe(2);
    expect(
      list.data.some(
        (invoice) => invoice.id === unassignedFarmInvoice.invoice.id,
      ),
    ).toBe(true);
    const withoutInvoiceRead = vi
      .spyOn(invoiceAuthorization, 'hasAllPermissions')
      .mockReturnValue(false);
    await expect(invoices.get(staff, issued.invoice.id)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    withoutInvoiceRead.mockRestore();
  });

  it('scopes invoice idempotency keys by organization and rejects foreign sources', async () => {
    const localOrder = await order('PRODUCE', '2');
    const localPosting = await post(
      localOrder,
      body(localOrder, 'PRODUCE', '1'),
    );

    const foreignOrganization = await prisma.organization.create({
      data: { name: 'Foreign invoice tenant', slug: randomUUID() },
    });
    const foreignUser = await prisma.user.create({
      data: { email: `${randomUUID()}@example.com`, passwordHash: 'unused' },
    });
    const foreignMembership = await prisma.organizationMembership.create({
      data: {
        organizationId: foreignOrganization.id,
        userId: foreignUser.id,
        role: 'ADMIN',
      },
    });
    const foreignContext = new OrganizationContext(
      foreignOrganization.id,
      foreignMembership.id,
      foreignUser.id,
      'ADMIN',
    );
    const foreignFarm = await prisma.farm.create({
      data: {
        organizationId: foreignOrganization.id,
        code: 'FARM-1',
        name: 'Foreign farm',
      },
    });
    const foreignCustomer = await prisma.customer.create({
      data: {
        organizationId: foreignOrganization.id,
        code: 'CUS-1',
        type: 'BUSINESS',
        name: 'Foreign customer',
      },
    });
    const foreignFlock = await prisma.flock.create({
      data: {
        organizationId: foreignOrganization.id,
        farmId: foreignFarm.id,
        code: 'FLK-1',
        name: 'Foreign flock',
        startingBirdCount: 5,
        placementDate: new Date(occurredAt),
      },
    });
    const foreignProduct = await prisma.salesProduct.create({
      data: {
        organizationId: foreignOrganization.id,
        code: 'BIRD-1',
        name: 'Birds',
        kind: 'POULTRY',
        unit: 'EACH',
      },
    });
    await prisma.poultryProductSource.create({
      data: {
        organizationId: foreignOrganization.id,
        farmId: foreignFarm.id,
        productId: foreignProduct.id,
        flockId: foreignFlock.id,
        actorUserId: foreignUser.id,
      },
    });
    const foreignDraft = await orders.create(foreignContext, {
      customerId: foreignCustomer.id,
      currency: 'JMD',
      terms: { saleType: 'CASH', creditTermDays: null },
      lines: [
        {
          productId: foreignProduct.id,
          expectedProduct: { kind: 'POULTRY', unit: 'EACH' },
          quantity: '2',
          unitPrice: '10',
        },
      ],
    });
    const foreignOrder = await orders.confirm(foreignContext, foreignDraft.id, {
      expectedOrderVersion: foreignDraft.version,
    });
    const foreignPosting = await service.post(
      foreignContext,
      foreignFarm.id,
      foreignOrder.id,
      randomUUID(),
      {
        expectedOrderVersion: foreignOrder.version,
        occurredAt,
        allocations: [
          {
            kind: 'POULTRY',
            orderLineId: foreignOrder.lines[0]!.id,
            flockId: foreignFlock.id,
            quantity: '1',
          },
        ],
      },
    );

    vi.stubEnv('M6_INVOICE_ISSUANCE_ENABLED', 'true');
    vi.stubEnv('M6_INVOICE_TAX_POLICY_READY', 'true');
    vi.stubEnv(
      'M6_INVOICE_TAX_POLICY_CONFIG',
      '{"state":"APPROVED_POLICY_NOT_CALCULATED","reference":"scope-test","version":"1"}',
    );
    const sharedKey = randomUUID();
    const localInvoice = await invoices.issue(
      context,
      localPosting.receipt.fulfilment.id,
      sharedKey,
    );
    const foreignInvoice = await invoices.issue(
      foreignContext,
      foreignPosting.receipt.fulfilment.id,
      sharedKey,
    );
    expect(localInvoice.invoice.id).not.toBe(foreignInvoice.invoice.id);
    expect(
      await prisma.invoiceIssueCommand.count({ where: { key: sharedKey } }),
    ).toBe(2);
    await expect(
      prisma.invoiceLifecycleEvent.create({
        data: {
          organizationId: context.organizationId,
          invoiceId: localInvoice.invoice.id,
          actorMembershipId: foreignMembership.id,
          type: 'ISSUED',
          details: { source: 'CROSS_TENANT_TEST' },
        },
      }),
    ).rejects.toThrow();
    await expect(
      invoices.issue(
        context,
        foreignPosting.receipt.fulfilment.id,
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: 'FULFILMENT_NOT_FOUND' });
  });

  it('denies invoice reads and issuance after membership revocation', async () => {
    const o = await order('PRODUCE', '4');
    const firstPosting = await post(o, body(o, 'PRODUCE', '1'));
    const nextOrder = { ...o, version: firstPosting.receipt.orderVersion };
    const secondPosting = await post(
      nextOrder,
      body(nextOrder, 'PRODUCE', '1'),
    );
    vi.stubEnv('M6_INVOICE_ISSUANCE_ENABLED', 'true');
    vi.stubEnv('M6_INVOICE_TAX_POLICY_READY', 'true');
    vi.stubEnv(
      'M6_INVOICE_TAX_POLICY_CONFIG',
      '{"state":"APPROVED_POLICY_NOT_CALCULATED","reference":"membership-test","version":"1"}',
    );
    const issued = await invoices.issue(
      context,
      firstPosting.receipt.fulfilment.id,
      randomUUID(),
    );
    await prisma.organizationMembership.update({
      where: { id: context.membershipId },
      data: { isActive: false },
    });
    await expect(
      invoices.get(context, issued.invoice.id),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(
      invoices.issue(
        context,
        secondPosting.receipt.fulfilment.id,
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('records both manual methods pending verification and enforces role-specific independent verification', async () => {
    const httpRecorded = await api()
      .post(`/api/organizations/${context.organizationId}/payments`)
      .set('Authorization', `Bearer ${staffToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({
        customerId,
        amount: '8.00',
        method: 'BANK_TRANSFER',
        receivingAccount: 'main-account',
        bankTransferReference: 'http-bank-ref-1',
      })
      .expect(201);
    expect(httpRecorded.body.data.status).toBe('PENDING_VERIFICATION');
    await api()
      .post(
        `/api/organizations/${context.organizationId}/payments/${httpRecorded.body.data.id}/verify`,
      )
      .set('Authorization', `Bearer ${staffToken}`)
      .set('Idempotency-Key', randomUUID())
      .expect(403);
    await api()
      .post(
        `/api/organizations/${context.organizationId}/payments/${httpRecorded.body.data.id}/verify`,
      )
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', randomUUID())
      .expect(201);

    const cashKey = randomUUID();
    const cashInput = {
      customerId,
      amount: '12.00',
      method: 'CASH' as const,
      cashReceiptNumber: 'cash-receipt-1',
    };
    const cash = await payments.record(context, cashInput, cashKey);
    expect(cash.payment.status).toBe('PENDING_VERIFICATION');
    expect(cash.payment.cashReceiptNumber).toBe('cash-receipt-1');
    expect(
      (await payments.record(context, cashInput, cashKey)).payment.id,
    ).toBe(cash.payment.id);
    await expect(
      payments.record(context, { ...cashInput, amount: '13.00' }, cashKey),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    await expect(
      payments.record(
        context,
        {
          customerId,
          amount: '12.00',
          method: 'CASH',
          cashReceiptNumber: 'cash-receipt-1',
        },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: 'PAYMENT_EVIDENCE_DUPLICATE' });

    const bank = await payments.record(
      staff,
      {
        customerId,
        amount: '5.00',
        method: 'BANK_TRANSFER',
        receivingAccount: 'main-account',
        bankTransferReference: 'bank-ref-1',
      },
      randomUUID(),
    );
    expect(bank.payment.status).toBe('PENDING_VERIFICATION');
    expect(bank.payment.bankTransferReference).toBe('bank-ref-1');
    const managerVerification = await payments.verify(
      manager,
      bank.payment.id,
      randomUUID(),
    );
    expect(managerVerification.payment.status).toBe('VERIFIED');
    expect(managerVerification.payment.selfVerification).toBe(false);
    expect(managerVerification.payment.verifiedByMembershipId).toBe(
      manager.membershipId,
    );
    expect(
      managerVerification.payment.events.map((event) => event.type),
    ).toEqual(['RECORDED', 'VERIFIED']);
    await expect(
      payments.reverse(
        manager,
        bank.payment.id,
        { reason: 'Manager reversal is denied' },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      payments.allocate(
        staff,
        bank.payment.id,
        { allocations: [{ invoiceId: randomUUID(), amount: '1.00' }] },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const managerRecorded = await payments.record(
      manager,
      {
        customerId,
        amount: '1.00',
        method: 'CASH',
        cashReceiptNumber: 'manager-cash-1',
      },
      randomUUID(),
    );
    await expect(
      payments.verify(manager, managerRecorded.payment.id, randomUUID()),
    ).rejects.toMatchObject({ code: 'PAYMENT_SELF_VERIFICATION_DENIED' });

    const adminSelf = await payments.verify(
      context,
      cash.payment.id,
      randomUUID(),
    );
    expect(adminSelf.payment.selfVerification).toBe(true);
    const ownerRecorded = await payments.record(
      owner,
      {
        customerId,
        amount: '2.00',
        method: 'CASH',
        cashReceiptNumber: 'owner-cash-1',
      },
      randomUUID(),
    );
    expect(
      (await payments.verify(owner, ownerRecorded.payment.id, randomUUID()))
        .payment.selfVerification,
    ).toBe(true);

    const staffRecorded = await payments.record(
      staff,
      {
        customerId,
        amount: '3.00',
        method: 'CASH',
        cashReceiptNumber: 'staff-cash-1',
      },
      randomUUID(),
    );
    await expect(
      payments.verify(staff, staffRecorded.payment.id, randomUUID()),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await prisma.organizationMembership.update({
      where: { id: manager.membershipId },
      data: { isActive: false },
    });
    await expect(
      payments.verify(manager, staffRecorded.payment.id, randomUUID()),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('enforces canonical payment evidence and account-scoped transfer identity in PostgreSQL', async () => {
    const insertDirect = async (options: {
      organizationId: string;
      customerId: string;
      membershipId: string;
      method: 'CASH' | 'BANK_TRANSFER';
      cashReceiptNumber: string | null;
      receivingAccount: string | null;
      bankTransferReference: string | null;
      evidenceKey: string;
      amount?: string;
    }) =>
      prisma.$transaction(async (tx) => {
        const paymentId = randomUUID();
        await tx.$executeRaw`
          INSERT INTO "payments" (
            "id", "organizationId", "customerId", "amount", "currency", "method",
            "cashReceiptNumber", "receivingAccount", "bankTransferReference", "evidenceKey", "recordedByMembershipId"
          ) VALUES (
            ${paymentId}::uuid, ${options.organizationId}::uuid, ${options.customerId}::uuid,
            ${options.amount ?? '1.00'}::numeric, 'JMD', ${options.method}::"PaymentMethod", ${options.cashReceiptNumber},
            ${options.receivingAccount}, ${options.bankTransferReference}, ${options.evidenceKey}, ${options.membershipId}::uuid
          )
        `;
        await tx.$executeRaw`
          INSERT INTO "payment_lifecycle_events" (
            "id", "organizationId", "paymentId", "type", "actorMembershipId"
          ) VALUES (
            ${randomUUID()}::uuid, ${options.organizationId}::uuid, ${paymentId}::uuid,
            'RECORDED', ${options.membershipId}::uuid
          )
        `;
        return paymentId;
      });
    const cashEvidence = {
      organizationId: context.organizationId,
      customerId,
      membershipId: context.membershipId,
      method: 'CASH' as const,
      cashReceiptNumber: 'Cash Receipt 77',
      receivingAccount: null,
      bankTransferReference: null,
    };
    await insertDirect({ ...cashEvidence, evidenceKey: 'CASH:cashreceipt77' });
    await insertDirect({
      ...cashEvidence,
      cashReceiptNumber: 'maximum payment amount',
      evidenceKey: 'CASH:maximumpaymentamount',
      amount: '99999999999999999999999999999999.99',
    });
    await expect(
      insertDirect({
        ...cashEvidence,
        cashReceiptNumber: 'overflow payment amount',
        evidenceKey: 'CASH:overflowpaymentamount',
        amount: '100000000000000000000000000000000.00',
      }),
    ).rejects.toThrow();
    await expect(
      insertDirect({ ...cashEvidence, evidenceKey: 'forged-unique-key' }),
    ).rejects.toThrow(/does not match canonical evidence/);
    await expect(
      insertDirect({
        ...cashEvidence,
        cashReceiptNumber: '   ',
        evidenceKey: 'CASH:',
      }),
    ).rejects.toThrow(/cash receipt evidence is empty/);
    await expect(
      insertDirect({
        ...cashEvidence,
        cashReceiptNumber: ' cashreceipt 77 ',
        evidenceKey: 'CASH:cashreceipt77',
      }),
    ).rejects.toThrow();

    const transferEvidence = {
      organizationId: context.organizationId,
      customerId,
      membershipId: context.membershipId,
      method: 'BANK_TRANSFER' as const,
      cashReceiptNumber: null,
      receivingAccount: '  Account A 1 ',
      bankTransferReference: ' Tx Ref 88 ',
    };
    await insertDirect({
      ...transferEvidence,
      evidenceKey: 'BANK:9:accounta1:txref88',
    });
    await expect(
      insertDirect({
        ...transferEvidence,
        receivingAccount: 'account a1',
        bankTransferReference: 'txref 88',
        evidenceKey: 'forged-bank-key',
      }),
    ).rejects.toThrow(/does not match canonical evidence/);
    await expect(
      insertDirect({
        ...transferEvidence,
        receivingAccount: 'account a1',
        bankTransferReference: 'txref 88',
        evidenceKey: 'BANK:9:accounta1:txref88',
      }),
    ).rejects.toThrow();
    await insertDirect({
      ...transferEvidence,
      receivingAccount: 'account-b',
      evidenceKey: 'BANK:9:account-b:txref88',
    });

    const otherOrg = await prisma.organization.create({
      data: { name: 'Evidence tenant', slug: `evidence-${randomUUID()}` },
    });
    const otherUser = await prisma.user.create({
      data: { email: `${randomUUID()}@example.com`, passwordHash: 'unused' },
    });
    const otherMembership = await prisma.organizationMembership.create({
      data: {
        organizationId: otherOrg.id,
        userId: otherUser.id,
        role: 'ADMIN',
      },
    });
    const otherCustomer = await prisma.customer.create({
      data: {
        organizationId: otherOrg.id,
        code: 'EVIDENCE',
        name: 'Evidence tenant',
        type: 'BUSINESS',
      },
    });
    await insertDirect({
      ...cashEvidence,
      organizationId: otherOrg.id,
      customerId: otherCustomer.id,
      membershipId: otherMembership.id,
      evidenceKey: 'CASH:cashreceipt77',
    });
    await insertDirect({
      ...transferEvidence,
      organizationId: otherOrg.id,
      customerId: otherCustomer.id,
      membershipId: otherMembership.id,
      evidenceKey: 'BANK:9:accounta1:txref88',
    });
  });

  it('allocates exact verified funds across invoices, serializes competing commands, and reverses immutably', async () => {
    vi.stubEnv('M6_INVOICE_ISSUANCE_ENABLED', 'true');
    vi.stubEnv('M6_INVOICE_TAX_POLICY_READY', 'true');
    vi.stubEnv(
      'M6_INVOICE_TAX_POLICY_CONFIG',
      '{"state":"APPROVED_POLICY_NOT_CALCULATED","reference":"payment-test","version":"1"}',
    );
    const invoiceFor = async () => {
      const o = await order('PRODUCE', '5');
      const posted = await post(o, body(o, 'PRODUCE', '2'));
      return (
        await invoices.issue(
          context,
          posted.receipt.fulfilment.id,
          randomUUID(),
        )
      ).invoice;
    };
    const firstInvoice = await invoiceFor();
    const secondInvoice = await invoiceFor();
    const payment = await payments.record(
      staff,
      {
        customerId,
        amount: '6.00',
        method: 'BANK_TRANSFER',
        receivingAccount: 'main-account',
        bankTransferReference: 'allocation-bank-1',
      },
      randomUUID(),
    );
    await expect(
      payments.allocate(
        manager,
        payment.payment.id,
        {
          allocations: [{ invoiceId: firstInvoice.id, amount: '1.00' }],
        },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: 'PAYMENT_NOT_VERIFIED' });
    await payments.verify(manager, payment.payment.id, randomUUID());
    const allocationKey = randomUUID();
    const allocationInput = {
      allocations: [
        { invoiceId: firstInvoice.id, amount: '2.00' },
        { invoiceId: secondInvoice.id, amount: '2.00' },
      ],
    };
    const allocated = await payments.allocate(
      manager,
      payment.payment.id,
      allocationInput,
      allocationKey,
    );
    expect(allocated.payment.allocatedAmount).toBe('4.00');
    expect(allocated.payment.unallocatedAmount).toBe('2.00');
    await expect(
      payments.allocate(
        manager,
        payment.payment.id,
        { allocations: [{ invoiceId: firstInvoice.id, amount: '2.01' }] },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: 'PAYMENT_FUNDS_EXCEEDED' });
    await payments.allocate(
      manager,
      payment.payment.id,
      allocationInput,
      allocationKey,
    );
    await expect(
      payments.allocate(
        manager,
        payment.payment.id,
        {
          allocations: [{ invoiceId: firstInvoice.id, amount: '1.00' }],
        },
        allocationKey,
      ),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    expect(
      (await payments.invoiceBalance(manager, firstInvoice.id))
        .outstandingAmount,
    ).toBe('2.00');

    const contenderA = await payments.record(
      staff,
      {
        customerId,
        amount: '2.00',
        method: 'CASH',
        cashReceiptNumber: 'contender-a',
      },
      randomUUID(),
    );
    const contenderB = await payments.record(
      staff,
      {
        customerId,
        amount: '2.00',
        method: 'CASH',
        cashReceiptNumber: 'contender-b',
      },
      randomUUID(),
    );
    await payments.verify(manager, contenderA.payment.id, randomUUID());
    await payments.verify(manager, contenderB.payment.id, randomUUID());
    const outcomes = await Promise.allSettled([
      payments.allocate(
        manager,
        contenderA.payment.id,
        { allocations: [{ invoiceId: firstInvoice.id, amount: '2.00' }] },
        randomUUID(),
      ),
      payments.allocate(
        manager,
        contenderB.payment.id,
        { allocations: [{ invoiceId: firstInvoice.id, amount: '2.00' }] },
        randomUUID(),
      ),
    ]);
    expect(
      outcomes.filter((outcome) => outcome.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      outcomes.filter((outcome) => outcome.status === 'rejected'),
    ).toHaveLength(1);
    expect(
      (await payments.invoiceBalance(manager, firstInvoice.id))
        .outstandingAmount,
    ).toBe('0.00');
    const winner = outcomes.find((outcome) => outcome.status === 'fulfilled')!;
    if (winner.status !== 'fulfilled')
      throw new Error('Expected one allocation winner');
    const historyBefore = await prisma.paymentAllocation.count({
      where: {
        organizationId: context.organizationId,
        paymentId: winner.value.payment.id,
      },
    });
    const reversed = await payments.reverse(
      context,
      winner.value.payment.id,
      { reason: 'Payment recorded in error' },
      randomUUID(),
    );
    expect(reversed.payment.status).toBe('REVERSED');
    expect(
      reversed.payment.allocations.every(
        (allocation) => allocation.activeAmount === '0.00',
      ),
    ).toBe(true);
    expect(reversed.payment.events.map((event) => event.type)).toContain(
      'REVERSED',
    );
    expect(
      await prisma.paymentAllocation.count({
        where: {
          organizationId: context.organizationId,
          paymentId: winner.value.payment.id,
        },
      }),
    ).toBe(historyBefore);
    expect(
      (await payments.invoiceBalance(manager, firstInvoice.id))
        .outstandingAmount,
    ).toBe('2.00');
    await expect(
      payments.allocate(
        manager,
        winner.value.payment.id,
        { allocations: [{ invoiceId: firstInvoice.id, amount: '1.00' }] },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: 'PAYMENT_REVERSED' });
  });

  it('rejects allocation to a non-issued invoice at the PostgreSQL boundary and preserves invoice status', async () => {
    vi.stubEnv('M6_INVOICE_ISSUANCE_ENABLED', 'true');
    vi.stubEnv('M6_INVOICE_TAX_POLICY_READY', 'true');
    vi.stubEnv(
      'M6_INVOICE_TAX_POLICY_CONFIG',
      '{"state":"APPROVED_POLICY_NOT_CALCULATED","reference":"payment-state-test","version":"1"}',
    );
    const orderRecord = await order('PRODUCE', '5');
    const posted = await post(orderRecord, body(orderRecord, 'PRODUCE', '2'));
    const invoice = (
      await invoices.issue(context, posted.receipt.fulfilment.id, randomUUID())
    ).invoice;

    // InvoiceState currently contains only ISSUED. Add a disposable test value
    // so the payment trigger is exercised against a genuinely ineligible row.
    await prisma.$executeRawUnsafe(
      `ALTER TYPE "InvoiceState" ADD VALUE IF NOT EXISTS 'DRAFT'`,
    );
    await prisma.$executeRawUnsafe(
      'ALTER TABLE "invoices" DISABLE TRIGGER invoices_immutable',
    );
    try {
      await prisma.$executeRaw`UPDATE "invoices" SET "status" = 'DRAFT' WHERE "organizationId" = ${context.organizationId}::uuid AND "id" = ${invoice.id}::uuid`;
    } finally {
      await prisma.$executeRawUnsafe(
        'ALTER TABLE "invoices" ENABLE TRIGGER invoices_immutable',
      );
    }

    const paymentId = randomUUID();
    const evidenceKey = `CASH:state${randomUUID().replaceAll('-', '')}`;
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.$executeRaw`
          INSERT INTO "payments" (
            "id", "organizationId", "customerId", "amount", "currency", "method",
            "cashReceiptNumber", "evidenceKey", "recordedByMembershipId"
          ) VALUES (
            ${paymentId}::uuid, ${context.organizationId}::uuid, ${customerId}::uuid,
            1.00, 'JMD', 'CASH', ${evidenceKey.slice(5)}, ${evidenceKey}, ${context.membershipId}::uuid
          )
        `;
        await tx.$executeRaw`
          INSERT INTO "payment_lifecycle_events" (
            "id", "organizationId", "paymentId", "type", "actorMembershipId", "selfVerification"
          ) VALUES
            (${randomUUID()}::uuid, ${context.organizationId}::uuid, ${paymentId}::uuid, 'RECORDED', ${context.membershipId}::uuid, false),
            (${randomUUID()}::uuid, ${context.organizationId}::uuid, ${paymentId}::uuid, 'VERIFIED', ${context.membershipId}::uuid, true)
        `;
        await tx.$executeRaw`
          INSERT INTO "payment_allocations" (
            "id", "organizationId", "paymentId", "invoiceId", "customerId", "currency", "amount", "allocatedByMembershipId"
          ) VALUES (
            ${randomUUID()}::uuid, ${context.organizationId}::uuid, ${paymentId}::uuid,
            ${invoice.id}::uuid, ${customerId}::uuid, 'JMD', 1.00, ${context.membershipId}::uuid
          )
        `;
      }),
    ).rejects.toThrow(/allocations require an issued invoice/);
    expect(
      await prisma.paymentAllocation.count({
        where: { organizationId: context.organizationId, paymentId },
      }),
    ).toBe(0);
    await expect(
      prisma.$executeRaw`UPDATE "invoices" SET "status" = 'ISSUED' WHERE "organizationId" = ${context.organizationId}::uuid AND "id" = ${invoice.id}::uuid`,
    ).rejects.toThrow();

    const maximum = '99999999999999999999999999999999.99';
    await prisma.$executeRawUnsafe(
      'ALTER TABLE "invoices" DISABLE TRIGGER invoices_immutable',
    );
    try {
      await prisma.$executeRaw`
        UPDATE "invoices" SET "status" = 'ISSUED', "grossAmount" = ${maximum}::numeric
        WHERE "organizationId" = ${context.organizationId}::uuid AND "id" = ${invoice.id}::uuid
      `;
    } finally {
      await prisma.$executeRawUnsafe(
        'ALTER TABLE "invoices" ENABLE TRIGGER invoices_immutable',
      );
    }
    const maximumPaymentId = randomUUID();
    const maximumEvidence = `CASH:max${randomUUID().replaceAll('-', '')}`;
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        INSERT INTO "payments" (
          "id", "organizationId", "customerId", "amount", "currency", "method",
          "cashReceiptNumber", "evidenceKey", "recordedByMembershipId"
        ) VALUES (
          ${maximumPaymentId}::uuid, ${context.organizationId}::uuid, ${customerId}::uuid,
          ${maximum}::numeric, 'JMD', 'CASH', ${maximumEvidence.slice(5)}, ${maximumEvidence}, ${context.membershipId}::uuid
        )
      `;
      await tx.$executeRaw`
        INSERT INTO "payment_lifecycle_events" (
          "id", "organizationId", "paymentId", "type", "actorMembershipId", "selfVerification"
        ) VALUES
          (${randomUUID()}::uuid, ${context.organizationId}::uuid, ${maximumPaymentId}::uuid, 'RECORDED', ${context.membershipId}::uuid, false),
          (${randomUUID()}::uuid, ${context.organizationId}::uuid, ${maximumPaymentId}::uuid, 'VERIFIED', ${context.membershipId}::uuid, true)
      `;
    });
    await payments.allocate(
      context,
      maximumPaymentId,
      { allocations: [{ invoiceId: invoice.id, amount: maximum }] },
      randomUUID(),
    );
    expect(await payments.invoiceBalance(manager, invoice.id)).toMatchObject({
      grossAmount: maximum,
      allocatedAmount: maximum,
      outstandingAmount: '0.00',
    });
    await payments.reverse(
      context,
      maximumPaymentId,
      { reason: 'Maximum capacity reversal' },
      randomUUID(),
    );
    expect(
      (await payments.invoiceBalance(manager, invoice.id)).outstandingAmount,
    ).toBe(maximum);
  });

  it('keeps payment writes tenant-scoped and rolls back if a later command-receipt insert fails', async () => {
    const foreignOrg = await prisma.organization.create({
      data: { name: 'Foreign payments', slug: `foreign-${randomUUID()}` },
    });
    const foreignUser = await prisma.user.create({
      data: { email: `${randomUUID()}@example.com`, passwordHash: 'unused' },
    });
    const foreignMembership = await prisma.organizationMembership.create({
      data: {
        organizationId: foreignOrg.id,
        userId: foreignUser.id,
        role: 'ADMIN',
      },
    });
    const foreignCustomer = await prisma.customer.create({
      data: {
        organizationId: foreignOrg.id,
        code: 'CUS-X',
        name: 'Foreign',
        type: 'BUSINESS',
      },
    });
    const foreignPayment = await payments.record(
      new OrganizationContext(
        foreignOrg.id,
        foreignMembership.id,
        foreignUser.id,
        'ADMIN',
      ),
      {
        customerId: foreignCustomer.id,
        amount: '7.00',
        method: 'BANK_TRANSFER',
        receivingAccount: 'main-account',
        bankTransferReference: 'foreign-bank-1',
      },
      randomUUID(),
    );
    await expect(
      payments.get(context, foreignPayment.payment.id),
    ).rejects.toMatchObject({ code: 'PAYMENT_NOT_FOUND' });

    await prisma.$executeRawUnsafe(
      `CREATE FUNCTION test_reject_payment_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected payment receipt failure'; END; $$`,
    );
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER test_reject_payment_receipt BEFORE INSERT ON payment_command_receipts FOR EACH ROW EXECUTE FUNCTION test_reject_payment_receipt()`,
    );
    const before = await prisma.payment.count({
      where: { organizationId: context.organizationId },
    });
    try {
      await expect(
        payments.record(
          context,
          {
            customerId,
            amount: '9.00',
            method: 'CASH',
            cashReceiptNumber: 'rollback-receipt',
          },
          randomUUID(),
        ),
      ).rejects.toThrow('injected payment receipt failure');
      expect(
        await prisma.payment.count({
          where: { organizationId: context.organizationId },
        }),
      ).toBe(before);
      expect(
        await prisma.paymentLifecycleEvent.count({
          where: { organizationId: context.organizationId },
        }),
      ).toBe(0);
    } finally {
      await prisma.$executeRawUnsafe(
        'DROP TRIGGER test_reject_payment_receipt ON payment_command_receipts',
      );
      await prisma.$executeRawUnsafe(
        'DROP FUNCTION test_reject_payment_receipt()',
      );
    }
  });

  it('serializes verification against reversal and prevents reversal-of-reversal', async () => {
    const pending = await payments.record(
      staff,
      {
        customerId,
        amount: '4.00',
        method: 'BANK_TRANSFER',
        receivingAccount: 'main-account',
        bankTransferReference: 'verification-reversal-race',
      },
      randomUUID(),
    );
    const outcomes = await Promise.allSettled([
      payments.verify(context, pending.payment.id, randomUUID()),
      payments.reverse(
        context,
        pending.payment.id,
        { reason: 'Concurrent correction' },
        randomUUID(),
      ),
    ]);
    expect(
      outcomes.filter((outcome) => outcome.status === 'fulfilled').length,
    ).toBeGreaterThanOrEqual(1);
    const final = await payments.get(context, pending.payment.id);
    expect(final.status).toBe('REVERSED');
    expect(
      final.events.filter((event) => event.type === 'VERIFIED'),
    ).toHaveLength(outcomes[0]?.status === 'fulfilled' ? 1 : 0);
    expect(
      final.events.filter((event) => event.type === 'REVERSED'),
    ).toHaveLength(1);
    await expect(
      payments.reverse(
        context,
        pending.payment.id,
        { reason: 'Second correction' },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: 'PAYMENT_ALREADY_REVERSED' });
    await expect(
      payments.verify(context, pending.payment.id, randomUUID()),
    ).rejects.toMatchObject({ code: 'PAYMENT_REVERSED' });
  });
});
