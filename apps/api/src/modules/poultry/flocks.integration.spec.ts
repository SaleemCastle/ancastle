import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { temporaryDatabase } from '../../test/temporary-database.js';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { HttpExceptionFilter } from '../../common/filters/http-exception.filter.js';
import { TokenService } from '../auth/token.service.js';
import { OrganizationContext } from '../authorization/organization-context.js';
import { InventoryStockService } from '../inventory/inventory-stock.service.js';
import { PoultryModule } from './poultry.module.js';
import { MortalityService } from './mortality.service.js';
import { FeedUsageService } from './feed-usage.service.js';

describe('Flock operations API (HTTP + PostgreSQL)', () => {
  let database: Awaited<ReturnType<typeof temporaryDatabase>>;
  let app: INestApplication;
  let prisma: PrismaService;
  let stock: InventoryStockService;
  let mortality: MortalityService;
  let feed: FeedUsageService;
  let context: OrganizationContext;
  let org: string,
    foreignOrg: string,
    farm: string,
    otherFarm: string,
    foreignFarm: string;
  let flock: string,
    otherFlock: string,
    foreignFlock: string,
    item: string,
    foreignItem: string;
  const users = {
    admin: randomUUID(),
    manager: randomUUID(),
    staff: randomUUID(),
  };
  const memberships = {
    admin: randomUUID(),
    manager: randomUUID(),
    staff: randomUUID(),
  };
  const tokens: Record<string, string> = {};
  const date = { ageAndMaturityAsOfDate: '2026-11-10' };
  // Events are later than the age/maturity date: totals must still include them.
  const occurredAt = '2026-11-20T12:00:00.000Z';
  const definition = {
    name: 'Broiler placement',
    birdType: 'Broiler',
    startingBirdCount: 100,
    placementDate: '2026-11-01',
    expectedMaturityDate: '2026-12-01',
  };
  const api = () => request(app.getHttpServer());
  const auth = (role: keyof typeof users = 'admin') => `Bearer ${tokens[role]}`;
  const path = (selectedFarm = farm, selectedOrg = org) =>
    `/api/organizations/${selectedOrg}/farms/${selectedFarm}/flocks`;
  const postMortality = (deathCount = 3, role: keyof typeof users = 'staff') =>
    api()
      .post(`${path()}/${flock}/mortality`)
      .set('Authorization', auth(role))
      .send({
        deathCount,
        occurredAt,
        cause: 'Natural',
        note: 'Daily check',
        reference: 'DAY-1',
      });
  const postFeed = (
    quantity: string | number = '1.125',
    role: keyof typeof users = 'staff',
  ) =>
    api()
      .post(`${path()}/${flock}/feed-usage`)
      .set('Authorization', auth(role))
      .send({
        inventoryItemId: item,
        quantity,
        occurredAt,
        note: 'Morning feed',
        reference: 'FEED-1',
      });

  beforeAll(async () => {
    vi.stubEnv('JWT_SECRET', 'flock-api-test-secret');
    database = await temporaryDatabase();
    prisma = database.prisma;
    const module = await Test.createTestingModule({ imports: [PoultryModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();
    stock = module.get(InventoryStockService);
    mortality = module.get(MortalityService);
    feed = module.get(FeedUsageService);
    for (const role of Object.keys(users) as (keyof typeof users)[]) {
      tokens[role] = await module
        .get(TokenService)
        .createAccessToken(users[role], `${users[role]}@example.com`);
    }
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
    await prisma.user.createMany({
      data: Object.values(users).map((id) => ({
        id,
        email: `${id}@example.com`,
        passwordHash: 'unused',
      })),
    });
  }, 60_000);

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
    // Preserve all immutable history; each case owns new organization fixtures.
    await prisma.organization.createMany({
      data: [org, foreignOrg].map((id) => ({ id, name: 'Poultry', slug: id })),
    });
    const memberIds = {
      admin: randomUUID(),
      manager: randomUUID(),
      staff: randomUUID(),
    };
    Object.assign(memberships, memberIds);
    await prisma.organizationMembership.createMany({
      data: [
        ...(['admin', 'manager', 'staff'] as const).map((role) => ({
          id: memberships[role],
          organizationId: org,
          userId: users[role],
          role: role.toUpperCase() as 'ADMIN' | 'MANAGER' | 'STAFF',
        })),
        // A stronger role in a different organization must not grant local manage.
        { organizationId: foreignOrg, userId: users.staff, role: 'OWNER' },
      ],
    });
    context = new OrganizationContext(
      org,
      memberships.admin,
      users.admin,
      'ADMIN',
    );
    await prisma.farm.createMany({
      data: [
        { id: farm, organizationId: org, code: '01', name: 'North' },
        { id: otherFarm, organizationId: org, code: '02', name: 'South' },
        {
          id: foreignFarm,
          organizationId: foreignOrg,
          code: '01',
          name: 'Foreign',
        },
      ],
    });
    await prisma.farmAccessAssignment.createMany({
      data: ['manager', 'staff'].map((role) => ({
        organizationId: org,
        farmId: farm,
        membershipId: memberships[role as 'manager' | 'staff'],
      })),
    });
    await prisma.flock.createMany({
      data: [
        { id: flock, organizationId: org, farmId: farm, code: 'FLK-000001' },
        {
          id: otherFlock,
          organizationId: org,
          farmId: otherFarm,
          code: 'FLK-000002',
        },
        {
          id: foreignFlock,
          organizationId: foreignOrg,
          farmId: foreignFarm,
          code: 'FLK-000001',
        },
      ].map((scope) => ({
        ...scope,
        ...definition,
        placementDate: new Date(definition.placementDate),
        expectedMaturityDate: new Date(definition.expectedMaturityDate),
      })),
    });
    await prisma.inventoryItem.createMany({
      data: [
        { id: item, organizationId: org },
        { id: foreignItem, organizationId: foreignOrg },
      ].map((scope) => ({
        ...scope,
        code: 'INV-000001',
        name: 'Feed',
        category: 'FEED' as const,
        unit: 'KG' as const,
      })),
    });
    await stock.postMovement(context, {
      farmId: farm,
      inventoryItemId: item,
      quantity: new Prisma.Decimal('10'),
      reason: 'RECEIPT',
      occurredAt: new Date(occurredAt),
    });
  });

  afterAll(async () => {
    await app?.close();
    await database?.dispose();
    vi.unstubAllEnvs();
  });

  it('supports assigned manager create/list/detail/update and idempotent lifecycle without deleting history', async () => {
    const created = await api()
      .post(path())
      .set('Authorization', auth('manager'))
      .send(definition)
      .expect(201);
    const id = created.body.data.id;
    expect(created.body.data).toMatchObject({
      code: 'FLK-000003',
      farmId: farm,
      startingBirdCount: 100,
      isActive: true,
    });
    expect(created.body.data).not.toHaveProperty('organizationId');
    const updated = await api()
      .patch(`${path()}/${id}`)
      .set('Authorization', auth('manager'))
      .send({
        name: 'Updated',
        birdType: 'Layer',
        notes: 'Placement correction',
      })
      .expect(200);
    expect(updated.body.data.name).toBe('Updated');
    const list = await api()
      .get(path())
      .query({
        ...date,
        search: 'updated',
        birdType: 'Layer',
        isActive: 'true',
        pageSize: 1,
      })
      .set('Authorization', auth('staff'))
      .expect(200);
    expect(list.body.meta).toEqual({
      page: 1,
      pageSize: 1,
      totalItems: 1,
      totalPages: 1,
    });
    expect(list.body.data[0]).toMatchObject({
      id,
      metrics: { liveBirdCount: 100, ageDays: 9 },
    });
    const detail = await api()
      .get(`${path()}/${id}`)
      .query(date)
      .set('Authorization', auth('staff'))
      .expect(200);
    expect(detail.body.data).toEqual(list.body.data[0]);
    await postMortality().expect(201);
    for (const action of ['close', 'close', 'reactivate', 'reactivate']) {
      const response = await api()
        .post(`${path()}/${flock}/${action}`)
        .set('Authorization', auth('manager'))
        .send({})
        .expect(201);
      expect(response.body.data.isActive).toBe(action === 'reactivate');
      if (action === 'close') {
        expect((await postMortality().expect(404)).body.error.code).toBe(
          'FLOCK_NOT_FOUND',
        );
        expect((await postFeed().expect(404)).body.error.code).toBe(
          'FEED_USAGE_SCOPE_NOT_FOUND',
        );
        const history = await api()
          .get(`${path()}/${flock}/mortality`)
          .set('Authorization', auth('staff'))
          .expect(200);
        expect(history.body.meta.totalItems).toBe(1);
      }
    }
    expect(
      await prisma.mortalityEvent.count({ where: { flockId: flock } }),
    ).toBe(1);
  });

  it('filters existing maturity states before scoped counts/pagination, independently of lifecycle', async () => {
    await prisma.flock.update({
      where: { id: flock },
      data: {
        name: 'Maturity sample',
        expectedMaturityDate: new Date('2026-11-10'),
      },
    });
    const future = randomUUID(),
      closed = randomUUID(),
      unknown = randomUUID();
    await prisma.flock.createMany({
      data: [
        {
          id: future,
          code: 'FLK-000003',
          expectedMaturityDate: new Date('2026-11-11'),
          isActive: true,
        },
        {
          id: closed,
          code: 'FLK-000004',
          expectedMaturityDate: new Date('2026-11-12'),
          isActive: false,
        },
        {
          id: unknown,
          code: 'FLK-000005',
          expectedMaturityDate: null,
          isActive: true,
        },
      ].map((record) => ({
        ...record,
        organizationId: org,
        farmId: farm,
        name: 'Maturity sample',
        birdType: 'Broiler',
        startingBirdCount: 100,
        placementDate: new Date('2026-11-01'),
      })),
    });
    // Foreign/other-farm rows deliberately match the search and state as well.
    await prisma.flock.updateMany({
      where: { id: { in: [otherFlock, foreignFlock] } },
      data: { name: 'Maturity sample' },
    });
    const list = (extra: Record<string, string | number> = {}) =>
      api()
        .get(path())
        .set('Authorization', auth('staff'))
        .query({ ...date, search: 'maturity', birdType: 'Broiler', ...extra });
    const first = await list({
      maturityState: 'BEFORE_EXPECTED_MATURITY',
      pageSize: 1,
    }).expect(200);
    expect(first.body.meta).toEqual({
      page: 1,
      pageSize: 1,
      totalItems: 2,
      totalPages: 2,
    });
    expect(first.body.data.map((row: { id: string }) => row.id)).toEqual([
      future,
    ]);
    const second = await list({
      maturityState: 'BEFORE_EXPECTED_MATURITY',
      pageSize: 1,
      page: 2,
    }).expect(200);
    expect(second.body.meta).toEqual({
      page: 2,
      pageSize: 1,
      totalItems: 2,
      totalPages: 2,
    });
    expect(second.body.data[0]).toMatchObject({
      id: closed,
      isActive: false,
      metrics: { maturityState: 'BEFORE_EXPECTED_MATURITY', daysToMaturity: 2 },
    });
    const closedOnly = await list({
      maturityState: 'BEFORE_EXPECTED_MATURITY',
      isActive: 'false',
    }).expect(200);
    expect(closedOnly.body.meta.totalItems).toBe(1);
    expect(closedOnly.body.data[0].id).toBe(closed);
    const mature = await list({
      maturityState: 'AT_OR_PAST_EXPECTED_MATURITY',
    }).expect(200);
    expect(mature.body.data.map((row: { id: string }) => row.id)).toEqual([
      flock,
    ]);
    expect(mature.body.data[0].metrics).toMatchObject({
      maturityState: 'AT_OR_PAST_EXPECTED_MATURITY',
      daysToMaturity: 0,
    });
    const none = await list({
      maturityState: 'NO_EXPECTED_MATURITY_DATE',
    }).expect(200);
    expect(none.body.data.map((row: { id: string }) => row.id)).toEqual([
      unknown,
    ]);
    expect(none.body.data[0].metrics.daysToMaturity).toBeNull();
    const nextDay = await list({
      maturityState: 'AT_OR_PAST_EXPECTED_MATURITY',
      ageAndMaturityAsOfDate: '2026-11-11',
    }).expect(200);
    expect(nextDay.body.meta.totalItems).toBe(2);
    expect(nextDay.body.data.map((row: { id: string }) => row.id)).toEqual([
      flock,
      future,
    ]);
    const previousDay = await list({
      maturityState: 'AT_OR_PAST_EXPECTED_MATURITY',
      ageAndMaturityAsOfDate: '2026-11-09',
    }).expect(200);
    expect(previousDay.body.meta.totalItems).toBe(0);
    await list({ maturityState: 'APPROACHING_7_DAYS' }).expect(400);
  });

  it('validates each one-date PATCH against persisted counterpart and protects the mortality baseline', async () => {
    for (const input of [
      { placementDate: '2026-12-02' },
      { expectedMaturityDate: '2026-10-31' },
    ]) {
      const invalid = await api()
        .patch(`${path()}/${flock}`)
        .set('Authorization', auth())
        .send(input)
        .expect(400);
      expect(invalid.body.error.code).toBe('VALIDATION_ERROR');
      expect(invalid.body.error.fields.expectedMaturityDate).toBeDefined();
    }
    await api()
      .patch(`${path()}/${flock}`)
      .set('Authorization', auth())
      .send({ placementDate: '2026-11-02' })
      .expect(200);
    await api()
      .patch(`${path()}/${flock}`)
      .set('Authorization', auth())
      .send({ expectedMaturityDate: null })
      .expect(200);
    await postMortality(20).expect(201);
    const invalid = await api()
      .patch(`${path()}/${flock}`)
      .set('Authorization', auth())
      .send({ startingBirdCount: 19 })
      .expect(400);
    expect(invalid.body.error.code).toBe('FLOCK_OVER_MORTALITY');
    await api()
      .patch(`${path()}/${flock}`)
      .set('Authorization', auth())
      .send({ startingBirdCount: 20 })
      .expect(200);
    const detail = await api()
      .get(`${path()}/${flock}`)
      .query(date)
      .set('Authorization', auth())
      .expect(200);
    expect(detail.body.data.metrics).toMatchObject({
      startingBirdCount: 20,
      cumulativeMortality: 20,
      liveBirdCount: 0,
    });
    expect(
      await prisma.mortalityEvent.count({ where: { flockId: flock } }),
    ).toBe(1);
  });

  it('posts mortality/feed as STAFF, preserves audit fields and exposes current ledger metrics independently of age date', async () => {
    const mortality = await postMortality().expect(201);
    expect(mortality.body.data).toMatchObject({
      actorUserId: users.staff,
      deathCount: 3,
      cause: 'Natural',
      note: 'Daily check',
      reference: 'DAY-1',
      occurredAt,
      reversesEventId: null,
    });
    const feed = await postFeed().expect(201);
    expect(feed.body.data).toMatchObject({
      actorUserId: users.staff,
      quantity: '1.125',
      occurredAt,
      note: 'Morning feed',
      reference: 'FEED-1',
      reversesUsageId: null,
    });
    const movement = await prisma.inventoryMovement.findUniqueOrThrow({
      where: { id: feed.body.data.inventoryMovementId },
    });
    expect(movement.quantity.toString()).toBe('-1.125');
    expect(movement.reason).toBe('ISSUE');
    expect((await stock.getStockOnHand(context, farm, item)).toString()).toBe(
      '8.875',
    );
    const history = await api()
      .get(`${path()}/${flock}/mortality`)
      .set('Authorization', auth('staff'))
      .expect(200);
    expect(history.body.data).toEqual([mortality.body.data]);
    const feedHistory = await api()
      .get(`${path()}/${flock}/feed-usage`)
      .set('Authorization', auth('staff'))
      .expect(200);
    expect(feedHistory.body.data).toEqual([feed.body.data]);
    expect(history.body.data[0].createdAt).toEqual(expect.any(String));
    expect(history.body.data[0]).not.toHaveProperty('organizationId');
    const detail = await api()
      .get(`${path()}/${flock}`)
      .query(date)
      .set('Authorization', auth('staff'))
      .expect(200);
    expect(detail.body.data.metrics).toMatchObject({
      ...date,
      liveBirdCount: 97,
      cumulativeMortality: 3,
      mortalityPercentage: '3',
      ageDays: 9,
      ageWeeks: 1,
      daysToMaturity: 21,
      cumulativeFeedUsage: [
        { inventoryItemId: item, unit: 'KG', quantity: '1.125' },
      ],
    });
    const list = await api()
      .get(path())
      .query(date)
      .set('Authorization', auth())
      .expect(200);
    expect(list.body.data[0].metrics).toEqual(detail.body.data.metrics);
    const over = await postMortality(98).expect(400);
    expect(over.body.error.code).toBe('FLOCK_OVER_MORTALITY');
    const insufficient = await postFeed(9).expect(400);
    expect(insufficient.body.error.code).toBe('INSUFFICIENT_INVENTORY_STOCK');
    expect(await prisma.feedUsage.count({ where: { flockId: flock } })).toBe(1);
    expect(
      await prisma.inventoryMovement.count({ where: { organizationId: org } }),
    ).toBe(2);
    expect(
      await prisma.mortalityEvent.count({ where: { flockId: flock } }),
    ).toBe(1);
    const invalidDate = await api()
      .get(`${path()}/${flock}`)
      .query({ ageAndMaturityAsOfDate: '2026-10-31' })
      .set('Authorization', auth())
      .expect(400);
    expect(invalidDate.body.error.code).toBe('FLOCK_INVALID_AS_OF_DATE');
  });

  it('requires organization capability and a separate farm assignment for all workflows', async () => {
    await api().get(path()).query(date).expect(401);
    await api()
      .post(path())
      .set('Authorization', auth('staff'))
      .send(definition)
      .expect(403);
    await api()
      .patch(`${path()}/${flock}`)
      .set('Authorization', auth('staff'))
      .send({ name: 'Denied' })
      .expect(403);
    for (const action of ['close', 'reactivate'])
      await api()
        .post(`${path()}/${flock}/${action}`)
        .set('Authorization', auth('staff'))
        .send({})
        .expect(403);
    for (const role of ['staff', 'manager'] as const) {
      const missing = await api()
        .get(path(randomUUID()))
        .query(date)
        .set('Authorization', auth(role))
        .expect(403);
      for (const selectedFarm of [otherFarm, foreignFarm]) {
        const denied = await api()
          .get(path(selectedFarm))
          .query(date)
          .set('Authorization', auth(role))
          .expect(403);
        expect(denied.body).toEqual(missing.body);
        await api()
          .post(path(selectedFarm))
          .set('Authorization', auth(role))
          .send(definition)
          .expect(403);
        for (const suffix of ['', '/mortality', '/feed-usage']) {
          await api()
            .get(`${path(selectedFarm)}/${otherFlock}${suffix}`)
            .query(suffix ? {} : date)
            .set('Authorization', auth(role))
            .expect(403);
        }
        await api()
          .post(`${path(selectedFarm)}/${otherFlock}/mortality`)
          .set('Authorization', auth(role))
          .send({ deathCount: 1, occurredAt })
          .expect(403);
        await api()
          .post(`${path(selectedFarm)}/${otherFlock}/feed-usage`)
          .set('Authorization', auth(role))
          .send({ inventoryItemId: item, quantity: 1, occurredAt })
          .expect(403);
      }
    }
    // ADMIN has no assignment and retains access-all in its own organization.
    await api()
      .get(path(otherFarm))
      .query(date)
      .set('Authorization', auth())
      .expect(200);
    await api()
      .get(path(foreignFarm, foreignOrg))
      .query(date)
      .set('Authorization', auth())
      .expect(403);
  });

  it('hides foreign flock existence on detail, update, lifecycle, history and posting', async () => {
    for (const id of [otherFlock, foreignFlock, randomUUID()]) {
      const response = await api()
        .get(`${path()}/${id}`)
        .query(date)
        .set('Authorization', auth())
        .expect(404);
      expect(response.body.error.code).toBe('FLOCK_NOT_FOUND');
      await api()
        .patch(`${path()}/${id}`)
        .set('Authorization', auth())
        .send({ name: 'Denied' })
        .expect(404);
      for (const action of ['close', 'reactivate'])
        await api()
          .post(`${path()}/${id}/${action}`)
          .set('Authorization', auth())
          .send({})
          .expect(404);
      for (const kind of ['mortality', 'feed-usage'])
        await api()
          .get(`${path()}/${id}/${kind}`)
          .set('Authorization', auth())
          .expect(404);
      expect(
        (
          await api()
            .post(`${path()}/${id}/mortality`)
            .set('Authorization', auth())
            .send({ deathCount: 1, occurredAt })
            .expect(404)
        ).body.error.code,
      ).toBe('FLOCK_NOT_FOUND');
      expect(
        (
          await api()
            .post(`${path()}/${id}/feed-usage`)
            .set('Authorization', auth())
            .send({ inventoryItemId: item, quantity: 1, occurredAt })
            .expect(404)
        ).body.error.code,
      ).toBe('FEED_USAGE_SCOPE_NOT_FOUND');
    }
    expect(
      (
        await api()
          .post(`${path()}/${flock}/feed-usage`)
          .set('Authorization', auth())
          .send({ inventoryItemId: foreignItem, quantity: 1, occurredAt })
          .expect(404)
      ).body.error.code,
    ).toBe('FEED_USAGE_SCOPE_NOT_FOUND');
  });

  it('rejects malformed/shared contract bypasses and offers no destructive history routes', async () => {
    for (const field of [
      'organizationId',
      'farmId',
      'id',
      'isActive',
      'createdAt',
      'updatedAt',
      'liveBirdCount',
      'cumulativeMortality',
      'code',
    ]) {
      await api()
        .post(path())
        .set('Authorization', auth())
        .send({ ...definition, [field]: randomUUID() })
        .expect(400);
      await api()
        .patch(`${path()}/${flock}`)
        .set('Authorization', auth())
        .send({ name: 'Update', [field]: randomUUID() })
        .expect(400);
    }
    for (const field of [
      'organizationId',
      'farmId',
      'flockId',
      'actorUserId',
      'reversesEventId',
      'id',
      'createdAt',
    ]) {
      await api()
        .post(`${path()}/${flock}/mortality`)
        .set('Authorization', auth())
        .send({ deathCount: 1, occurredAt, [field]: randomUUID() })
        .expect(400);
    }
    for (const field of [
      'organizationId',
      'farmId',
      'flockId',
      'actorUserId',
      'reversesUsageId',
      'inventoryMovementId',
      'id',
      'createdAt',
    ]) {
      await api()
        .post(`${path()}/${flock}/feed-usage`)
        .set('Authorization', auth())
        .send({
          inventoryItemId: item,
          quantity: '1',
          occurredAt,
          [field]: randomUUID(),
        })
        .expect(400);
    }
    for (const quantity of [
      '0',
      '-1',
      '0.0001',
      'NaN',
      '',
      '1000000000000000',
      null,
    ]) {
      await api()
        .post(`${path()}/${flock}/feed-usage`)
        .set('Authorization', auth())
        .send({ inventoryItemId: item, quantity, occurredAt })
        .expect(400);
    }
    await api()
      .post(`${path()}/${flock}/mortality`)
      .set('Authorization', auth())
      .send({ deathCount: 1.5, occurredAt })
      .expect(400);
    await api()
      .post(`${path()}/${flock}/mortality`)
      .set('Authorization', auth())
      .send({ deathCount: 1, occurredAt: 'not-a-date' })
      .expect(400);
    await api()
      .post(`${path()}/${flock}/close`)
      .set('Authorization', auth())
      .send({ farmId: otherFarm })
      .expect(400);
    await api()
      .get(`${path()}/not-a-uuid`)
      .query(date)
      .set('Authorization', auth())
      .expect(400);
    await api()
      .get(path())
      .query({ ...date, pageSize: 101 })
      .set('Authorization', auth())
      .expect(400);
    await api().get(path()).set('Authorization', auth()).expect(400);
    await api()
      .get(`${path()}/${flock}`)
      .query({ ageAndMaturityAsOfDate: '2026-02-30' })
      .set('Authorization', auth())
      .expect(400);
    await api()
      .get(`${path()}/${flock}/mortality`)
      .query({ pageSize: 101 })
      .set('Authorization', auth())
      .expect(400);
    const event = await postMortality().expect(201);
    const usage = await postFeed().expect(201);
    for (const suffix of [
      `mortality/${event.body.data.id}`,
      `feed-usage/${usage.body.data.id}`,
      'mortality',
      'feed-usage',
    ]) {
      await api()
        .patch(`${path()}/${flock}/${suffix}`)
        .set('Authorization', auth())
        .send({})
        .expect(404);
      await api()
        .delete(`${path()}/${flock}/${suffix}`)
        .set('Authorization', auth())
        .expect(404);
    }
    await api()
      .delete(`${path()}/${flock}`)
      .set('Authorization', auth())
      .expect(404);
    expect(
      await prisma.mortalityEvent.count({ where: { flockId: flock } }),
    ).toBe(1);
    expect(await prisma.feedUsage.count({ where: { flockId: flock } })).toBe(1);
  }, 20_000);

  it('keeps populated flocks, histories and feed stock independent across two assigned farms', async () => {
    await prisma.farmAccessAssignment.create({
      data: {
        organizationId: org,
        farmId: otherFarm,
        membershipId: memberships.staff,
      },
    });
    const neighbour = await prisma.flock.create({
      data: {
        ...definition,
        organizationId: org,
        farmId: farm,
        code: 'FLK-000003',
        placementDate: new Date(definition.placementDate),
        expectedMaturityDate: new Date(definition.expectedMaturityDate),
      },
    });
    await stock.postMovement(context, {
      farmId: otherFarm,
      inventoryItemId: item,
      quantity: new Prisma.Decimal('7'),
      reason: 'RECEIPT',
      occurredAt: new Date(occurredAt),
    });
    for (const [selectedFarm, id, deathCount, quantity] of [
      [farm, flock, 3, '1.125'],
      [farm, neighbour.id, 5, '2'],
      [otherFarm, otherFlock, 9, '3'],
    ] as const) {
      const base = `${path(selectedFarm)}/${id}`;
      const event = await api()
        .post(`${base}/mortality`)
        .set('Authorization', auth('staff'))
        .send({ deathCount, occurredAt })
        .expect(201);
      const usage = await api()
        .post(`${base}/feed-usage`)
        .set('Authorization', auth('staff'))
        .send({ inventoryItemId: item, quantity, occurredAt })
        .expect(201);
      for (const [suffix, original] of [
        ['mortality', event.body.data],
        ['feed-usage', usage.body.data],
      ] as const) {
        const history = await api()
          .get(`${base}/${suffix}`)
          .set('Authorization', auth('staff'))
          .expect(200);
        expect(history.body.data).toEqual([original]);
        expect(history.body.meta.totalItems).toBe(1);
        expect(original.farmId).toBe(selectedFarm);
        expect(original.flockId).toBe(id);
      }
      const detail = await api()
        .get(base)
        .query(date)
        .set('Authorization', auth('staff'))
        .expect(200);
      expect(detail.body.data.metrics).toMatchObject({
        liveBirdCount: 100 - deathCount,
        cumulativeMortality: deathCount,
        cumulativeFeedUsage: [{ inventoryItemId: item, unit: 'KG', quantity }],
      });
    }
    for (const [selectedFarm, expectedIds] of [
      [farm, [flock, neighbour.id]],
      [otherFarm, [otherFlock]],
    ] as const) {
      const list = await api()
        .get(path(selectedFarm))
        .query(date)
        .set('Authorization', auth('staff'))
        .expect(200);
      expect(list.body.meta.totalItems).toBe(expectedIds.length);
      expect(
        list.body.data.map((entry: { id: string }) => entry.id).sort(),
      ).toEqual([...expectedIds].sort());
    }
    expect((await stock.getStockOnHand(context, farm, item)).toString()).toBe(
      '6.875',
    );
    expect(
      (await stock.getStockOnHand(context, otherFarm, item)).toString(),
    ).toBe('4');
  });

  it('keeps scoped originals and reversals visible in paginated poultry histories', async () => {
    const event = (await postMortality().expect(201)).body.data;
    const usage = (await postFeed().expect(201)).body.data;
    const correction = {
      occurredAt: new Date('2026-11-21T12:00:00.000Z'),
      note: 'Correction',
    };
    await expect(
      mortality.reverse(context, otherFarm, otherFlock, event.id, correction),
    ).rejects.toMatchObject({ code: 'MORTALITY_NOT_FOUND' });
    await expect(
      feed.reverse(context, otherFarm, usage.id, correction),
    ).rejects.toMatchObject({ code: 'FEED_USAGE_SCOPE_NOT_FOUND' });
    expect(
      await prisma.mortalityEvent.count({ where: { organizationId: org } }),
    ).toBe(1);
    expect(
      await prisma.feedUsage.count({ where: { organizationId: org } }),
    ).toBe(1);
    expect(
      await prisma.inventoryMovement.count({ where: { organizationId: org } }),
    ).toBe(2);
    expect(
      (await stock.getStockOnHand(context, otherFarm, item)).toString(),
    ).toBe('0');
    const reversedEvent = await mortality.reverse(
      context,
      farm,
      flock,
      event.id,
      correction,
    );
    const reversedUsage = await feed.reverse(
      context,
      farm,
      usage.id,
      correction,
    );
    for (const [suffix, original, reversal, link] of [
      ['mortality', event, reversedEvent, 'reversesEventId'],
      ['feed-usage', usage, reversedUsage, 'reversesUsageId'],
    ] as const) {
      for (const page of [1, 2]) {
        const history = await api()
          .get(`${path()}/${flock}/${suffix}`)
          .query({ page, pageSize: 1 })
          .set('Authorization', auth('staff'))
          .expect(200);
        expect(history.body.meta).toEqual({
          page,
          pageSize: 1,
          totalItems: 2,
          totalPages: 2,
        });
        expect(history.body.data).toHaveLength(1);
        if (page === 1) {
          expect(history.body.data[0]).toMatchObject({
            id: reversal.id,
            [link]: original.id,
            actorUserId: users.admin,
            note: correction.note,
            occurredAt: correction.occurredAt.toISOString(),
          });
        } else {
          expect(history.body.data).toEqual([original]);
        }
      }
    }
    const detail = await api()
      .get(`${path()}/${flock}`)
      .query(date)
      .set('Authorization', auth('staff'))
      .expect(200);
    expect(detail.body.data.metrics).toMatchObject({
      liveBirdCount: 100,
      cumulativeMortality: 0,
      mortalityPercentage: '0',
      cumulativeFeedUsage: [
        { inventoryItemId: item, unit: 'KG', quantity: '0' },
      ],
    });
    expect((await stock.getStockOnHand(context, farm, item)).toString()).toBe(
      '10',
    );
    const compensation = await prisma.inventoryMovement.findUniqueOrThrow({
      where: { id: reversedUsage.inventoryMovementId },
    });
    expect(compensation).toMatchObject({ farmId: farm, reason: 'ADJUSTMENT' });
    expect(compensation.quantity.toString()).toBe('1.125');
  });

  it('serializes a starting-population edit against mortality posting', async () => {
    const [edit, posting] = await Promise.all([
      api()
        .patch(`${path()}/${flock}`)
        .set('Authorization', auth())
        .send({ startingBirdCount: 40 }),
      postMortality(60),
    ]);
    expect([
      [200, 400],
      [400, 201],
    ]).toContainEqual([edit.status, posting.status]);
    const edited = edit.status === 200;
    expect((edited ? posting : edit).body.error.code).toBe(
      'FLOCK_OVER_MORTALITY',
    );
    const detail = await api()
      .get(`${path()}/${flock}`)
      .query(date)
      .set('Authorization', auth('staff'))
      .expect(200);
    expect(detail.body.data.startingBirdCount).toBe(edited ? 40 : 100);
    expect(detail.body.data.metrics).toMatchObject({
      cumulativeMortality: edited ? 0 : 60,
      liveBirdCount: 40,
    });
    expect(
      await prisma.mortalityEvent.count({ where: { flockId: flock } }),
    ).toBe(edited ? 0 : 1);
  });

  it('rejects inactive membership, user, organization, farm and assignment states', async () => {
    const read = () =>
      api().get(path()).query(date).set('Authorization', auth('staff'));
    await prisma.organizationMembership.update({
      where: { id: memberships.staff },
      data: { isActive: false },
    });
    await read().expect(403);
    await prisma.organizationMembership.update({
      where: { id: memberships.staff },
      data: { isActive: true },
    });
    await prisma.user.update({
      where: { id: users.staff },
      data: { isActive: false },
    });
    await read().expect(401);
    await prisma.user.update({
      where: { id: users.staff },
      data: { isActive: true },
    });
    await prisma.organization.update({
      where: { id: org },
      data: { isActive: false },
    });
    await read().expect(403);
    await prisma.organization.update({
      where: { id: org },
      data: { isActive: true },
    });
    await prisma.farm.update({
      where: { id: farm },
      data: { isActive: false },
    });
    await read().expect(403);
    await prisma.farm.update({ where: { id: farm }, data: { isActive: true } });
    await prisma.farmAccessAssignment.updateMany({
      where: { membershipId: memberships.staff },
      data: { isActive: false },
    });
    await read().expect(403);
  });
});
