import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DatabaseModule } from '../../database/database.module.js';
import { PrismaService } from '../../database/prisma.service.js';
import { HttpExceptionFilter } from '../../common/filters/http-exception.filter.js';
import { PasswordService } from '../auth/password.service.js';
import { TokenService } from '../auth/token.service.js';
import { FarmsModule } from '../farms/farms.module.js';
import { OrganizationContext } from '../authorization/organization-context.js';
import { UsersModule } from './users.module.js';
import { UsersService } from './users.service.js';

describe('Organization user administration (HTTP + PostgreSQL)', () => {
  const prisma = new PrismaService();
  const testId = randomUUID();
  const emailPrefix = 'm108-' + testId + '-';
  const orgA = randomUUID();
  const orgB = randomUUID();
  const orgIds = [orgA, orgB];
  const users = {
    owner: randomUUID(),
    backup: randomUUID(),
    shared: randomUUID(),
    manager: randomUUID(),
    foreign: randomUUID(),
    inactive: randomUUID(),
  };
  const userIds = Object.values(users);
  const memberships = {
    owner: randomUUID(),
    backup: randomUUID(),
    sharedA: randomUUID(),
    sharedB: randomUUID(),
    manager: randomUUID(),
    foreign: randomUUID(),
    inactive: randomUUID(),
    ownerB: randomUUID(),
  };
  const farms = {
    first: randomUUID(),
    second: randomUUID(),
    foreign: randomUUID(),
    inactive: randomUUID(),
  };
  const accessTokens: Record<string, string> = {};
  const bootstrapPassword = 'M108-bootstrap-password!';
  let app: INestApplication;
  let service: UsersService;
  let passwords: PasswordService;
  let baselineHash: string;

  beforeAll(async () => {
    vi.stubEnv('JWT_SECRET', 'user-administration-access-test-secret');
    vi.stubEnv('JWT_REFRESH_SECRET', 'user-administration-refresh-test-secret');
    await prisma.$connect();
    passwords = new PasswordService();
    baselineHash = await passwords.hash(bootstrapPassword);
    await prisma.organization.createMany({
      data: [
        { id: orgA, name: 'User Admin A', slug: 'user-admin-' + orgA },
        { id: orgB, name: 'User Admin B', slug: 'user-admin-' + orgB },
      ],
    });
    await prisma.user.createMany({
      data: userIds.map((id) => ({
        id,
        email: id + '@example.com',
        passwordHash: baselineHash,
        isActive: id !== users.inactive,
      })),
    });
    await prisma.organizationMembership.createMany({
      data: [
        {
          id: memberships.owner,
          organizationId: orgA,
          userId: users.owner,
          role: 'OWNER',
        },
        {
          id: memberships.backup,
          organizationId: orgA,
          userId: users.backup,
          role: 'ADMIN',
        },
        {
          id: memberships.sharedA,
          organizationId: orgA,
          userId: users.shared,
          role: 'STAFF',
          displayName: 'A Name',
        },
        {
          id: memberships.sharedB,
          organizationId: orgB,
          userId: users.shared,
          role: 'ADMIN',
          displayName: 'B Name',
        },
        {
          id: memberships.ownerB,
          organizationId: orgB,
          userId: users.owner,
          role: 'STAFF',
        },
        {
          id: memberships.manager,
          organizationId: orgA,
          userId: users.manager,
          role: 'MANAGER',
        },
        {
          id: memberships.foreign,
          organizationId: orgB,
          userId: users.foreign,
          role: 'STAFF',
        },
        {
          id: memberships.inactive,
          organizationId: orgA,
          userId: users.inactive,
          role: 'ADMIN',
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
          code: 'FOREIGN',
        },
      ],
    });
    const module = await Test.createTestingModule({
      imports: [DatabaseModule, UsersModule, FarmsModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();
    const tokens = module.get(TokenService);
    for (const id of userIds)
      accessTokens[id] = await tokens.createAccessToken(
        id,
        id + '@example.com',
      );
    service = module.get(UsersService);
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
  });

  async function cleanupExtras() {
    const extras = await prisma.user.findMany({
      where: { email: { startsWith: emailPrefix } },
      select: { id: true },
    });
    const extraIds = extras.map((entry) => entry.id);
    await prisma.authSession.deleteMany({
      where: { userId: { in: [...userIds, ...extraIds] } },
    });
    await prisma.farmAccessAssignment.deleteMany({
      where: { organizationId: { in: orgIds } },
    });
    await prisma.organizationMembership.deleteMany({
      where: { userId: { in: extraIds }, organizationId: { in: orgIds } },
    });
    await prisma.user.deleteMany({ where: { id: { in: extraIds } } });
  }

  beforeEach(async () => {
    await cleanupExtras();
    await prisma.organization.updateMany({
      where: { id: { in: orgIds } },
      data: { isActive: true },
    });
    await prisma.user.updateMany({
      where: { id: { in: userIds } },
      data: { isActive: true },
    });
    await prisma.user.update({
      where: { id: users.inactive },
      data: { isActive: false },
    });
    await prisma.organizationMembership.updateMany({
      where: { organizationId: { in: orgIds } },
      data: { isActive: true },
    });
    await prisma.organizationMembership.update({
      where: { id: memberships.owner },
      data: { role: 'OWNER' },
    });
    await prisma.organizationMembership.update({
      where: { id: memberships.backup },
      data: { role: 'ADMIN' },
    });
    await prisma.organizationMembership.update({
      where: { id: memberships.sharedA },
      data: { role: 'STAFF', displayName: 'A Name' },
    });
    await prisma.organizationMembership.update({
      where: { id: memberships.sharedB },
      data: { role: 'ADMIN', displayName: 'B Name' },
    });
    await prisma.farmAccessAssignment.createMany({
      data: [
        {
          organizationId: orgA,
          membershipId: memberships.sharedA,
          farmId: farms.first,
        },
        {
          organizationId: orgB,
          membershipId: memberships.sharedB,
          farmId: farms.foreign,
        },
      ],
    });
  });

  afterAll(async () => {
    if (app) await app.close();
    await cleanupExtras();
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
  const auth = (user: string = users.owner) => 'Bearer ' + accessTokens[user];
  const path = (userId?: string, action = '', organization: string = orgA) =>
    '/api/organizations/' +
    organization +
    '/users' +
    (userId ? '/' + userId : '') +
    (action ? '/' + action : '');
  const bootstrap = (extra: Record<string, unknown> = {}) => ({
    email: emailPrefix + 'new@example.com',
    password: bootstrapPassword,
    displayName: 'New Member',
    ...extra,
  });

  const operations = [
    'list',
    'get',
    'bootstrap',
    'profile',
    'membership',
    'farmAccess',
  ] as const;
  function operation(
    kind: (typeof operations)[number],
    target: string = users.shared,
    organization: string = orgA,
  ) {
    switch (kind) {
      case 'list':
        return api().get(path(undefined, '', organization));
      case 'get':
        return api().get(path(target, '', organization));
      case 'bootstrap':
        return api()
          .post(path(undefined, '', organization))
          .send(bootstrap());
      case 'profile':
        return api()
          .patch(path(target, 'profile', organization))
          .send({ displayName: 'Updated' });
      case 'membership':
        return api()
          .patch(path(target, 'membership', organization))
          .send({ role: 'MANAGER' });
      case 'farmAccess':
        return api()
          .put(path(target, 'farm-access', organization))
          .send({ farmIds: [farms.first] });
    }
  }

  it('lists only organization members with scoped counts and explicit safe fields', async () => {
    const response = await api()
      .get(path())
      .set('Authorization', auth())
      .query({ pageSize: 2 })
      .expect(200);
    expect(response.body.meta).toEqual({
      page: 1,
      pageSize: 2,
      totalItems: 5,
      totalPages: 3,
    });
    expect(
      response.body.data.every(
        (entry: { organizationId: string }) => entry.organizationId === orgA,
      ),
    ).toBe(true);
    const details = await api()
      .get(path(users.shared))
      .set('Authorization', auth())
      .expect(200);
    expect(Object.keys(details.body.data).sort()).toEqual([
      'createdAt',
      'displayName',
      'email',
      'farmAccess',
      'isActive',
      'membershipId',
      'organizationId',
      'role',
      'updatedAt',
      'userId',
      'userIsActive',
    ]);
    expect(details.body.data).toMatchObject({
      membershipId: memberships.sharedA,
      displayName: 'A Name',
      role: 'STAFF',
      farmAccess: { allFarms: false, farmIds: [farms.first] },
    });
    expect(JSON.stringify(response.body)).not.toMatch(
      /passwordHash|refreshToken|accessToken|authSessions/,
    );
    const manager = await api()
      .get(path())
      .set('Authorization', auth(users.manager))
      .expect(200);
    expect(manager.body.meta.totalItems).toBe(5);
  });

  it('bootstraps a new identity using existing password/auth primitives and default membership role', async () => {
    const email = emailPrefix + 'new@example.com';
    const response = await api()
      .post(path())
      .set('Authorization', auth())
      .send(
        bootstrap({
          email: '  ' + email.toUpperCase() + '  ',
          farmIds: [farms.first],
        }),
      )
      .expect(201);
    expect(response.body.data).toMatchObject({
      organizationId: orgA,
      email,
      role: 'STAFF',
      isActive: true,
      displayName: 'New Member',
    });
    expect(JSON.stringify(response.body)).not.toMatch(
      /password|Hash|Token|authSession/,
    );
    const identity = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(identity.passwordHash).not.toBe(bootstrapPassword);
    expect(
      await passwords.verify(identity.passwordHash, bootstrapPassword),
    ).toBe(true);
    const login = await api()
      .post('/api/auth/login')
      .send({ email, password: bootstrapPassword })
      .expect(201);
    await api()
      .get('/api/organizations/' + orgA + '/farms/' + farms.first)
      .set('Authorization', 'Bearer ' + login.body.accessToken)
      .expect(200);
    await api()
      .get('/api/organizations/' + orgA + '/farms/' + farms.second)
      .set('Authorization', 'Bearer ' + login.body.accessToken)
      .expect(404);
  });

  it('supports organization-wide administrator bootstrap without per-farm assignments', async () => {
    const response = await api()
      .post(path())
      .set('Authorization', auth())
      .send(bootstrap({ role: 'ADMIN' }))
      .expect(201);
    expect(response.body.data.farmAccess).toEqual({
      allFarms: true,
      farmIds: [],
    });
    expect(
      await prisma.farmAccessAssignment.count({
        where: { membershipId: response.body.data.membershipId },
      }),
    ).toBe(0);
  });

  it('does not attach, reset credentials or modify a global identity through duplicate bootstrap', async () => {
    const response = await api()
      .post(path())
      .set('Authorization', auth())
      .send(bootstrap({ email: users.foreign + '@example.com' }))
      .expect(409);
    expect(response.body).toEqual({
      error: {
        code: 'USER_CREATION_CONFLICT',
        message: 'User creation could not be completed',
      },
    });
    expect(
      await prisma.user.findUnique({ where: { id: users.foreign } }),
    ).toMatchObject({ passwordHash: baselineHash, isActive: true });
    expect(
      await prisma.organizationMembership.count({
        where: { userId: users.foreign, organizationId: orgA },
      }),
    ).toBe(0);
  });

  it('rolls bootstrap back when a selected farm is foreign or missing', async () => {
    for (const farmId of [farms.foreign, randomUUID()]) {
      const response = await api()
        .post(path())
        .set('Authorization', auth())
        .send(bootstrap({ farmIds: [farmId] }))
        .expect(400);
      expect(response.body.error.code).toBe('INVALID_FARM_ACCESS');
      expect(
        await prisma.user.count({
          where: { email: emailPrefix + 'new@example.com' },
        }),
      ).toBe(0);
    }
  });

  it('updates and clears only the organization-specific profile of a shared identity', async () => {
    const updated = await api()
      .patch(path(users.shared, 'profile'))
      .set('Authorization', auth())
      .send({ displayName: '  A Updated  ' })
      .expect(200);
    expect(updated.body.data.displayName).toBe('A Updated');
    expect(
      await prisma.organizationMembership.findUnique({
        where: { id: memberships.sharedB },
      }),
    ).toMatchObject({ displayName: 'B Name' });
    expect(
      await prisma.user.findUnique({ where: { id: users.shared } }),
    ).toMatchObject({
      email: users.shared + '@example.com',
      passwordHash: baselineHash,
      isActive: true,
    });
    const cleared = await api()
      .patch(path(users.shared, 'profile'))
      .set('Authorization', auth())
      .send({ displayName: null })
      .expect(200);
    expect(cleared.body.data.displayName).toBeNull();
  });

  it('deactivates/reactivates membership without disabling global identity or another organization', async () => {
    await api()
      .patch(path(users.shared, 'membership'))
      .set('Authorization', auth())
      .send({ isActive: false })
      .expect(200);
    await api()
      .get('/api/organizations/' + orgA + '/farms')
      .set('Authorization', auth(users.shared))
      .expect(403);
    await api()
      .get('/api/organizations/' + orgB + '/farms')
      .set('Authorization', auth(users.shared))
      .expect(200);
    expect(
      await prisma.user.findUnique({ where: { id: users.shared } }),
    ).toMatchObject({ isActive: true });
    expect(
      await prisma.organizationMembership.findUnique({
        where: { id: memberships.sharedB },
      }),
    ).toMatchObject({ isActive: true });
    const inactive = await api()
      .get(path())
      .set('Authorization', auth())
      .query({ isActive: 'false' })
      .expect(200);
    expect(
      inactive.body.data.map((entry: { userId: string }) => entry.userId),
    ).toEqual([users.shared]);
    await api()
      .patch(path(users.shared, 'membership'))
      .set('Authorization', auth())
      .send({ isActive: true })
      .expect(200);
    await api()
      .get('/api/organizations/' + orgA + '/farms')
      .set('Authorization', auth(users.shared))
      .expect(200);
  });

  it('keeps globally inactive identities read-only when memberships are reactivated', async () => {
    await api()
      .patch(path(users.inactive, 'membership'))
      .set('Authorization', auth())
      .send({ isActive: false })
      .expect(200);
    const response = await api()
      .patch(path(users.inactive, 'membership'))
      .set('Authorization', auth())
      .send({ isActive: true })
      .expect(200);
    expect(response.body.data).toMatchObject({
      isActive: true,
      userIsActive: false,
    });
    await api()
      .get(path())
      .set('Authorization', auth(users.inactive))
      .expect(401);
  });

  it('applies organization role changes to existing tokens', async () => {
    await api()
      .patch(path(users.shared, 'membership'))
      .set('Authorization', auth())
      .send({ role: 'ADMIN' })
      .expect(200);
    await api()
      .get(path())
      .set('Authorization', auth(users.shared))
      .expect(200);
    await api()
      .patch(path(users.shared, 'membership'))
      .set('Authorization', auth())
      .send({ role: 'STAFF' })
      .expect(200);
    await api()
      .get(path())
      .set('Authorization', auth(users.shared))
      .expect(403);
    expect(
      await prisma.organizationMembership.findUnique({
        where: { id: memberships.sharedB },
      }),
    ).toMatchObject({ role: 'ADMIN' });
  });

  it('replaces, revokes and reactivates farm assignments without losing stable assignment identity', async () => {
    const initial = await prisma.farmAccessAssignment.findFirstOrThrow({
      where: { membershipId: memberships.sharedA, farmId: farms.first },
    });
    const multiple = await api()
      .put(path(users.shared, 'farm-access'))
      .set('Authorization', auth())
      .send({ farmIds: [farms.first, farms.second] })
      .expect(200);
    expect(multiple.body.data.farmAccess.farmIds.sort()).toEqual(
      [farms.first, farms.second].sort(),
    );
    await api()
      .put(path(users.shared, 'farm-access'))
      .set('Authorization', auth())
      .send({ farmIds: [] })
      .expect(200);
    expect(
      await prisma.farmAccessAssignment.findUnique({
        where: { id: initial.id },
      }),
    ).toMatchObject({ isActive: false });
    await api()
      .get('/api/organizations/' + orgA + '/farms/' + farms.first)
      .set('Authorization', auth(users.shared))
      .expect(404);
    await api()
      .put(path(users.shared, 'farm-access'))
      .set('Authorization', auth())
      .send({ farmIds: [farms.first] })
      .expect(200);
    expect(
      await prisma.farmAccessAssignment.findUnique({
        where: { id: initial.id },
      }),
    ).toMatchObject({ isActive: true });
    expect(
      await prisma.farmAccessAssignment.findFirst({
        where: { membershipId: memberships.sharedB, farmId: farms.foreign },
      }),
    ).toMatchObject({ isActive: true });
  });

  it('does not activate an inactive farm when granting membership access', async () => {
    await api()
      .put(path(users.shared, 'farm-access'))
      .set('Authorization', auth())
      .send({ farmIds: [farms.inactive] })
      .expect(200);
    await api()
      .get('/api/organizations/' + orgA + '/farms/' + farms.inactive)
      .set('Authorization', auth(users.shared))
      .expect(404);
    expect(
      await prisma.farm.findUnique({ where: { id: farms.inactive } }),
    ).toMatchObject({ isActive: false });
  });

  it('rejects foreign and nonexistent farm IDs atomically without changing existing grants', async () => {
    for (const invalidId of [farms.foreign, randomUUID()]) {
      const response = await api()
        .put(path(users.shared, 'farm-access'))
        .set('Authorization', auth())
        .send({ farmIds: [farms.second, invalidId] })
        .expect(400);
      expect(response.body.error.code).toBe('INVALID_FARM_ACCESS');
      expect(
        await prisma.farmAccessAssignment.findMany({
          where: { membershipId: memberships.sharedA, isActive: true },
          select: { farmId: true },
        }),
      ).toEqual([{ farmId: farms.first }]);
    }
  });

  it.each(['profile', 'membership', 'farmAccess', 'get'] as const)(
    'returns indistinguishable foreign/nonexistent user errors for %s',
    async (kind) => {
      const foreign = await operation(kind, users.foreign)
        .set('Authorization', auth())
        .expect(404);
      const missing = await operation(kind, randomUUID())
        .set('Authorization', auth())
        .expect(404);
      expect(foreign.body).toEqual(missing.body);
      expect(foreign.body).toEqual({
        error: {
          code: 'ORGANIZATION_USER_NOT_FOUND',
          message: 'Organization user was not found',
        },
      });
      expect(
        await prisma.user.findUnique({ where: { id: users.foreign } }),
      ).toMatchObject({
        email: users.foreign + '@example.com',
        isActive: true,
      });
    },
  );

  it.each(operations)('rejects unauthenticated %s operations', async (kind) => {
    await operation(kind).expect(401);
  });

  it.each(operations)(
    'rejects staff %s operations despite a valid active membership',
    async (kind) => {
      await operation(kind)
        .set('Authorization', auth(users.shared))
        .expect(403);
    },
  );

  it.each(['bootstrap', 'profile', 'membership', 'farmAccess'] as const)(
    'rejects manager %s writes',
    async (kind) => {
      await operation(kind)
        .set('Authorization', auth(users.manager))
        .expect(403);
    },
  );

  it('does not carry owner permissions from A into a staff membership in B', async () => {
    await operation('membership', users.shared, orgB)
      .set('Authorization', auth())
      .expect(403);
    await operation('list', users.shared, orgB)
      .set('Authorization', auth())
      .expect(403);
  });

  it.each(['user', 'membership', 'organization'] as const)(
    'rejects inactive actor %s on reads/writes',
    async (kind) => {
      if (kind === 'user')
        await prisma.user.update({
          where: { id: users.owner },
          data: { isActive: false },
        });
      if (kind === 'membership')
        await prisma.organizationMembership.update({
          where: { id: memberships.owner },
          data: { isActive: false },
        });
      if (kind === 'organization')
        await prisma.organization.update({
          where: { id: orgA },
          data: { isActive: false },
        });
      await operation('list')
        .set('Authorization', auth())
        .expect(kind === 'user' ? 401 : 403);
      await operation('profile')
        .set('Authorization', auth())
        .expect(kind === 'user' ? 401 : 403);
    },
  );

  it('revalidates actor identity/role when a service receives stale privileged context', async () => {
    const context = new OrganizationContext(
      orgA,
      memberships.owner,
      users.owner,
      'OWNER',
    );
    await prisma.organizationMembership.update({
      where: { id: memberships.owner },
      data: { role: 'STAFF' },
    });
    await expect(
      service.updateProfile(context, users.shared, { displayName: 'Denied' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(
      await prisma.organizationMembership.findUnique({
        where: { id: memberships.sharedA },
      }),
    ).toMatchObject({ displayName: 'A Name' });
  });

  it.each([{ role: 'STAFF' }, { isActive: false }])(
    'protects the last active organization administrator from %j',
    async (change) => {
      await prisma.organizationMembership.update({
        where: { id: memberships.backup },
        data: { isActive: false },
      });
      const response = await api()
        .patch(path(users.owner, 'membership'))
        .set('Authorization', auth())
        .send(change)
        .expect(409);
      expect(response.body.error.code).toBe('LAST_ADMINISTRATOR');
      expect(
        await prisma.organizationMembership.findUnique({
          where: { id: memberships.owner },
        }),
      ).toMatchObject({ role: 'OWNER', isActive: true });
    },
  );

  it('allows administrative transfer when another active administrator remains', async () => {
    await api()
      .patch(path(users.owner, 'membership'))
      .set('Authorization', auth())
      .send({ role: 'STAFF' })
      .expect(200);
    await api().get(path()).set('Authorization', auth()).expect(403);
    await api()
      .get(path())
      .set('Authorization', auth(users.backup))
      .expect(200);
  });

  it('preserves at least one administrator under concurrent self-demotions', async () => {
    const responses = await Promise.all([
      api()
        .patch(path(users.owner, 'membership'))
        .set('Authorization', auth())
        .send({ role: 'STAFF' }),
      api()
        .patch(path(users.backup, 'membership'))
        .set('Authorization', auth(users.backup))
        .send({ role: 'STAFF' }),
    ]);
    expect(
      responses
        .map((entry) => entry.status)
        .sort((left, right) => left - right),
    ).toEqual([200, 409]);
    expect(
      responses.find((entry) => entry.status === 409)?.body.error.code,
    ).toBe('LAST_ADMINISTRATOR');
    expect(
      await prisma.organizationMembership.count({
        where: {
          organizationId: orgA,
          isActive: true,
          user: { isActive: true },
          role: { in: ['OWNER', 'ADMIN'] },
        },
      }),
    ).toBe(1);
  });

  it('keeps concurrent farm replacements complete rather than mixing requests', async () => {
    const responses = await Promise.all([
      api()
        .put(path(users.shared, 'farm-access'))
        .set('Authorization', auth())
        .send({ farmIds: [farms.first] }),
      api()
        .put(path(users.shared, 'farm-access'))
        .set('Authorization', auth())
        .send({ farmIds: [farms.second] }),
    ]);
    expect(responses.map((entry) => entry.status)).toEqual([200, 200]);
    const selected = await prisma.farmAccessAssignment.findMany({
      where: { membershipId: memberships.sharedA, isActive: true },
      select: { farmId: true },
    });
    expect(selected).toHaveLength(1);
    expect([farms.first, farms.second]).toContain(selected[0].farmId);
  });

  it('rejects global identity and tenant/authority fields in request payloads', async () => {
    for (const field of [
      'email',
      'password',
      'userIsActive',
      'userId',
      'organizationId',
      'membershipId',
      'permissions',
      'role',
    ]) {
      await api()
        .patch(path(users.shared, 'profile'))
        .set('Authorization', auth())
        .send({ displayName: 'Denied', [field]: 'injected' })
        .expect(400);
    }
    for (const field of [
      'organizationId',
      'userId',
      'membershipId',
      'permissions',
      'userIsActive',
    ]) {
      await api()
        .patch(path(users.shared, 'membership'))
        .set('Authorization', auth())
        .send({ role: 'STAFF', [field]: 'injected' })
        .expect(400);
      await api()
        .post(path())
        .set('Authorization', auth())
        .send(bootstrap({ [field]: 'injected' }))
        .expect(400);
      await api()
        .put(path(users.shared, 'farm-access'))
        .set('Authorization', auth())
        .send({ farmIds: [], [field]: 'injected' })
        .expect(400);
    }
    expect(
      await prisma.user.findUnique({ where: { id: users.shared } }),
    ).toMatchObject({ passwordHash: baselineHash, isActive: true });
  });

  it.each([
    ['bootstrap', { email: 'bad', password: 'short' }],
    ['bootstrap', { email: 'valid@example.com', password: 'x'.repeat(129) }],
    [
      'bootstrap',
      {
        email: 'valid@example.com',
        password: bootstrapPassword,
        role: 'SUPERUSER',
      },
    ],
    ['profile', { displayName: '' }],
    ['profile', { displayName: 'x'.repeat(121) }],
    ['membership', {}],
    ['membership', { isActive: 'false' }],
    ['membership', { role: 'SUPERUSER' }],
    ['farmAccess', { farmIds: ['invalid'] }],
  ] as const)('rejects invalid %s data', async (kind, input) => {
    const call =
      kind === 'bootstrap'
        ? api().post(path())
        : kind === 'farmAccess'
          ? api().put(path(users.shared, 'farm-access'))
          : api().patch(path(users.shared, kind));
    const response = await call
      .set('Authorization', auth())
      .send(input)
      .expect(400);
    expect(response.body.error).toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'Validation failed',
    });
    expect(response.body.error.fields).toBeDefined();
  });

  it('validates target IDs, duplicate/oversized farm IDs and list query fields', async () => {
    await api().get(path('invalid')).set('Authorization', auth()).expect(400);
    await api()
      .put(path(users.shared, 'farm-access'))
      .set('Authorization', auth())
      .send({ farmIds: [farms.first, farms.first] })
      .expect(400);
    await api()
      .put(path(users.shared, 'farm-access'))
      .set('Authorization', auth())
      .send({ farmIds: Array.from({ length: 1001 }, () => randomUUID()) })
      .expect(400);
    for (const query of [
      { page: 0 },
      { pageSize: 101 },
      { isActive: 'invalid' },
      { organizationId: orgB },
    ]) {
      await api()
        .get(path())
        .set('Authorization', auth())
        .query(query)
        .expect(400);
    }
    await api().get(path()).set('Authorization', 'Bearer invalid').expect(401);
  });
});
