import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import {
  Controller,
  Get,
  Inject,
  Param,
  UseGuards,
  type INestApplication,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { LoginResponse } from '@ancastle/types';
import { DatabaseModule } from '../../database/database.module.js';
import { PrismaService } from '../../database/prisma.service.js';
import { BusinessException } from '../../common/exceptions/business.exception.js';
import { HttpExceptionFilter } from '../../common/filters/http-exception.filter.js';
import { AuthModule } from '../auth/auth.module.js';
import { AuthGuard } from '../auth/auth.guard.js';
import { PasswordService } from '../auth/password.service.js';
import { TokenService } from '../auth/token.service.js';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { AuthorizationGuard } from '../authorization/authorization.guard.js';
import { FarmAccessGuard } from '../authorization/farm-access.guard.js';
import { FarmContext } from '../authorization/farm-context.js';
import { CurrentFarm } from '../authorization/current-farm.decorator.js';
import {
  OrganizationParam,
  RequirePermissions,
} from '../authorization/require-permissions.decorator.js';
import { Permission } from '../authorization/permissions.js';
import { OrganizationsModule } from '../organizations/organizations.module.js';
import { FarmsModule } from '../farms/farms.module.js';
import { UsersModule } from '../users/users.module.js';
import { ApplicationModule } from '../application/application.module.js';

// Test-only operational probe; production authorization/scoping primitives are unchanged.
@Controller('m1-security/:organizationId/farms/:farmId/assignments')
@UseGuards(AuthGuard, AuthorizationGuard, FarmAccessGuard)
@OrganizationParam()
@RequirePermissions(Permission.FARM_READ)
class OperationalProbe {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}
  @Get(':recordId')
  async read(
    @CurrentFarm() context: FarmContext,
    @Param('recordId') id: string,
  ) {
    const record = await this.prisma.farmAccessAssignment.findFirst({
      where: context.scope({ id }),
      select: { id: true, organizationId: true, farmId: true },
    });
    if (!record)
      throw new BusinessException('NOT_FOUND', 'Record was not found', 404);
    return { data: record };
  }
}

