import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import {
  salesProductResponseSchema,
  salesProductListResponseSchema,
  poultryProductSourceListResponseSchema,
} from '@ancastle/validation';
import { temporaryDatabase } from '../../test/temporary-database.js';
import { DatabaseModule } from '../../database/database.module.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { HttpExceptionFilter } from '../../common/filters/http-exception.filter.js';
import {
  lockMutation,
  type MutationLockPlan,
} from '../../database/mutation-locks.js';
import { OrganizationContext } from '../authorization/organization-context.js';
import { TokenService } from '../auth/token.service.js';
import { InventoryModule } from '../inventory/inventory.module.js';
import { SalesCatalogModule } from './sales-catalog.module.js';

function barrier<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
describe('Sales catalog API and source eligibility (PostgreSQL)', () => {
  let database: Awaited<ReturnType<typeof temporaryDatabase>>;
  let prisma: PrismaService;
  let app: INestApplication;
  let org: string,
    foreignOrg: string,
    farm: string,
    otherFarm: string,
    foreignFarm: string;
  let flock: string, otherFlock: string, foreignFlock: string;
  let item: string, foreignItem: string, feedItem: string, inactiveItem: string;
  let context: OrganizationContext;
  const users = {
    admin: randomUUID(),
    manager: randomUUID(),
    staff: randomUUID(),
  };
  const tokens: Record<string, string> = {};
  const api = () => request(app.getHttpServer());
  const auth = (role: keyof typeof users = 'admin') => 'Bearer ' + tokens[role];
  const products = () => `/api/organizations/${org}/sales-products`;
  const sources = (productId: string, farmId = farm) =>
    `/api/organizations/${org}/farms/${farmId}/sales-products/${productId}/poultry-sources`;
  const create = async (
    input: object = { name: 'Birds', kind: 'POULTRY' },
    role: keyof typeof users = 'admin',
  ) => {
    const response = await api()
      .post(products())
      .set('Authorization', auth(role))
      .send(input)
      .expect(201);
    expect(salesProductResponseSchema.safeParse(response.body).success).toBe(
      true,
    );
    return response.body.data;
  };
  const produce = () => ({
    name: 'Pumpkin',
    kind: 'PRODUCE',
    inventoryItemId: item,
    expectedInventoryUnit: 'KG',
  });
  const attach = (
    id: string,
    flockId = flock,
    farmId = farm,
    role: keyof typeof users = 'admin',
  ) =>
    api()
      .post(sources(id, farmId))
      .set('Authorization', auth(role))
      .send({ flockId });
  beforeAll(async () => {
    vi.stubEnv('JWT_SECRET', 'sales-catalog-integration-test-secret');
    database = await temporaryDatabase();
    prisma = database.prisma;
    await prisma.user.createMany({
      data: Object.values(users).map((id) => ({
        id,
        email: id + '@example.com',
        passwordHash: 'unused',
      })),
    });
    const module = await Test.createTestingModule({
      imports: [DatabaseModule, InventoryModule, SalesCatalogModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();
    for (const [role, id] of Object.entries(users))
      tokens[role] = await module
        .get(TokenService)
        .createAccessToken(id, id + '@example.com');
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
  }, 60_000);
  afterAll(async () => {
    await app?.close();
    await database?.dispose();
    vi.unstubAllEnvs();
  });
  beforeEach(async () => {
    org = randomUUID();
    foreignOrg = randomUUID();
    farm = randomUUID();
    otherFarm = randomUUID();
    foreignFarm = randomUUID();
    flock = randomUUID();
    otherFlock = randomUUID();
    foreignFlock = randomUUID();
    item = randomUUID();
    foreignItem = randomUUID();
    feedItem = randomUUID();
    inactiveItem = randomUUID();
    await prisma.organization.createMany({
      data: [org, foreignOrg].map((id) => ({ id, name: id, slug: id })),
    });
    const memberships = await Promise.all(
      Object.entries(users).map(([role, userId]) =>
        prisma.organizationMembership.create({
          data: {
            organizationId: org,
            userId,
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
    // Strong A permissions must not authorize even the same identity's weaker B membership.
    await prisma.organizationMembership.create({
      data: { organizationId: foreignOrg, userId: users.admin, role: 'STAFF' },
    });
    context = new OrganizationContext(
      org,
      memberships[0]!.id,
      users.admin,
      'ADMIN',
    );
    await prisma.farm.createMany({
      data: [
        { id: farm, organizationId: org, code: 'A', name: 'North' },
        { id: otherFarm, organizationId: org, code: 'B', name: 'South' },
        {
          id: foreignFarm,
          organizationId: foreignOrg,
          code: 'A',
          name: 'Foreign',
        },
      ],
    });
    await prisma.farmAccessAssignment.createMany({
      data: memberships.slice(1).map((member) => ({
        organizationId: org,
        membershipId: member.id,
        farmId: farm,
      })),
    });
    await prisma.flock.createMany({
      data: [
        {
          id: flock,
          organizationId: org,
          farmId: farm,
          code: 'FLK-1',
          name: 'North birds',
        },
        {
          id: otherFlock,
          organizationId: org,
          farmId: otherFarm,
          code: 'FLK-2',
          name: 'South birds',
        },
        {
          id: foreignFlock,
          organizationId: foreignOrg,
          farmId: foreignFarm,
          code: 'FLK-1',
          name: 'Foreign birds',
        },
      ].map((row) => ({
        ...row,
        placementDate: new Date('2026-11-01'),
        startingBirdCount: 100,
      })),
    });
    await prisma.inventoryItem.createMany({
      data: [
        {
          id: item,
          organizationId: org,
          code: 'INV-1',
          name: 'Pumpkin',
          category: 'PRODUCE',
          unit: 'KG',
        },
        {
          id: foreignItem,
          organizationId: foreignOrg,
          code: 'INV-1',
          name: 'Foreign',
          category: 'PRODUCE',
          unit: 'KG',
        },
        {
          id: feedItem,
          organizationId: org,
          code: 'INV-2',
          name: 'Feed',
          category: 'FEED',
          unit: 'KG',
        },
        {
          id: inactiveItem,
          organizationId: org,
          code: 'INV-3',
          name: 'Inactive produce',
          category: 'PRODUCE',
          unit: 'EACH',
          isActive: false,
        },
      ],
    });
  });

  it('creates both typed products with server-owned identities and no ledger/population effects', async () => {
    const poultry = await create();
    const vegetable = await create(produce(), 'manager');
    expect(poultry).toMatchObject({
      code: 'PRD-000001',
      kind: 'POULTRY',
      unit: 'EACH',
      isActive: true,
    });
    expect(poultry).not.toHaveProperty('inventoryItemId');
    expect(vegetable).toMatchObject({
      code: 'PRD-000002',
      inventoryItemId: item,
      unit: 'KG',
    });
    await attach(poultry.id).expect(201);
    expect(
      await prisma.inventoryMovement.count({ where: { organizationId: org } }),
    ).toBe(0);
    expect(
      await prisma.flockSaleDepletion.count({ where: { organizationId: org } }),
    ).toBe(0);
    expect(
      await prisma.mortalityEvent.count({ where: { organizationId: org } }),
    ).toBe(0);
    expect(
      await prisma.flock.findUniqueOrThrow({ where: { id: flock } }),
    ).toMatchObject({ startingBirdCount: 100 });
  });

  it('rejects client-owned fields, non-EACH poultry and invalid/inactive/foreign produce definitions', async () => {
    for (const extra of [
      { unit: 'KG' },
      { inventoryItemId: item },
      { organizationId: foreignOrg },
      { code: 'X' },
      { isActive: false },
      { actorUserId: users.staff },
      { farmId: farm },
    ])
      await api()
        .post(products())
        .set('Authorization', auth())
        .send({ name: 'Birds', kind: 'POULTRY', ...extra })
        .expect(400);
    for (const inventoryItemId of [
      foreignItem,
      feedItem,
      inactiveItem,
      randomUUID(),
    ]) {
      const response = await api()
        .post(products())
        .set('Authorization', auth())
        .send({ ...produce(), inventoryItemId })
        .expect(409);
      expect(response.body.error.code).toBe('SALES_PRODUCE_SOURCE_INELIGIBLE');
    }
    const stale = await api()
      .post(products())
      .set('Authorization', auth())
      .send({ ...produce(), expectedInventoryUnit: 'EACH' })
      .expect(409);
    expect(stale.body.error.code).toBe('INVENTORY_DEFINITION_CHANGED');
    expect(
      await prisma.salesProduct.count({ where: { organizationId: org } }),
    ).toBe(0);
  });

  it('enforces authenticated organization permissions and scoped product existence', async () => {
    const product = await create();
    await api().get(products()).expect(401);
    await api().get(products()).set('Authorization', auth('staff')).expect(200);
    await api()
      .post(products())
      .set('Authorization', auth('staff'))
      .send({ name: 'Denied', kind: 'POULTRY' })
      .expect(403);
    await api()
      .patch(products() + '/' + product.id)
      .set('Authorization', auth('staff'))
      .send({ name: 'Denied' })
      .expect(403);
    await api()
      .post(products() + '/' + product.id + '/deactivate')
      .set('Authorization', auth('staff'))
      .send({})
      .expect(403);
    await api()
      .post(`/api/organizations/${foreignOrg}/sales-products`)
      .set('Authorization', auth())
      .send({ name: 'Denied', kind: 'POULTRY' })
      .expect(403);
    await api()
      .get(`/api/organizations/${foreignOrg}/sales-products/${product.id}`)
      .set('Authorization', auth())
      .expect(404);
    await api()
      .get(`/api/organizations/${randomUUID()}/sales-products`)
      .set('Authorization', auth())
      .expect(403);
    for (const target of [product.id, randomUUID()])
      await api()
        .get(`/api/organizations/${foreignOrg}/sales-products/${target}`)
        .set('Authorization', auth())
        .expect(404);
  });

  it('bounds pagination, searches code/name and filters kind/lifecycle before counting', async () => {
    const one = await create({ name: 'Alpha bird', kind: 'POULTRY' });
    await create({ ...produce(), name: 'Alpha produce' });
    await create({ name: 'Other bird', kind: 'POULTRY' });
    await api()
      .post(products() + '/' + one.id + '/deactivate')
      .set('Authorization', auth())
      .send({})
      .expect(201);
    const result = await api()
      .get(products() + '?search=alpha&pageSize=1&page=2')
      .set('Authorization', auth())
      .expect(200);
    expect(salesProductListResponseSchema.safeParse(result.body).success).toBe(
      true,
    );
    expect(result.body.meta).toMatchObject({
      totalItems: 2,
      totalPages: 2,
      page: 2,
    });
    expect(result.body.data[0].kind).toBe('PRODUCE');
    const filtered = await api()
      .get(products() + '?kind=POULTRY&isActive=true')
      .set('Authorization', auth())
      .expect(200);
    expect(filtered.body.meta.totalItems).toBe(1);
    expect(
      (
        await api()
          .get(products() + '?search=PRD-000001')
          .set('Authorization', auth())
          .expect(200)
      ).body.data[0].id,
    ).toBe(one.id);
    expect(
      (
        await api()
          .get(products() + '?page=1000000')
          .set('Authorization', auth())
          .expect(200)
      ).body.data,
    ).toEqual([]);
    for (const query of [
      'page=0',
      'pageSize=101',
      'page=1000001',
      'kind=EGGS',
      'farmId=' + farm,
      'search=' + 'x'.repeat(121),
    ])
      await api()
        .get(products() + '?' + query)
        .set('Authorization', auth())
        .expect(400);
    const choices = await api()
      .get(
        `/api/organizations/${org}/inventory-items?category=PRODUCE&isActive=true&pageSize=1`,
      )
      .set('Authorization', auth())
      .expect(200);
    expect(choices.body.meta.totalItems).toBe(1);
    expect(choices.body.data[0].id).toBe(item);
    await api()
      .get(`/api/organizations/${org}/inventory-items?category=BIRDS`)
      .set('Authorization', auth())
      .expect(400);
  });

  it('allows explicit unreferenced relinks, freezes catalog-linked inventory and revalidates product activation', async () => {
    const product = await create();
    await api()
      .patch(products() + '/' + product.id)
      .set('Authorization', auth())
      .send({
        name: 'Vegetables',
        definition: {
          kind: 'PRODUCE',
          inventoryItemId: item,
          expectedInventoryUnit: 'KG',
        },
      })
      .expect(200);
    const frozen = await api()
      .patch(`/api/organizations/${org}/inventory-items/${item}`)
      .set('Authorization', auth())
      .send({ unit: 'EACH' })
      .expect(409);
    expect(frozen.body.error.code).toBe('INVENTORY_DEFINITION_FROZEN');
    await api()
      .post(products() + '/' + product.id + '/deactivate')
      .set('Authorization', auth())
      .send({})
      .expect(201);
    await api()
      .post(products() + '/' + product.id + '/deactivate')
      .set('Authorization', auth())
      .send({})
      .expect(201);
    await prisma.inventoryItem.update({
      where: { id: item },
      data: { isActive: false },
    });
    await api()
      .post(products() + '/' + product.id + '/reactivate')
      .set('Authorization', auth())
      .send({})
      .expect(409);
    expect(
      (
        await prisma.salesProduct.findUniqueOrThrow({
          where: { id: product.id },
        })
      ).isActive,
    ).toBe(false);
    await prisma.inventoryItem.update({
      where: { id: item },
      data: { isActive: true },
    });
    await api()
      .post(products() + '/' + product.id + '/reactivate')
      .set('Authorization', auth())
      .send({})
      .expect(201);
    await api()
      .post(products() + '/' + product.id + '/reactivate')
      .set('Authorization', auth())
      .send({})
      .expect(201);
  });

  it('freezes confirmed produce identity while allowing names and lifecycle without rewriting snapshots', async () => {
    const product = await create(produce());
    const customer = await prisma.customer.create({
      data: {
        organizationId: org,
        code: 'CUS-1',
        name: 'Buyer',
        type: 'INDIVIDUAL',
      },
    });
    const order = await prisma.order.create({
      data: {
        organizationId: org,
        code: 'ORD-1',
        customerId: customer.id,
        customerCode: customer.code,
        customerName: customer.name,
        saleType: 'CASH',
        actorUserId: users.admin,
      },
    });
    const line = await prisma.orderLine.create({
      data: {
        organizationId: org,
        orderId: order.id,
        lineNumber: 1,
        productId: product.id,
        productCode: product.code,
        productName: product.name,
        kind: 'PRODUCE',
        unit: 'KG',
        inventoryItemId: item,
        orderedQuantity: '2.5',
        unitPrice: '10',
      },
    });
    await prisma.order.update({
      where: { id: order.id },
      data: { commercialState: 'CONFIRMED', version: 2 },
    });
    const result = await api()
      .patch(products() + '/' + product.id)
      .set('Authorization', auth())
      .send({ definition: { kind: 'POULTRY' } })
      .expect(409);
    expect(result.body.error.code).toBe('SALES_PRODUCT_DEFINITION_FROZEN');
    await api()
      .patch(products() + '/' + product.id)
      .set('Authorization', auth())
      .send({ name: 'Renamed produce' })
      .expect(200);
    await api()
      .post(products() + '/' + product.id + '/deactivate')
      .set('Authorization', auth())
      .send({})
      .expect(201);
    expect(
      (await prisma.orderLine.findUniqueOrThrow({ where: { id: line.id } }))
        .productName,
    ).toBe(product.name);
  });

  it('separates catalog visibility from farm sources and uses the current actor grants', async () => {
    const product = await create();
    await attach(product.id).expect(201);
    const south = await attach(product.id, otherFlock, otherFarm).expect(201);
    const catalog = await api()
      .get(products() + '/' + product.id)
      .set('Authorization', auth('staff'))
      .expect(200);
    expect(Object.keys(catalog.body.data).sort()).toEqual(
      [
        'id',
        'code',
        'name',
        'kind',
        'unit',
        'isActive',
        'createdAt',
        'updatedAt',
      ].sort(),
    );
    expect(JSON.stringify(catalog.body)).not.toContain(south.body.data.id);
    expect(JSON.stringify(catalog.body)).not.toContain(otherFlock);
    const permitted = await api()
      .get(sources(product.id))
      .set('Authorization', auth('staff'))
      .expect(200);
    expect(
      poultryProductSourceListResponseSchema.safeParse(permitted.body).success,
    ).toBe(true);
    expect(permitted.body.meta.totalItems).toBe(1);
    expect(permitted.body.data[0].flockId).toBe(flock);
    for (const role of ['manager', 'staff'] as const)
      await api()
        .get(sources(product.id, otherFarm))
        .set('Authorization', auth(role))
        .expect(403);
    await attach(product.id, otherFlock, otherFarm, 'manager').expect(403);
    await attach(product.id, flock, farm, 'staff').expect(403);
    await api()
      .get(sources(product.id, foreignFarm))
      .set('Authorization', auth())
      .expect(403);
    await prisma.farmAccessAssignment.updateMany({
      where: { farmId: farm },
      data: { isActive: false },
    });
    await api()
      .get(sources(product.id))
      .set('Authorization', auth('staff'))
      .expect(403);
    await api().get(products()).set('Authorization', auth('staff')).expect(200);
  });

  it('keeps pair identity unique and immutable, requires explicit reactivation and derives eligibility', async () => {
    const product = await create();
    const first = await attach(product.id).expect(201);
    const id = first.body.data.id;
    expect((await attach(product.id).expect(201)).body.data.id).toBe(id);
    await attach(product.id, otherFlock).expect(404);
    await attach(product.id, foreignFlock).expect(404);
    const sourcePath = sources(product.id) + '/' + id;
    await api()
      .patch(sourcePath)
      .set('Authorization', auth())
      .send({ flockId: otherFlock })
      .expect(404);
    await api().delete(sourcePath).set('Authorization', auth()).expect(404);
    await api()
      .post(sources(product.id))
      .set('Authorization', auth())
      .send({ flockId: flock, actorUserId: users.staff })
      .expect(400);
    await api()
      .post(sourcePath + '/deactivate')
      .set('Authorization', auth())
      .send({})
      .expect(201);
    const inactive = await attach(product.id).expect(409);
    expect(inactive.body.error.code).toBe('POULTRY_SOURCE_INACTIVE');
    const frozen = await api()
      .patch(products() + '/' + product.id)
      .set('Authorization', auth())
      .send({
        definition: {
          kind: 'PRODUCE',
          inventoryItemId: item,
          expectedInventoryUnit: 'KG',
        },
      })
      .expect(409);
    expect(frozen.body.error.code).toBe('SALES_PRODUCT_DEFINITION_FROZEN');
    await prisma.flock.update({
      where: { id: flock },
      data: { isActive: false },
    });
    await api()
      .post(sourcePath + '/reactivate')
      .set('Authorization', auth())
      .send({})
      .expect(409);
    await prisma.flock.update({
      where: { id: flock },
      data: { isActive: true },
    });
    await api()
      .post(sourcePath + '/reactivate')
      .set('Authorization', auth())
      .send({})
      .expect(201);
    await api()
      .post(sourcePath + '/reactivate')
      .set('Authorization', auth())
      .send({})
      .expect(201);
    await api()
      .post(products() + '/' + product.id + '/deactivate')
      .set('Authorization', auth())
      .send({})
      .expect(201);
    const view = await api()
      .get(sources(product.id) + '?isActive=true&pageSize=1')
      .set('Authorization', auth())
      .expect(200);
    expect(view.body.data[0]).toMatchObject({
      id,
      isActive: true,
      isEligible: false,
      productIsActive: false,
      actorUserId: users.admin,
    });
    expect(
      await prisma.poultryProductSource.count({
        where: { organizationId: org, productId: product.id },
      }),
    ).toBe(1);
    await api()
      .get(sources(product.id, otherFarm) + '/' + id)
      .set('Authorization', auth())
      .expect(404);
    await api()
      .post(sources(product.id, otherFarm) + '/' + id + '/deactivate')
      .set('Authorization', auth())
      .send({})
      .expect(404);
  });

  it('rejects invalid/inactive sources and all inactive authentication states without writes', async () => {
    const product = await create();
    const vegetable = await create(produce());
    await attach(vegetable.id).expect(409);
    await prisma.flock.update({
      where: { id: flock },
      data: { isActive: false },
    });
    await attach(product.id).expect(409);
    await prisma.flock.update({
      where: { id: flock },
      data: { isActive: true },
    });
    await api()
      .post(products() + '/' + product.id + '/deactivate')
      .set('Authorization', auth())
      .send({})
      .expect(201);
    await attach(product.id).expect(409);
    await prisma.farm.update({
      where: { id: farm },
      data: { isActive: false },
    });
    await attach(product.id).expect(403);
    await prisma.farm.update({ where: { id: farm }, data: { isActive: true } });
    await prisma.user.update({
      where: { id: users.admin },
      data: { isActive: false },
    });
    await api().get(products()).set('Authorization', auth()).expect(401);
    await prisma.user.update({
      where: { id: users.admin },
      data: { isActive: true },
    });
    await prisma.organizationMembership.updateMany({
      where: { organizationId: org, userId: users.manager },
      data: { isActive: false },
    });
    await api()
      .get(products())
      .set('Authorization', auth('manager'))
      .expect(403);
    await prisma.organization.update({
      where: { id: org },
      data: { isActive: false },
    });
    await api().get(products()).set('Authorization', auth()).expect(403);
    expect(
      await prisma.poultryProductSource.count({
        where: { organizationId: org },
      }),
    ).toBe(0);
  });

  async function whileLocked<T>(
    plan: MutationLockPlan,
    work: (tx: Prisma.TransactionClient) => Promise<unknown>,
    start: () => Promise<T>,
  ) {
    const acquired = barrier<number>(),
      release = barrier();
    const holding = prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET LOCAL lock_timeout = '8s'`;
        await lockMutation(tx, context, plan);
        await work(tx);
        const [row] = await tx.$queryRaw<
          { pid: number }[]
        >`SELECT pg_backend_pid() AS pid`;
        acquired.resolve(row!.pid);
        await release.promise;
      },
      { timeout: 15_000 },
    );
    void holding.catch(() => {});
    const pid = await acquired.promise;
    const competing = start();
    void competing.catch(() => {});
    try {
      const deadline = Date.now() + 5000;
      let blocked = false;
      while (Date.now() < deadline) {
        const [row] = await prisma.$queryRaw<
          { waiting: boolean }[]
        >`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE ${pid} = ANY(pg_blocking_pids(pid))) AS waiting`;
        if (row!.waiting) {
          blocked = true;
          break;
        }
      }
      expect(blocked).toBe(true);
    } finally {
      release.resolve();
    }
    await holding;
    return competing;
  }
  it('serializes concurrent attachment retries to one stable eligibility identity', async () => {
    const product = await create();
    const results = await whileLocked(
      { flocks: [{ farmId: farm, flockId: flock }] },
      async () => {},
      () =>
        Promise.all([
          attach(product.id).then((response) => response),
          attach(product.id).then((response) => response),
        ]),
    );
    expect(results.map((response) => response.status)).toEqual([201, 201]);
    expect(results[0]!.body.data.id).toBe(results[1]!.body.data.id);
    expect(
      await prisma.poultryProductSource.count({
        where: { organizationId: org, productId: product.id },
      }),
    ).toBe(1);
  });
  it('rechecks a stale produce unit when a concurrent definition edit wins', async () => {
    const result = await whileLocked(
      { definitions: { inventory_items: [{ id: item, mode: 'UPDATE' }] } },
      (tx) =>
        tx.inventoryItem.update({
          where: { id: item },
          data: { unit: 'EACH' },
        }),
      () =>
        api()
          .post(products())
          .set('Authorization', auth())
          .send(produce())
          .then((response) => response),
    );
    expect(result.status).toBe(409);
    expect(result.body.error.code).toBe('INVENTORY_DEFINITION_CHANGED');
    expect(
      await prisma.salesProduct.count({ where: { organizationId: org } }),
    ).toBe(0);
  });
  it('rejects a stale complete lock plan after a concurrent produce relink', async () => {
    const product = await create(produce());
    const next = await prisma.inventoryItem.create({
      data: {
        organizationId: org,
        code: 'INV-4',
        name: 'Greens',
        category: 'PRODUCE',
        unit: 'G',
      },
    });
    const result = await whileLocked(
      {
        definitions: {
          sales_products: [{ id: product.id, mode: 'UPDATE' }],
          inventory_items: [{ id: item }, { id: next.id }],
        },
      },
      (tx) =>
        tx.salesProduct.update({
          where: { id: product.id },
          data: { inventoryItemId: next.id, unit: next.unit },
        }),
      () =>
        api()
          .patch(products() + '/' + product.id)
          .set('Authorization', auth())
          .send({ name: 'Stale rename' })
          .then((response) => response),
    );
    expect(result.status).toBe(409);
    expect(result.body.error.code).toBe('CONCURRENT_UPDATE');
    expect(
      await prisma.salesProduct.findUniqueOrThrow({
        where: { id: product.id },
      }),
    ).toMatchObject({
      name: product.name,
      inventoryItemId: next.id,
      unit: 'G',
    });
  });
  it('takes the flock mutation lock before eligibility checks during concurrent closure', async () => {
    const product = await create();
    const result = await whileLocked(
      { flocks: [{ farmId: farm, flockId: flock }] },
      (tx) =>
        tx.flock.update({ where: { id: flock }, data: { isActive: false } }),
      () => attach(product.id).then((response) => response),
    );
    expect(result.status).toBe(409);
    expect(result.body.error.code).toBe('POULTRY_SOURCE_INELIGIBLE');
    expect(
      await prisma.poultryProductSource.count({
        where: { organizationId: org },
      }),
    ).toBe(0);
  });
});
