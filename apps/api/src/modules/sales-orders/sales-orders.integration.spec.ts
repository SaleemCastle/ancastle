import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import {
  orderDetailResponseSchema,
  orderEventListResponseSchema,
  orderListResponseSchema,
  orderResponseSchema,
} from '@ancastle/validation';
import { temporaryDatabase } from '../../test/temporary-database.js';
import { DatabaseModule } from '../../database/database.module.js';
import { PrismaService } from '../../database/prisma.service.js';
import { HttpExceptionFilter } from '../../common/filters/http-exception.filter.js';
import { TokenService } from '../auth/token.service.js';
import { SalesCatalogModule } from '../sales-catalog/sales-catalog.module.js';
import { SalesOrdersModule } from './sales-orders.module.js';

describe('Sales orders API and lifecycle (PostgreSQL)', () => {
  let database: Awaited<ReturnType<typeof temporaryDatabase>>;
  let prisma: PrismaService;
  let app: INestApplication;
  let org: string;
  let foreignOrg: string;
  let customerId: string;
  let poultryId: string;
  let produceId: string;
  let inventoryItemId: string;
  const users = {
    admin: randomUUID(),
    manager: randomUUID(),
    staff: randomUUID(),
  };
  const tokens: Record<keyof typeof users, string> = {
    admin: '',
    manager: '',
    staff: '',
  };
  const api = () => request(app.getHttpServer());
  const route = () => `/api/organizations/${org}/orders`;
  const auth = (role: keyof typeof users = 'admin') => `Bearer ${tokens[role]}`;

  const poultryLine = (quantity = '3', unitPrice = '12.3456') => ({
    productId: poultryId,
    expectedProduct: { kind: 'POULTRY', unit: 'EACH' },
    quantity,
    unitPrice,
  });
  const produceLine = (quantity = '1.250', unitPrice = '12.3456') => ({
    productId: produceId,
    expectedProduct: { kind: 'PRODUCE', unit: 'KG', inventoryItemId },
    quantity,
    unitPrice,
  });
  const createInput = (lines: object[] = [poultryLine()]) => ({
    customerId,
    currency: 'JMD',
    terms: { saleType: 'CASH', creditTermDays: null },
    lines,
  });
  const createOrder = async (
    input = createInput(),
    role: keyof typeof users = 'admin',
  ) => {
    const result = await api()
      .post(route())
      .set('Authorization', auth(role))
      .send(input)
      .expect(201);
    expect(orderResponseSchema.safeParse(result.body).success).toBe(true);
    return result.body.data as {
      id: string;
      version: number;
      lines: Array<{ id: string }>;
    };
  };

  beforeAll(async () => {
    vi.stubEnv('JWT_SECRET', 'sales-orders-integration-test-secret');
    database = await temporaryDatabase();
    prisma = database.prisma;
    await prisma.user.createMany({
      data: Object.values(users).map((id) => ({
        id,
        email: `${id}@example.com`,
        passwordHash: 'unused',
      })),
    });
    const module = await Test.createTestingModule({
      imports: [DatabaseModule, SalesCatalogModule, SalesOrdersModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();
    for (const role of Object.keys(users) as Array<keyof typeof users>) {
      tokens[role] = await module
        .get(TokenService)
        .createAccessToken(users[role], `${users[role]}@example.com`);
    }
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await database?.dispose();
    vi.unstubAllEnvs();
  });

  beforeEach(async () => {
    org = randomUUID();
    foreignOrg = randomUUID();
    await prisma.organization.createMany({
      data: [org, foreignOrg].map((id) => ({ id, name: id, slug: id })),
    });
    const memberships = await Promise.all(
      (Object.keys(users) as Array<keyof typeof users>).map((role) =>
        prisma.organizationMembership.create({
          data: {
            organizationId: org,
            userId: users[role],
            role:
              role === 'admin'
                ? 'ADMIN'
                : role === 'manager'
                  ? 'MANAGER'
                  : 'STAFF',
          },
        }),
      ),
    );
    await prisma.organizationMembership.create({
      data: { organizationId: foreignOrg, userId: users.admin, role: 'STAFF' },
    });
    customerId = randomUUID();
    await prisma.customer.create({
      data: {
        id: customerId,
        organizationId: org,
        code: 'CUS-000001',
        type: 'BUSINESS',
        name: 'North Market',
        contactPerson: 'Jo',
        phone: '+18765550100',
        email: 'orders@example.com',
        address: 'Kingston',
      },
    });
    inventoryItemId = randomUUID();
    await prisma.inventoryItem.create({
      data: {
        id: inventoryItemId,
        organizationId: org,
        code: 'INV-000001',
        name: 'Pumpkin',
        unit: 'KG',
        category: 'PRODUCE',
      },
    });
    poultryId = randomUUID();
    produceId = randomUUID();
    await prisma.salesProduct.createMany({
      data: [
        {
          id: poultryId,
          organizationId: org,
          code: 'PRD-000001',
          name: 'Market birds',
          kind: 'POULTRY',
          unit: 'EACH',
        },
        {
          id: produceId,
          organizationId: org,
          code: 'PRD-000002',
          name: 'Pumpkin',
          kind: 'PRODUCE',
          unit: 'KG',
          inventoryItemId,
        },
      ],
    });
    expect(memberships).toHaveLength(3);
  });

  it('creates JMD draft snapshots from server-owned customer and catalog records with exact amounts', async () => {
    const draft = await createOrder(createInput([produceLine()]));
    const response = await api()
      .get(`${route()}/${draft.id}`)
      .set('Authorization', auth())
      .expect(200);
    expect(orderDetailResponseSchema.safeParse(response.body).success).toBe(
      true,
    );
    expect(response.body.data).toMatchObject({
      commercialState: 'DRAFT',
      currency: 'JMD',
      terms: { saleType: 'CASH', creditTermDays: null },
      customer: { name: 'North Market', code: 'CUS-000001' },
      totalAmount: '15.43',
      lines: [
        {
          productName: 'Pumpkin',
          unit: 'KG',
          orderedQuantity: '1.25',
          unitPrice: '12.3456',
          lineAmount: '15.43',
        },
      ],
      sourceDetails: { visibility: 'REDACTED' },
    });
    expect(response.body.data.lines[0]).not.toHaveProperty('inventoryItemId');
    expect(
      await prisma.inventoryMovement.count({ where: { organizationId: org } }),
    ).toBe(0);
    expect(
      await prisma.fulfilment.count({ where: { organizationId: org } }),
    ).toBe(0);
    expect(
      await prisma.flockSaleDepletion.count({ where: { organizationId: org } }),
    ).toBe(0);
  });

  it('rejects foreign, stale and inactive catalog identities without persisting an order', async () => {
    const foreignProductId = randomUUID();
    await prisma.salesProduct.create({
      data: {
        id: foreignProductId,
        organizationId: foreignOrg,
        code: 'PRD-000001',
        name: 'Foreign birds',
        kind: 'POULTRY',
        unit: 'EACH',
      },
    });
    await api()
      .post(route())
      .set('Authorization', auth())
      .send(
        createInput([
          {
            productId: foreignProductId,
            expectedProduct: { kind: 'POULTRY', unit: 'EACH' },
            quantity: '2',
            unitPrice: '1.0000',
          },
        ]),
      )
      .expect(404);
    await api()
      .post(route())
      .set('Authorization', auth())
      .send(
        createInput([
          {
            ...produceLine(),
            expectedProduct: { kind: 'PRODUCE', unit: 'G', inventoryItemId },
          },
        ]),
      )
      .expect(409);
    await prisma.salesProduct.update({
      where: { id: poultryId },
      data: { isActive: false },
    });
    await api()
      .post(route())
      .set('Authorization', auth())
      .send(createInput())
      .expect(409);
    expect(await prisma.order.count({ where: { organizationId: org } })).toBe(
      0,
    );
  });

  it('revalidates customer/product lifecycle at confirmation and rejects inactive definitions', async () => {
    const draft = await createOrder();
    await prisma.salesProduct.update({
      where: { id: poultryId },
      data: { isActive: false },
    });
    await api()
      .post(`${route()}/${draft.id}/confirm`)
      .set('Authorization', auth())
      .send({ expectedOrderVersion: 1 })
      .expect(409);
    const saved = await prisma.order.findUniqueOrThrow({
      where: { id: draft.id },
    });
    expect(saved.commercialState).toBe('DRAFT');
    expect(saved.version).toBe(1);
    expect(
      await prisma.orderEvent.count({ where: { orderId: draft.id } }),
    ).toBe(1);
  });

  it('allows draft amendment and freezes confirmed terms, price and product snapshots', async () => {
    const draft = await createOrder();
    const lineId = draft.lines[0]!.id;
    const amended = await api()
      .patch(`${route()}/${draft.id}`)
      .set('Authorization', auth('manager'))
      .send({
        expectedOrderVersion: 1,
        terms: { saleType: 'CREDIT', creditTermDays: 30 },
        lines: [
          {
            operation: 'UPDATE',
            lineId,
            line: poultryLine('4', '9.9999'),
          },
        ],
      })
      .expect(200);
    expect(amended.body.data.version).toBe(2);
    expect(amended.body.data.terms).toEqual({
      saleType: 'CREDIT',
      creditTermDays: 30,
    });
    await api()
      .post(`${route()}/${draft.id}/confirm`)
      .set('Authorization', auth('manager'))
      .send({ expectedOrderVersion: 2 })
      .expect(200);
    const repeated = await api()
      .post(`${route()}/${draft.id}/confirm`)
      .set('Authorization', auth('manager'))
      .send({ expectedOrderVersion: 2 })
      .expect(200);
    expect(repeated.body.data.commercialState).toBe('CONFIRMED');
    await api()
      .patch(`${route()}/${draft.id}`)
      .set('Authorization', auth())
      .send({
        expectedOrderVersion: 3,
        terms: { saleType: 'CASH', creditTermDays: null },
      })
      .expect(409);
    await prisma.salesProduct.update({
      where: { id: poultryId },
      data: { name: 'Renamed after confirmation' },
    });
    const detail = await api()
      .get(`${route()}/${draft.id}`)
      .set('Authorization', auth())
      .expect(200);
    expect(detail.body.data.lines[0].productName).toBe('Market birds');
    const events = await api()
      .get(`${route()}/${draft.id}/events`)
      .set('Authorization', auth())
      .expect(200);
    expect(orderEventListResponseSchema.safeParse(events.body).success).toBe(
      true,
    );
    expect(
      events.body.data.map((event: { action: string }) => event.action),
    ).toEqual(['CONFIRMED', 'AMENDED', 'CREATED']);
    expect(events.body.data).not.toContainEqual(
      expect.objectContaining({ farmId: expect.anything() }),
    );
  });

  it('cancels drafts and confirmed orders once, retaining append-only audit history', async () => {
    const draft = await createOrder();
    await api()
      .post(`${route()}/${draft.id}/cancel`)
      .set('Authorization', auth())
      .send({ expectedOrderVersion: 1, reason: 'Customer withdrew request' })
      .expect(200);
    await api()
      .post(`${route()}/${draft.id}/cancel`)
      .set('Authorization', auth())
      .send({ expectedOrderVersion: 1, reason: 'Repeat' })
      .expect(200);
    const cancelled = await prisma.order.findUniqueOrThrow({
      where: { id: draft.id },
    });
    expect(cancelled.commercialState).toBe('CANCELLED');
    expect(cancelled.version).toBe(2);
    expect(
      await prisma.orderEvent.count({ where: { orderId: draft.id } }),
    ).toBe(2);
    await api()
      .patch(`${route()}/${draft.id}`)
      .set('Authorization', auth())
      .send({
        expectedOrderVersion: 2,
        terms: { saleType: 'CREDIT', creditTermDays: 10 },
      })
      .expect(409);

    const confirmed = await createOrder();
    await api()
      .post(`${route()}/${confirmed.id}/confirm`)
      .set('Authorization', auth())
      .send({ expectedOrderVersion: 1 })
      .expect(200);
    await api()
      .post(`${route()}/${confirmed.id}/cancel`)
      .set('Authorization', auth())
      .send({ expectedOrderVersion: 2, reason: 'Close remaining demand' })
      .expect(200);
    const confirmedCancelled = await api()
      .post(`${route()}/${confirmed.id}/cancel`)
      .set('Authorization', auth())
      .send({ expectedOrderVersion: 2, reason: 'Retry after lost response' })
      .expect(200);
    expect(confirmedCancelled.body.data.commercialState).toBe('CANCELLED');
    expect(
      await prisma.orderEvent.count({ where: { orderId: confirmed.id } }),
    ).toBe(3);
  });

  it('isolates organizations, restricts order writes from STAFF, and redacts operational fields', async () => {
    const foreignCustomer = await prisma.customer.create({
      data: {
        organizationId: foreignOrg,
        code: 'CUS-000001',
        type: 'BUSINESS',
        name: 'Foreign customer',
      },
    });
    await api()
      .post(route())
      .set('Authorization', auth())
      .send({ ...createInput(), customerId: foreignCustomer.id })
      .expect(404);
    await api()
      .post(route())
      .set('Authorization', auth('staff'))
      .send(createInput())
      .expect(403);
    const draft = await createOrder();
    const staff = await api()
      .get(`${route()}/${draft.id}`)
      .set('Authorization', auth('staff'))
      .expect(200);
    expect(staff.body.data.sourceDetails).toEqual({ visibility: 'REDACTED' });
    expect(staff.body.data.lines[0]).not.toHaveProperty('inventoryItemId');
    await api()
      .get(`/api/organizations/${foreignOrg}/orders/${draft.id}`)
      .set('Authorization', auth())
      .expect(404);
  });

  it('filters and paginates organization-scoped orders with bounded shared contracts', async () => {
    await createOrder();
    await createOrder(createInput([produceLine()]));
    const response = await api()
      .get(`${route()}?page=1&pageSize=1&search=North&state=DRAFT`)
      .set('Authorization', auth())
      .expect(200);
    const parsed = orderListResponseSchema.safeParse(response.body);
    expect(
      parsed.success,
      JSON.stringify(parsed.success ? [] : parsed.error.issues),
    ).toBe(true);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.meta).toMatchObject({
      page: 1,
      pageSize: 1,
      totalItems: 2,
      totalPages: 2,
    });
    await api()
      .get(`${route()}?page=1&pageSize=101`)
      .set('Authorization', auth())
      .expect(400);
    const progress = await api()
      .get(`${route()}?progress=UNFULFILLED`)
      .set('Authorization', auth())
      .expect(200);
    expect(progress.body.data).toHaveLength(0);
    expect(progress.body.meta.totalItems).toBe(0);
  });

  it('does not guarantee creation retry idempotency: repeated requests create separate drafts', async () => {
    const payload = createInput();
    const first = await createOrder(payload);
    const retry = await createOrder(payload);
    expect(retry.id).not.toBe(first.id);
    expect(await prisma.order.count({ where: { organizationId: org } })).toBe(
      2,
    );
    expect(
      await prisma.orderEvent.count({
        where: { organizationId: org, action: 'CREATED' },
      }),
    ).toBe(2);
  });

  it('serializes concurrent draft amendments and rejects the stale version without a second event', async () => {
    const draft = await createOrder();
    const amend = (terms: object) =>
      api()
        .patch(`${route()}/${draft.id}`)
        .set('Authorization', auth())
        .send({ expectedOrderVersion: 1, terms });
    const [first, second] = await Promise.all([
      amend({ saleType: 'CREDIT', creditTermDays: 30 }),
      amend({ saleType: 'CASH', creditTermDays: null }),
    ]);
    expect([first.status, second.status].sort((a, b) => a - b)).toEqual([
      200, 409,
    ]);
    expect(
      await prisma.orderEvent.count({
        where: { orderId: draft.id, action: 'AMENDED' },
      }),
    ).toBe(1);
    expect(
      (await prisma.order.findUniqueOrThrow({ where: { id: draft.id } }))
        .version,
    ).toBe(2);
  });

  it('serializes confirm/cancel races into one valid lifecycle transition and one event', async () => {
    const draft = await createOrder();
    const [confirmed, cancelled] = await Promise.all([
      api()
        .post(`${route()}/${draft.id}/confirm`)
        .set('Authorization', auth())
        .send({ expectedOrderVersion: 1 }),
      api()
        .post(`${route()}/${draft.id}/cancel`)
        .set('Authorization', auth())
        .send({ expectedOrderVersion: 1, reason: 'Competing request' }),
    ]);
    expect([confirmed.status, cancelled.status].sort((a, b) => a - b)).toEqual([
      200, 409,
    ]);
    const saved = await prisma.order.findUniqueOrThrow({
      where: { id: draft.id },
    });
    expect(['CONFIRMED', 'CANCELLED']).toContain(saved.commercialState);
    expect(saved.version).toBe(2);
    expect(
      await prisma.orderEvent.count({ where: { orderId: draft.id } }),
    ).toBe(2);
    expect(
      await prisma.inventoryMovement.count({ where: { organizationId: org } }),
    ).toBe(0);
    expect(
      await prisma.fulfilment.count({ where: { organizationId: org } }),
    ).toBe(0);
    expect(
      await prisma.flockSaleDepletion.count({ where: { organizationId: org } }),
    ).toBe(0);
  });
});