describe('M1 milestone security workflow (HTTP + PostgreSQL)', () => {
  const prisma = new PrismaService();
  const runId = randomUUID();
  const org = { a: randomUUID(), b: randomUUID() };
  const users = {
    owner: randomUUID(),
    staff: randomUUID(),
    foreign: randomUUID(),
    inactive: randomUUID(),
    none: randomUUID(),
  };
  const memberships = {
    ownerA: randomUUID(),
    ownerB: randomUUID(),
    staff: randomUUID(),
    foreign: randomUUID(),
    inactive: randomUUID(),
  };
  const farms = {
    first: randomUUID(),
    second: randomUUID(),
    inactive: randomUUID(),
    foreign: randomUUID(),
  };
  const assignments = {
    first: randomUUID(),
    second: randomUUID(),
    foreign: randomUUID(),
  };
  const password = 'M113-test-only-credentials!';
  const email = (id: string) => 'm113-' + id + '@example.com';
  let app: INestApplication;
  let tokens: TokenService;
  let passwordHash: string;
  const api = () => request(app.getHttpServer());
  const farmPath = (organization = org.a, farmId?: string) =>
    '/api/organizations/' +
    organization +
    '/farms' +
    (farmId ? '/' + farmId : '');
  const userPath = (userId?: string, suffix?: string, organization = org.a) =>
    '/api/organizations/' +
    organization +
    '/users' +
    (userId ? '/' + userId : '') +
    (suffix ? '/' + suffix : '');
  const probe = (farmId: string, recordId: string) =>
    '/api/m1-security/' +
    org.a +
    '/farms/' +
    farmId +
    '/assignments/' +
    recordId;

  beforeAll(async () => {
    vi.stubEnv('JWT_SECRET', 'm113-access-test-secret-at-least-32-characters');
    vi.stubEnv(
      'JWT_REFRESH_SECRET',
      'm113-refresh-test-secret-at-least-32-characters',
    );
    await prisma.$connect();
    passwordHash = await new PasswordService().hash(password);
    await prisma.organization.createMany({
      data: [
        { id: org.a, name: 'Milestone A', slug: 'm113-a-' + runId },
        { id: org.b, name: 'Milestone B', slug: 'm113-b-' + runId },
      ],
    });
    await prisma.user.createMany({
      data: Object.values(users).map((id) => ({
        id,
        email: email(id),
        passwordHash,
        isActive: id !== users.inactive,
      })),
    });
    await prisma.organizationMembership.createMany({
      data: [
        {
          id: memberships.ownerA,
          organizationId: org.a,
          userId: users.owner,
          role: 'OWNER',
        },
        {
          id: memberships.ownerB,
          organizationId: org.b,
          userId: users.owner,
          role: 'STAFF',
        },
        {
          id: memberships.staff,
          organizationId: org.a,
          userId: users.staff,
          role: 'STAFF',
        },
        {
          id: memberships.foreign,
          organizationId: org.b,
          userId: users.foreign,
          role: 'OWNER',
        },
        {
          id: memberships.inactive,
          organizationId: org.a,
          userId: users.inactive,
          role: 'STAFF',
        },
      ],
    });
    await prisma.farm.createMany({
      data: [
        {
          id: farms.first,
          organizationId: org.a,
          name: 'First',
          code: 'FIRST',
        },
        {
          id: farms.second,
          organizationId: org.a,
          name: 'Second',
          code: 'SECOND',
        },
        {
          id: farms.inactive,
          organizationId: org.a,
          name: 'Inactive',
          code: 'INACTIVE',
          isActive: false,
        },
        {
          id: farms.foreign,
          organizationId: org.b,
          name: 'Foreign',
          code: 'FOREIGN',
        },
      ],
    });
    await prisma.farmAccessAssignment.createMany({
      data: [
        {
          id: assignments.first,
          organizationId: org.a,
          farmId: farms.first,
          membershipId: memberships.staff,
        },
        {
          id: assignments.second,
          organizationId: org.a,
          farmId: farms.second,
          membershipId: memberships.staff,
          isActive: false,
        },
        {
          id: assignments.foreign,
          organizationId: org.b,
          farmId: farms.foreign,
          membershipId: memberships.ownerB,
        },
      ],
    });
    const module = await Test.createTestingModule({
      imports: [
        DatabaseModule,
        AuthModule,
        AuthorizationModule,
        OrganizationsModule,
        FarmsModule,
        UsersModule,
        ApplicationModule,
      ],
      controllers: [OperationalProbe],
    })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();
    tokens = module.get(TokenService);
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
  }, 30000);
  beforeEach(async () => {
    await prisma.organization.updateMany({
      where: { id: { in: Object.values(org) } },
      data: { isActive: true },
    });
    await prisma.user.updateMany({
      where: { id: { in: Object.values(users) } },
      data: { isActive: true },
    });
    await prisma.user.update({
      where: { id: users.inactive },
      data: { isActive: false },
    });
    await prisma.organizationMembership.updateMany({
      where: { id: { in: Object.values(memberships) } },
      data: { isActive: true },
    });
    await prisma.organizationMembership.update({
      where: { id: memberships.staff },
      data: { role: 'STAFF' },
    });
    await prisma.farmAccessAssignment.update({
      where: { id: assignments.first },
      data: { isActive: true },
    });
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    const records = await prisma.organizationMembership.findMany({
      where: { organizationId: { in: Object.values(org) } },
      select: { userId: true },
    });
    const ids = [
      ...new Set([
        ...Object.values(users),
        ...records.map((entry) => entry.userId),
      ]),
    ];
    await prisma.authSession.deleteMany({ where: { userId: { in: ids } } });
    await prisma.farmAccessAssignment.deleteMany({
      where: { organizationId: { in: Object.values(org) } },
    });
    await prisma.farm.deleteMany({
      where: { organizationId: { in: Object.values(org) } },
    });
    await prisma.organizationMembership.deleteMany({
      where: { organizationId: { in: Object.values(org) } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: ids }, memberships: { none: {} } },
    });
    await prisma.organization.deleteMany({
      where: { id: { in: Object.values(org) } },
    });
    await app?.close();
    await prisma.$disconnect();
    vi.unstubAllEnvs();
  }, 30000);

  async function login(id = users.owner): Promise<LoginResponse> {
    const result = await api()
      .post('/api/auth/login')
      .send({ email: email(id), password })
      .expect(201);
    return result.body as LoginResponse;
  }
  function safe(body: unknown, secrets: string[] = []) {
    const serialized = JSON.stringify(body);
    for (const value of [
      password,
      passwordHash,
      'passwordHash',
      'refreshTokenHash',
      'authSessions',
      ...secrets,
    ])
      expect(serialized.includes(value)).toBe(false);
  }

  it('executes login, organization update, farm creation, user bootstrap and assigned-farm access as one workflow', async () => {
    const owner = await login();
    await api()
      .patch('/api/organizations/' + org.a)
      .set('Authorization', 'Bearer ' + owner.accessToken)
      .send({ name: 'Milestone updated' })
      .expect(200);
    const farm = await api()
      .post(farmPath())
      .set('Authorization', 'Bearer ' + owner.accessToken)
      .send({ name: 'Workflow Farm', code: 'WORKFLOW' })
      .expect(201);
    const createdEmail = 'm113-created-' + runId + '@example.com';
    const created = await api()
      .post(userPath())
      .set('Authorization', 'Bearer ' + owner.accessToken)
      .send({
        email: createdEmail,
        password,
        displayName: 'Workflow Member',
        role: 'STAFF',
        farmIds: [farm.body.data.id],
      })
      .expect(201);
    safe(created.body, [owner.accessToken, owner.refreshToken]);
    const member = await api()
      .post('/api/auth/login')
      .send({ email: createdEmail, password })
      .expect(201);
    const list = await api()
      .get(farmPath())
      .set('Authorization', 'Bearer ' + member.body.accessToken)
      .expect(200);
    expect(list.body.data.map((entry: { id: string }) => entry.id)).toEqual([
      farm.body.data.id,
    ]);
    safe(list.body, [member.body.accessToken, member.body.refreshToken]);
    await api()
      .patch(userPath(created.body.data.userId, 'membership'))
      .set('Authorization', 'Bearer ' + owner.accessToken)
      .send({ isActive: false })
      .expect(200);
    await api()
      .get(farmPath())
      .set('Authorization', 'Bearer ' + member.body.accessToken)
      .expect(403);
    await api()
      .post('/api/auth/refresh')
      .send({ refreshToken: member.body.refreshToken })
      .expect(401);
  });
  it.each([
    '/api/organizations/' + org.a,
    '/api/organizations/' + org.a + '/farms',
    '/api/organizations/' + org.a + '/users',
    '/api/application/context',
  ])('rejects unauthenticated protected endpoint %s', async (path) => {
    const result = await api().get(path).expect(401);
    expect(result.body.error.code).toBe('UNAUTHORIZED');
    safe(result.body);
  });
  it('rejects malformed, expired, wrong-type and invalidly signed access tokens', async () => {
    const jwt = new JwtService();
    const expired = await jwt.signAsync(
      { sub: users.owner, email: email(users.owner), type: 'access' },
      { secret: process.env.JWT_SECRET, expiresIn: -1 },
    );
    const wrongType = await jwt.signAsync(
      { sub: users.owner, email: email(users.owner), type: 'refresh' },
      { secret: process.env.JWT_SECRET },
    );
    const wrongSignature = await jwt.signAsync(
      { sub: users.owner, email: email(users.owner), type: 'access' },
      { secret: 'different-test-signing-secret' },
    );
    for (const token of ['not-a-token', expired, wrongType, wrongSignature]) {
      const result = await api()
        .get(farmPath())
        .set('Authorization', 'Bearer ' + token)
        .expect(401);
      safe(result.body, [token]);
    }
  });
  it('returns identical sanitized failures for unknown, wrong-password, inactive and membership-less login', async () => {
    const attempts = [
      { email: email(randomUUID()), password },
      { email: email(users.owner), password: 'incorrect-input' },
      { email: email(users.inactive), password },
      { email: email(users.none), password },
    ];
    for (const input of attempts) {
      const result = await api()
        .post('/api/auth/login')
        .send(input)
        .expect(401);
      expect(result.body).toEqual({
        error: {
          code: 'INVALID_CREDENTIALS',
          message: 'Invalid email or password',
        },
      });
      safe(result.body);
    }
  });
  it('checks current user, membership and organization lifecycle with already-issued authentication', async () => {
    const staff = await login(users.staff);
    await prisma.user.update({
      where: { id: users.staff },
      data: { isActive: false },
    });
    await api()
      .get(farmPath())
      .set('Authorization', 'Bearer ' + staff.accessToken)
      .expect(401);
    await prisma.user.update({
      where: { id: users.staff },
      data: { isActive: true },
    });
    await prisma.organizationMembership.update({
      where: { id: memberships.staff },
      data: { isActive: false },
    });
    await api()
      .get(farmPath())
      .set('Authorization', 'Bearer ' + staff.accessToken)
      .expect(403);
    await api()
      .post('/api/auth/refresh')
      .send({ refreshToken: staff.refreshToken })
      .expect(401);
    await prisma.organizationMembership.update({
      where: { id: memberships.staff },
      data: { isActive: true },
    });
    await prisma.organization.update({
      where: { id: org.a },
      data: { isActive: false },
    });
    await api()
      .get(farmPath())
      .set('Authorization', 'Bearer ' + staff.accessToken)
      .expect(403);
  });
  it('uses the selected organization role instead of stronger permissions in another organization', async () => {
    const owner = await login();
    await api()
      .get(farmPath(org.b))
      .set('Authorization', 'Bearer ' + owner.accessToken)
      .expect(200);
    const result = await api()
      .patch(farmPath(org.b, farms.foreign))
      .set('Authorization', 'Bearer ' + owner.accessToken)
      .set('x-role', 'OWNER')
      .send({ name: 'Forbidden role escalation' })
      .expect(403);
    safe(result.body, [owner.accessToken]);
    await api()
      .get(userPath(undefined, undefined, org.b))
      .set('Authorization', 'Bearer ' + owner.accessToken)
      .expect(403);
    expect(
      (await prisma.farm.findUniqueOrThrow({ where: { id: farms.foreign } }))
        .name,
    ).toBe('Foreign');
  });
  it('does not disclose foreign farm/user existence and blocks cross-organization writes', async () => {
    const owner = await login();
    const authorization = 'Bearer ' + owner.accessToken;
    const missingFarm = await api()
      .get(farmPath(org.a, randomUUID()))
      .set('Authorization', authorization)
      .expect(404);
    const foreignFarm = await api()
      .get(farmPath(org.a, farms.foreign))
      .set('Authorization', authorization)
      .expect(404);
    expect(foreignFarm.body).toEqual(missingFarm.body);
    await api()
      .patch(farmPath(org.a, farms.foreign))
      .set('Authorization', authorization)
      .send({ name: 'Cross tenant' })
      .expect(404);
    const foreignUser = await api()
      .get(userPath(users.foreign))
      .set('Authorization', authorization)
      .expect(404);
    const missingUser = await api()
      .get(userPath(randomUUID()))
      .set('Authorization', authorization)
      .expect(404);
    expect(foreignUser.body).toEqual(missingUser.body);
    await api()
      .patch(userPath(users.foreign, 'profile'))
      .set('Authorization', authorization)
      .send({ displayName: 'Cross tenant' })
      .expect(404);
    await api()
      .put(userPath(users.staff, 'farm-access'))
      .set('Authorization', authorization)
      .send({ farmIds: [farms.foreign] })
      .expect(400);
    expect(
      (await prisma.farm.findUniqueOrThrow({ where: { id: farms.foreign } }))
        .name,
    ).toBe('Foreign');
    expect(
      (
        await prisma.organizationMembership.findUniqueOrThrow({
          where: { id: memberships.foreign },
        })
      ).displayName,
    ).toBeNull();
  });
  it('rejects ownership/role payload claims rather than using them for authorization', async () => {
    const staff = await login(users.staff);
    await api()
      .post(farmPath())
      .set('Authorization', 'Bearer ' + staff.accessToken)
      .send({
        name: 'Spoofed',
        code: 'SPOOFED',
        organizationId: org.b,
        userId: users.owner,
        role: 'OWNER',
      })
      .expect(403);
    const owner = await login();
    await api()
      .post(farmPath())
      .set('Authorization', 'Bearer ' + owner.accessToken)
      .send({ name: 'Spoofed', code: 'SPOOFED', organizationId: org.b })
      .expect(400);
    const list = await api()
      .get(farmPath())
      .set('Authorization', 'Bearer ' + staff.accessToken)
      .set('x-organization-id', org.b)
      .set('x-user-id', users.owner)
      .send({ organizationId: org.b, role: 'OWNER' })
      .expect(200);
    expect(list.body.data.map((entry: { id: string }) => entry.id)).toEqual([
      farms.first,
    ]);
  });
  it('validates operational farm selection and rejects foreign/unassigned/inactive farms and spoofed IDs', async () => {
    const staff = await login(users.staff);
    const authorization = 'Bearer ' + staff.accessToken;
    await api()
      .get(probe(farms.first, assignments.first))
      .set('Authorization', authorization)
      .expect(200);
    for (const id of [
      farms.second,
      farms.foreign,
      farms.inactive,
      randomUUID(),
    ])
      await api()
        .get(probe(id, assignments.first))
        .set('Authorization', authorization)
        .send({ farmId: farms.first, organizationId: org.a, role: 'OWNER' })
        .expect(403);
    await prisma.farmAccessAssignment.update({
      where: { id: assignments.first },
      data: { isActive: false },
    });
    await api()
      .get(probe(farms.first, assignments.first))
      .set('Authorization', authorization)
      .expect(403);
  });
  it('scopes operational record IDs by both authoritative organization and selected farm', async () => {
    const staff = await login(users.staff);
    const authorization = 'Bearer ' + staff.accessToken;
    const own = await api()
      .get(probe(farms.first, assignments.first))
      .set('Authorization', authorization)
      .expect(200);
    expect(own.body.data).toEqual({
      id: assignments.first,
      organizationId: org.a,
      farmId: farms.first,
    });
    const missing = await api()
      .get(probe(farms.first, randomUUID()))
      .set('Authorization', authorization)
      .expect(404);
    for (const id of [assignments.second, assignments.foreign]) {
      const result = await api()
        .get(probe(farms.first, id))
        .set('Authorization', authorization)
        .expect(404);
      expect(result.body).toEqual(missing.body);
    }
  });
  it('keeps hashes, session details and tokens out of protected response DTOs', async () => {
    const owner = await login();
    safe(owner.user);
    expect(Object.keys(owner.user).sort()).toEqual(['email', 'id']);
    for (const path of [
      '/api/organizations/' + org.a,
      farmPath(),
      userPath(),
      '/api/application/context',
    ]) {
      const result = await api()
        .get(path)
        .set('Authorization', 'Bearer ' + owner.accessToken)
        .expect(200);
      safe(result.body, [owner.accessToken, owner.refreshToken]);
    }
    const payload = await tokens.verifyRefreshToken(owner.refreshToken);
    const session = await prisma.authSession.findUniqueOrThrow({
      where: { id: payload.sid },
    });
    expect(session.refreshTokenHash === owner.refreshToken).toBe(false);
    expect(
      session.refreshTokenHash === tokens.hashRefreshToken(owner.refreshToken),
    ).toBe(true);
  });
  it('rotates refresh tokens within the same issuance second and rejects replay', async () => {
    const owner = await login();
    const issuedAt = (
      new JwtService().decode(owner.refreshToken) as { iat: number }
    ).iat;
    vi.spyOn(Date, 'now').mockReturnValue(issuedAt * 1000 + 100);
    const refreshed = await api()
      .post('/api/auth/refresh')
      .send({ refreshToken: owner.refreshToken })
      .expect(201);
    expect(refreshed.body.refreshToken === owner.refreshToken).toBe(false);
    await api()
      .post('/api/auth/refresh')
      .send({ refreshToken: owner.refreshToken })
      .expect(401);
    await api()
      .post('/api/auth/logout')
      .send({ refreshToken: refreshed.body.refreshToken })
      .expect(204);
    await api()
      .post('/api/auth/refresh')
      .send({ refreshToken: refreshed.body.refreshToken })
      .expect(401);
  });
  it('allows only one successful redemption of a refresh token under concurrent requests', async () => {
    const owner = await login();
    const responses = await Promise.all([
      api()
        .post('/api/auth/refresh')
        .send({ refreshToken: owner.refreshToken }),
      api()
        .post('/api/auth/refresh')
        .send({ refreshToken: owner.refreshToken }),
    ]);
    expect(
      responses
        .map((entry) => entry.status)
        .sort((left, right) => left - right),
    ).toEqual([201, 401]);
  });
});
