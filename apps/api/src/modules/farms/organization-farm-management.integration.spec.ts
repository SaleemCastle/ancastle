import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DatabaseModule } from '../../database/database.module.js';
import { PrismaService } from '../../database/prisma.service.js';
import { HttpExceptionFilter } from '../../common/filters/http-exception.filter.js';
import { TokenService } from '../auth/token.service.js';
import { OrganizationsModule } from '../organizations/organizations.module.js';
import { FarmsModule } from './farms.module.js';

describe('Organization/Farm management API (HTTP + PostgreSQL)', () => {
  const prisma = new PrismaService();
  const orgA = randomUUID();
  const orgB = randomUUID();
  const orgIds = [orgA, orgB];
  const users = {
    admin: randomUUID(),
    staff: randomUUID(),
    manager: randomUUID(),
    outsider: randomUUID(),
  };
  const userIds = Object.values(users);
  const membershipIds = {
    adminA: randomUUID(),
    adminB: randomUUID(),
    staff: randomUUID(),
    manager: randomUUID(),
  };
  const farms = {
    first: randomUUID(),
    second: randomUUID(),
    inactive: randomUUID(),
    foreign: randomUUID(),
  };
  const tokens: Record<string, string> = {};
  let app: INestApplication;

  beforeAll(async () => {
    vi.stubEnv('JWT_SECRET', 'organization-farm-management-test-secret');
    await prisma.$connect();
    await prisma.organization.createMany({
      data: [
        { id: orgA, name: 'Management A', slug: 'management-' + orgA },
        { id: orgB, name: 'Management B', slug: 'management-' + orgB },
      ],
    });
    await prisma.user.createMany({
      data: userIds.map((id) => ({
        id,
        email: id + '@example.com',
        passwordHash: 'unused-test-hash',
      })),
    });
    await prisma.organizationMembership.createMany({
      data: [
        {
          id: membershipIds.adminA,
          organizationId: orgA,
          userId: users.admin,
          role: 'ADMIN',
        },
        {
          id: membershipIds.adminB,
          organizationId: orgB,
          userId: users.admin,
          role: 'STAFF',
        },
        {
          id: membershipIds.staff,
          organizationId: orgA,
          userId: users.staff,
          role: 'STAFF',
        },
        {
          id: membershipIds.manager,
          organizationId: orgA,
          userId: users.manager,
          role: 'MANAGER',
        },
      ],
    });
    await prisma.farm.createMany({
      data: [
        { id: farms.first, organizationId: orgA, name: 'First', code: 'FIRST' },
        {
          id: farms.second,
          organizationId: orgA,
          name: 'Second',
          code: 'SECOND',
        },
        {
          id: farms.inactive,
          organizationId: orgA,
          name: 'Inactive',
          code: 'INACTIVE',
          isActive: false,
        },
        {
          id: farms.foreign,
          organizationId: orgB,
          name: 'Foreign',
          code: 'B_ONLY',
        },
      ],
    });
    const module = await Test.createTestingModule({
      imports: [DatabaseModule, OrganizationsModule, FarmsModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();
    const tokenService = module.get(TokenService);
    for (const id of userIds)
      tokens[id] = await tokenService.createAccessToken(
        id,
        id + '@example.com',
      );
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
  });

  beforeEach(async () => {
    await prisma.organization.updateMany({
      where: { id: { in: orgIds } },
      data: { isActive: true },
    });
    await prisma.organization.update({
      where: { id: orgA },
      data: { name: 'Management A' },
    });
    await prisma.user.updateMany({
      where: { id: { in: userIds } },
      data: { isActive: true },
    });
    await prisma.organizationMembership.updateMany({
      where: { organizationId: { in: orgIds } },
      data: { isActive: true },
    });
    await prisma.farmAccessAssignment.deleteMany({
      where: { organizationId: { in: orgIds } },
    });
    await prisma.farm.deleteMany({
      where: {
        organizationId: { in: orgIds },
        id: { notIn: Object.values(farms) },
      },
    });
    await prisma.farm.update({
      where: { id: farms.first },
      data: { name: 'First', code: 'FIRST', isActive: true },
    });
    await prisma.farm.update({
      where: { id: farms.second },
      data: { name: 'Second', code: 'SECOND', isActive: true },
    });
    await prisma.farm.update({
      where: { id: farms.inactive },
      data: { isActive: false },
    });
    await prisma.farmAccessAssignment.createMany({
      data: [
        {
          organizationId: orgA,
          membershipId: membershipIds.staff,
          farmId: farms.first,
        },
        {
          organizationId: orgA,
          membershipId: membershipIds.staff,
          farmId: farms.inactive,
        },
        {
          organizationId: orgA,
          membershipId: membershipIds.manager,
          farmId: farms.first,
        },
      ],
    });
  });

  afterAll(async () => {
    if (app) await app.close();
    await prisma.farmAccessAssignment.deleteMany({
      where: { organizationId: { in: orgIds } },
    });
    await prisma.organizationMembership.deleteMany({
      where: { organizationId: { in: orgIds } },
    });
    await prisma.farm.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
    await prisma.$disconnect();
    vi.unstubAllEnvs();
  });

  const api = () => request(app.getHttpServer());
  const path = (organization: string = orgA) =>
    '/api/organizations/' + organization;
  const farmPath = (id?: string, organization: string = orgA) =>
    path(organization) + '/farms' + (id ? '/' + id : '');
  const auth = (user = users.admin) => 'Bearer ' + tokens[user];
  const actions = [
    'getOrganization',
    'updateOrganization',
    'listFarms',
    'createFarm',
    'getFarm',
    'updateFarm',
  ] as const;

  function action(name: (typeof actions)[number], organization: string = orgA) {
    switch (name) {
      case 'getOrganization':
        return api().get(path(organization));
      case 'updateOrganization':
        return api().patch(path(organization)).send({ name: 'Changed' });
      case 'listFarms':
        return api().get(farmPath(undefined, organization));
      case 'createFarm':
        return api()
          .post(farmPath(undefined, organization))
          .send({ name: 'Created', code: 'CREATED' });
      case 'getFarm':
        return api().get(farmPath(farms.first, organization));
      case 'updateFarm':
        return api()
          .patch(farmPath(farms.first, organization))
          .send({ name: 'Changed' });
    }
  }

  it('retrieves and updates the selected organization through standard envelopes', async () => {
    const initial = await api()
      .get(path())
      .set('Authorization', auth(users.staff))
      .expect(200);
    expect(initial.body.data).toMatchObject({
      id: orgA,
      name: 'Management A',
      slug: 'management-' + orgA,
      isActive: true,
    });
    const updated = await api()
      .patch(path())
      .set('Authorization', auth())
      .send({ name: '  Updated Organization  ' })
      .expect(200);
    expect(updated.body.data.name).toBe('Updated Organization');
    expect(updated.body.data.id).toBe(orgA);
    expect(Object.keys(updated.body.data).sort()).toEqual([
      'createdAt',
      'id',
      'isActive',
      'name',
      'slug',
      'updatedAt',
    ]);
    expect(new Date(updated.body.data.createdAt).toISOString()).toBe(
      updated.body.data.createdAt,
    );
    expect(
      await prisma.organization.findUnique({ where: { id: orgB } }),
    ).toMatchObject({ name: 'Management B' });
  });

  it('creates farms under trusted ownership and returns a typed resource envelope', async () => {
    const response = await api()
      .post(farmPath())
      .set('Authorization', auth())
      .send({ name: '  New Farm  ', code: ' new_01 ' })
      .expect(201);
    expect(response.body.data).toMatchObject({
      organizationId: orgA,
      name: 'New Farm',
      code: 'NEW_01',
      isActive: true,
    });
    expect(Object.keys(response.body.data).sort()).toEqual([
      'code',
      'createdAt',
      'id',
      'isActive',
      'name',
      'organizationId',
      'updatedAt',
    ]);
    expect(new Date(response.body.data.updatedAt).toISOString()).toBe(
      response.body.data.updatedAt,
    );
    expect(
      await prisma.farm.findUnique({ where: { id: response.body.data.id } }),
    ).toMatchObject({ organizationId: orgA });
  });

  it('returns stable pagination metadata and only tenant-owned farms', async () => {
    const page = await api()
      .get(farmPath())
      .set('Authorization', auth())
      .query({ page: 2, pageSize: 1 })
      .expect(200);
    expect(page.body.data.map((entry: { id: string }) => entry.id)).toEqual([
      farms.inactive,
    ]);
    expect(page.body.meta).toEqual({
      page: 2,
      pageSize: 1,
      totalItems: 3,
      totalPages: 3,
    });
    const empty = await api()
      .get(farmPath())
      .set('Authorization', auth())
      .query({ page: 4, pageSize: 1 })
      .expect(200);
    expect(empty.body.data).toEqual([]);
    expect(empty.body.meta).toEqual({
      page: 4,
      pageSize: 1,
      totalItems: 3,
      totalPages: 3,
    });
  });

  it.each(['staff', 'manager'] as const)(
    'limits %s lists/details to assigned active farms',
    async (kind) => {
      const response = await api()
        .get(farmPath())
        .set('Authorization', auth(users[kind]))
        .expect(200);
      expect(
        response.body.data.map((entry: { id: string }) => entry.id),
      ).toEqual([farms.first]);
      expect(response.body.meta).toEqual({
        page: 1,
        pageSize: 20,
        totalItems: 1,
        totalPages: 1,
      });
      await api()
        .get(farmPath(farms.first))
        .set('Authorization', auth(users[kind]))
        .expect(200);
      await api()
        .get(farmPath(farms.second))
        .set('Authorization', auth(users[kind]))
        .expect(404);
      await api()
        .get(farmPath(farms.inactive))
        .set('Authorization', auth(users[kind]))
        .expect(404);
      const inactive = await api()
        .get(farmPath())
        .set('Authorization', auth(users[kind]))
        .query({ isActive: 'false' })
        .expect(200);
      expect(inactive.body.data).toEqual([]);
      expect(inactive.body.meta.totalItems).toBe(0);
    },
  );

  it('lets authorized administrators filter, inspect, deactivate and reactivate farms', async () => {
    const inactive = await api()
      .get(farmPath())
      .set('Authorization', auth())
      .query({ isActive: 'false' })
      .expect(200);
    expect(inactive.body.data.map((entry: { id: string }) => entry.id)).toEqual(
      [farms.inactive],
    );
    const deactivated = await api()
      .patch(farmPath(farms.first))
      .set('Authorization', auth())
      .send({ isActive: false })
      .expect(200);
    expect(deactivated.body.data).toMatchObject({
      id: farms.first,
      isActive: false,
    });
    await api()
      .get(farmPath(farms.first))
      .set('Authorization', auth())
      .expect(200);
    await api()
      .get(farmPath(farms.first))
      .set('Authorization', auth(users.staff))
      .expect(404);
    const reactivated = await api()
      .patch(farmPath(farms.first))
      .set('Authorization', auth())
      .send({ isActive: true, name: 'Reactivated', code: 'updated' })
      .expect(200);
    expect(reactivated.body.data).toMatchObject({
      id: farms.first,
      name: 'Reactivated',
      code: 'UPDATED',
      isActive: true,
    });
    await api()
      .get(farmPath(farms.first))
      .set('Authorization', auth(users.staff))
      .expect(200);
    expect(
      await prisma.farmAccessAssignment.count({
        where: { farmId: farms.first },
      }),
    ).toBe(2);
  });

  it('returns empty collections when assignments are revoked, without disabling organization access', async () => {
    await prisma.farmAccessAssignment.updateMany({
      where: { membershipId: membershipIds.staff },
      data: { isActive: false },
    });
    const list = await api()
      .get(farmPath())
      .set('Authorization', auth(users.staff))
      .expect(200);
    expect(list.body).toEqual({
      data: [],
      meta: { page: 1, pageSize: 20, totalItems: 0, totalPages: 0 },
    });
    await api().get(path()).set('Authorization', auth(users.staff)).expect(200);
  });

  it.each(actions)('rejects unauthenticated %s requests', async (name) => {
    await action(name).expect(401);
  });

  it.each(actions)(
    'rejects %s without organization membership',
    async (name) => {
      await action(name).set('Authorization', auth(users.outsider)).expect(403);
    },
  );

  it.each(['staff', 'manager'] as const)(
    'forbids %s from organization/farm writes',
    async (kind) => {
      for (const name of [
        'updateOrganization',
        'createFarm',
        'updateFarm',
      ] as const) {
        await action(name).set('Authorization', auth(users[kind])).expect(403);
      }
      expect(
        await prisma.farm.findUnique({ where: { id: farms.first } }),
      ).toMatchObject({ name: 'First' });
    },
  );

  it('evaluates permissions using the selected organization membership', async () => {
    const organizationB = await api()
      .get(path(orgB))
      .set('Authorization', auth())
      .expect(200);
    expect(organizationB.body.data.id).toBe(orgB);
    for (const name of [
      'updateOrganization',
      'createFarm',
      'updateFarm',
    ] as const) {
      await action(name, orgB).set('Authorization', auth()).expect(403);
    }
    const bList = await api()
      .get(farmPath(undefined, orgB))
      .set('Authorization', auth())
      .expect(200);
    expect(bList.body.data).toEqual([]);
  });

  it.each(['get', 'patch'] as const)(
    'does not disclose foreign farm existence on %s',
    async (method) => {
      const foreign = await api()
        [method](farmPath(farms.foreign))
        .set('Authorization', auth())
        .send({ name: 'Compromised' })
        .expect(404);
      const absent = await api()
        [method](farmPath(randomUUID()))
        .set('Authorization', auth())
        .send({ name: 'Compromised' })
        .expect(404);
      expect(foreign.body).toEqual(absent.body);
      expect(foreign.body).toEqual({
        error: { code: 'FARM_NOT_FOUND', message: 'Farm was not found' },
      });
      expect(
        await prisma.farm.findUnique({ where: { id: farms.foreign } }),
      ).toMatchObject({ name: 'Foreign', organizationId: orgB });
    },
  );

  it('rejects request payload IDs/roles instead of using them for ownership or authorization', async () => {
    for (const claim of [
      'organizationId',
      'farmId',
      'userId',
      'role',
      'permissions',
      'membershipId',
    ]) {
      const injected = { [claim]: claim === 'role' ? 'OWNER' : orgB };
      await api()
        .post(farmPath())
        .set('Authorization', auth())
        .send({ name: 'Injected', code: 'INJECTED', ...injected })
        .expect(400);
      await api()
        .patch(farmPath(farms.first))
        .set('Authorization', auth())
        .send({ name: 'Injected', ...injected })
        .expect(400);
      await api()
        .patch(path())
        .set('Authorization', auth())
        .send({ name: 'Injected', ...injected })
        .expect(400);
    }
    expect(await prisma.farm.count({ where: { organizationId: orgA } })).toBe(
      3,
    );
  });

  it('does not replace route context with headers or query IDs', async () => {
    const selected = await api()
      .get(path())
      .set('Authorization', auth())
      .set('x-organization-id', orgB)
      .expect(200);
    expect(selected.body.data.id).toBe(orgA);
    await api()
      .get(farmPath())
      .set('Authorization', auth())
      .query({ organizationId: orgB })
      .expect(400);
  });

  it('normalizes farm codes and returns sanitized duplicate errors on create/update', async () => {
    const duplicate = await api()
      .post(farmPath())
      .set('Authorization', auth())
      .send({ name: 'Duplicate', code: ' first ' })
      .expect(409);
    const updated = await api()
      .patch(farmPath(farms.first))
      .set('Authorization', auth())
      .send({ code: 'second' })
      .expect(409);
    expect(duplicate.body).toEqual(updated.body);
    expect(duplicate.body).toEqual({
      error: {
        code: 'FARM_CODE_EXISTS',
        message: 'A farm with this code already exists in this organization',
      },
    });
    await api()
      .post(farmPath())
      .set('Authorization', auth())
      .send({ name: 'Shared Code', code: 'b_only' })
      .expect(201);
    expect(
      await prisma.farm.findUnique({ where: { id: farms.first } }),
    ).toMatchObject({ code: 'FIRST' });
  });

  it('handles concurrent duplicate creation using the database constraint', async () => {
    const attempts = await Promise.all(
      [1, 2].map(() =>
        api()
          .post(farmPath())
          .set('Authorization', auth())
          .send({ name: 'Race', code: 'RACE' }),
      ),
    );
    expect(
      attempts.map((entry) => entry.status).sort((left, right) => left - right),
    ).toEqual([201, 409]);
    expect(
      await prisma.farm.count({
        where: { organizationId: orgA, code: 'RACE' },
      }),
    ).toBe(1);
  });

  it.each([
    ['post', { name: '', code: 'VALID' }],
    ['post', { name: 'Valid', code: 'not valid' }],
    ['post', { name: 'Valid', code: 'A'.repeat(33) }],
    ['post', { name: 'A'.repeat(121), code: 'VALID' }],
    ['post', { name: 'Valid' }],
    ['patch', {}],
    ['patch', { name: '  ' }],
    ['patch', { isActive: 'false' }],
  ] as const)(
    'returns field validation errors for invalid %s body %j',
    async (method, payload) => {
      const response = await api()
        [method](method === 'post' ? farmPath() : farmPath(farms.first))
        .set('Authorization', auth())
        .send(payload)
        .expect(400);
      expect(response.body.error).toMatchObject({
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
      });
      expect(response.body.error.fields).toBeDefined();
    },
  );

  it.each([
    { page: 0 },
    { page: 'bad' },
    { page: 1.5 },
    { page: 1_000_001 },
    { pageSize: 0 },
    { pageSize: 101 },
    { isActive: 'invalid' },
  ])('rejects invalid query %j', async (query) => {
    const response = await api()
      .get(farmPath())
      .set('Authorization', auth())
      .query(query)
      .expect(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('validates resource IDs and organization profile changes', async () => {
    for (const method of ['get', 'patch'] as const) {
      const response = await api()
        [method](farmPath('invalid'))
        .set('Authorization', auth())
        .send({ name: 'Valid' })
        .expect(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    }
    await api().get(path('invalid')).set('Authorization', auth()).expect(403);
    await api()
      .patch(path())
      .set('Authorization', auth())
      .send({ name: '' })
      .expect(400);
    await api()
      .patch(path())
      .set('Authorization', auth())
      .send({ name: 'Valid', slug: 'other' })
      .expect(400);
    await api()
      .patch(path())
      .set('Authorization', auth())
      .send({ isActive: false })
      .expect(400);
  });

  it.each(['user', 'membership', 'organization'] as const)(
    'rejects inactive %s using existing tokens',
    async (kind) => {
      if (kind === 'user')
        await prisma.user.update({
          where: { id: users.admin },
          data: { isActive: false },
        });
      if (kind === 'membership')
        await prisma.organizationMembership.update({
          where: { id: membershipIds.adminA },
          data: { isActive: false },
        });
      if (kind === 'organization')
        await prisma.organization.update({
          where: { id: orgA },
          data: { isActive: false },
        });
      await api()
        .get(farmPath())
        .set('Authorization', auth())
        .expect(kind === 'user' ? 401 : 403);
      await api()
        .patch(farmPath(farms.first))
        .set('Authorization', auth())
        .send({ name: 'Denied' })
        .expect(kind === 'user' ? 401 : 403);
    },
  );
});
