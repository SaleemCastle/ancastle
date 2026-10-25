import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import {
  Body,
  Controller,
  Get,
  Inject,
  Patch,
  Post,
  UseGuards,
  type INestApplication,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { z } from 'zod';
import { DatabaseModule } from '../../database/database.module.js';
import { PrismaService } from '../../database/prisma.service.js';
import { HttpExceptionFilter } from '../../common/filters/http-exception.filter.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { AuthGuard } from '../auth/auth.guard.js';
import { TokenService } from '../auth/token.service.js';
import { AuthorizationModule } from './authorization.module.js';
import { AuthorizationGuard } from './authorization.guard.js';
import { FarmAccessGuard } from './farm-access.guard.js';
import { FarmAccessService } from './farm-access.service.js';
import { CurrentOrganization } from './current-organization.decorator.js';
import { CurrentFarm } from './current-farm.decorator.js';
import { OrganizationContext } from './organization-context.js';
import { FarmContext } from './farm-context.js';
import { FarmParam } from './farm-param.decorator.js';
import {
  OrganizationParam,
  RequirePermissions,
} from './require-permissions.decorator.js';
import { Permission } from './permissions.js';

@Controller('farm-access/:organizationId')
@UseGuards(AuthGuard, AuthorizationGuard)
@OrganizationParam()
@RequirePermissions(Permission.FARM_READ)
class FarmAccessController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(FarmAccessService) private readonly access: FarmAccessService,
  ) {}

  @Get()
  async list(@CurrentOrganization() context: OrganizationContext) {
    return {
      data: await this.prisma.farm.findMany({
        where: this.access.farmWhere(context),
        select: { id: true },
        orderBy: { code: 'asc' },
      }),
    };
  }

  @Get('organization/context')
  @RequirePermissions(Permission.ORGANIZATION_READ)
  organization(@CurrentOrganization() context: OrganizationContext) {
    return { data: { organizationId: context.organizationId } };
  }

  @Get(':farmId')
  @UseGuards(FarmAccessGuard)
  read(@CurrentFarm() context: FarmContext) {
    return { data: context };
  }

  @Post('selected/:selectedFarm')
  @FarmParam('selectedFarm')
  @UseGuards(FarmAccessGuard)
  select(@CurrentFarm() context: FarmContext) {
    return { data: context };
  }

  @Get(':farmId/assignments')
  @UseGuards(FarmAccessGuard)
  async scopedRecords(@CurrentFarm() context: FarmContext) {
    return {
      data: await this.prisma.farmAccessAssignment.findMany({
        where: context.scope({ OR: [{ isActive: true }, { isActive: false }] }),
        select: { organizationId: true, farmId: true },
      }),
    };
  }

  @Patch(':farmId')
  @UseGuards(FarmAccessGuard)
  @RequirePermissions(Permission.FARM_UPDATE)
  async update(
    @CurrentFarm() context: FarmContext,
    @Body(new ZodValidationPipe(z.object({ name: z.string().min(1) })))
    input: { name: string },
  ) {
    await this.prisma.farm.updateMany({
      where: { id: context.farmId, organizationId: context.organizationId },
      data: { name: input.name },
    });
    return { data: context };
  }
}

@Controller('unverified-farm')
class UnverifiedFarmController {
  @Get()
  read(@CurrentFarm() context: FarmContext) {
    return context;
  }

  @Get(':farmId')
  @UseGuards(FarmAccessGuard)
  guarded(@CurrentFarm() context: FarmContext) {
    return context;
  }
}

describe('Farm access assignments/context (HTTP + PostgreSQL)', () => {
  const prisma = new PrismaService();
  const orgA = randomUUID();
  const orgB = randomUUID();
  const farms = {
    first: randomUUID(),
    second: randomUUID(),
    inactive: randomUUID(),
    foreign: randomUUID(),
  };
  const users = {
    staff: randomUUID(),
    admin: randomUUID(),
    owner: randomUUID(),
    manager: randomUUID(),
    none: randomUUID(),
  };
  const memberships = {
    staffA: randomUUID(),
    staffB: randomUUID(),
    adminA: randomUUID(),
    adminB: randomUUID(),
    owner: randomUUID(),
    manager: randomUUID(),
    none: randomUUID(),
  };
  const assignmentA = randomUUID();
  const assignmentB = randomUUID();
  const orgIds = [orgA, orgB];
  const userIds = Object.values(users);
  const tokenByUser: Record<string, string> = {};
  let app: INestApplication;
  let service: FarmAccessService;

  beforeAll(async () => {
    vi.stubEnv('JWT_SECRET', 'farm-access-integration-test-secret');
    await prisma.$connect();
    await prisma.organization.createMany({
      data: [
        { id: orgA, name: 'Farm Access A', slug: 'farm-access-' + orgA },
        { id: orgB, name: 'Farm Access B', slug: 'farm-access-' + orgB },
      ],
    });
    await prisma.user.createMany({
      data: userIds.map((id) => ({
        id,
        email: id + '@example.com',
        passwordHash: 'unused-test-password-hash',
      })),
    });
    await prisma.organizationMembership.createMany({
      data: [
        {
          id: memberships.staffA,
          organizationId: orgA,
          userId: users.staff,
          role: 'STAFF',
        },
        {
          id: memberships.staffB,
          organizationId: orgB,
          userId: users.staff,
          role: 'STAFF',
        },
        {
          id: memberships.adminA,
          organizationId: orgA,
          userId: users.admin,
          role: 'ADMIN',
        },
        {
          id: memberships.adminB,
          organizationId: orgB,
          userId: users.admin,
          role: 'STAFF',
        },
        {
          id: memberships.owner,
          organizationId: orgA,
          userId: users.owner,
          role: 'OWNER',
        },
        {
          id: memberships.manager,
          organizationId: orgA,
          userId: users.manager,
          role: 'MANAGER',
        },
        {
          id: memberships.none,
          organizationId: orgA,
          userId: users.none,
          role: 'STAFF',
        },
      ],
    });
    await prisma.farm.createMany({
      data: [
        { id: farms.first, organizationId: orgA, name: 'First', code: '01' },
        { id: farms.second, organizationId: orgA, name: 'Second', code: '02' },
        {
          id: farms.inactive,
          organizationId: orgA,
          name: 'Inactive',
          code: '03',
          isActive: false,
        },
        {
          id: farms.foreign,
          organizationId: orgB,
          name: 'Foreign',
          code: '01',
        },
      ],
    });
    const tokens = new TokenService(new JwtService());
    for (const id of userIds)
      tokenByUser[id] = await tokens.createAccessToken(id, id + '@example.com');
    const module = await Test.createTestingModule({
      imports: [DatabaseModule, AuthorizationModule],
      controllers: [FarmAccessController, UnverifiedFarmController],
      providers: [AuthGuard, { provide: TokenService, useValue: tokens }],
    })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();
    service = module.get(FarmAccessService);
    app = module.createNestApplication();
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
  });

  beforeEach(async () => {
    await prisma.organization.updateMany({
      where: { id: { in: orgIds } },
      data: { isActive: true },
    });
    await prisma.user.updateMany({
      where: { id: { in: userIds } },
      data: { isActive: true },
    });
    await prisma.organizationMembership.updateMany({
      where: { organizationId: { in: orgIds } },
      data: { isActive: true },
    });
    await prisma.organizationMembership.update({
      where: { id: memberships.adminA },
      data: { role: 'ADMIN' },
    });
    await prisma.farm.updateMany({
      where: { id: { in: Object.values(farms) } },
      data: { isActive: true },
    });
    await prisma.farm.update({
      where: { id: farms.inactive },
      data: { isActive: false },
    });
    await prisma.farmAccessAssignment.deleteMany({
      where: { organizationId: { in: orgIds } },
    });
    await prisma.farmAccessAssignment.createMany({
      data: [
        {
          id: assignmentA,
          organizationId: orgA,
          membershipId: memberships.staffA,
          farmId: farms.first,
        },
        {
          id: assignmentB,
          organizationId: orgB,
          membershipId: memberships.staffB,
          farmId: farms.foreign,
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
  const auth = (user = users.staff) => 'Bearer ' + tokenByUser[user];
  const path = (farm?: string, organization = orgA) =>
    '/farm-access/' + organization + (farm ? '/' + farm : '');

  it('supports single and multiple assigned farms within one organization', async () => {
    const one = await api()
      .get(path())
      .set('Authorization', auth())
      .expect(200);
    expect(one.body.data).toEqual([{ id: farms.first }]);
    await api().get(path(farms.first)).set('Authorization', auth()).expect(200);
    await api()
      .get(path(farms.second))
      .set('Authorization', auth())
      .expect(403);
    await prisma.farmAccessAssignment.create({
      data: {
        organizationId: orgA,
        membershipId: memberships.staffA,
        farmId: farms.second,
      },
    });
    const many = await api()
      .get(path())
      .set('Authorization', auth())
      .expect(200);
    expect(many.body.data).toEqual([{ id: farms.first }, { id: farms.second }]);
    await api()
      .get(path(farms.second))
      .set('Authorization', auth())
      .expect(200);
  });

  it.each(['admin', 'owner'] as const)(
    'allows %s organization-wide access without assignment duplication',
    async (kind) => {
      const response = await api()
        .get(path())
        .set('Authorization', auth(users[kind]))
        .expect(200);
      expect(response.body.data).toEqual([
        { id: farms.first },
        { id: farms.second },
      ]);
      await api()
        .get(path(farms.second))
        .set('Authorization', auth(users[kind]))
        .expect(200);
      expect(
        await prisma.farmAccessAssignment.count({
          where: {
            membershipId:
              kind === 'admin' ? memberships.adminA : memberships.owner,
          },
        }),
      ).toBe(0);
    },
  );

  it('keeps administrative access constrained to that membership organization', async () => {
    await api()
      .get(path(farms.foreign))
      .set('Authorization', auth(users.admin))
      .expect(403);
    await api()
      .get(path(farms.foreign, orgB))
      .set('Authorization', auth(users.admin))
      .expect(403);
    await api()
      .get(path(farms.foreign, orgB))
      .set('Authorization', auth())
      .expect(200);
  });

  it.each(['none', 'manager'] as const)(
    'does not infer farm access for %s and preserves organization operations',
    async (kind) => {
      const list = await api()
        .get(path())
        .set('Authorization', auth(users[kind]))
        .expect(200);
      expect(list.body.data).toEqual([]);
      await api()
        .get(path(farms.first))
        .set('Authorization', auth(users[kind]))
        .expect(403);
      await api()
        .get(path('organization/context'))
        .set('Authorization', auth(users[kind]))
        .expect(200);
    },
  );

  it('rejects spoofed farm, tenant, user, membership and role claims', async () => {
    const claims = {
      farmId: farms.first,
      organizationId: orgB,
      userId: users.admin,
      membershipId: memberships.adminA,
      role: 'OWNER',
    };
    await api()
      .post(path('selected/' + farms.second))
      .set('Authorization', auth())
      .set('x-farm-id', farms.first)
      .set('x-organization-id', orgB)
      .query(claims)
      .send(claims)
      .expect(403);
    const allowed = await api()
      .post(path('selected/' + farms.first))
      .set('Authorization', auth())
      .send({ ...claims, farmId: farms.foreign })
      .expect(201);
    expect(allowed.body).toEqual({
      data: { organizationId: orgA, farmId: farms.first },
    });
  });

  it('does not disclose whether an inaccessible farm exists', async () => {
    const foreign = await api()
      .get(path(farms.foreign))
      .set('Authorization', auth())
      .expect(403);
    const missing = await api()
      .get(path(randomUUID()))
      .set('Authorization', auth())
      .expect(403);
    const unassigned = await api()
      .get(path(farms.second))
      .set('Authorization', auth())
      .expect(403);
    expect(foreign.body).toEqual(missing.body);
    expect(unassigned.body).toEqual(missing.body);
    expect(missing.body).toEqual({
      error: {
        code: 'FORBIDDEN',
        message: 'You do not have permission to perform this action',
      },
    });
  });

  it('keeps farm selection independent from write permissions', async () => {
    await api()
      .patch(path(farms.first))
      .set('Authorization', auth())
      .send({ name: 'Denied', role: 'ADMIN' })
      .expect(403);
    await api()
      .patch(path(farms.first))
      .set('Authorization', auth(users.admin))
      .send({ name: 'Authorized', organizationId: orgB, farmId: farms.foreign })
      .expect(200);
    expect(
      await prisma.farm.findUnique({ where: { id: farms.foreign } }),
    ).toMatchObject({ name: 'Foreign', organizationId: orgB });
  });

  it('scopes operational records by both selected farm and organization despite OR filters', async () => {
    await prisma.farmAccessAssignment.create({
      data: {
        organizationId: orgA,
        membershipId: memberships.staffA,
        farmId: farms.second,
      },
    });
    const response = await api()
      .get(path(farms.first + '/assignments'))
      .set('Authorization', auth())
      .expect(200);
    expect(response.body.data).toEqual([
      { organizationId: orgA, farmId: farms.first },
    ]);
  });

  it('supports non-destructive assignment revocation and reactivation', async () => {
    await prisma.farmAccessAssignment.update({
      where: { id: assignmentA },
      data: { isActive: false },
    });
    await api().get(path(farms.first)).set('Authorization', auth()).expect(403);
    expect(
      (await api().get(path()).set('Authorization', auth()).expect(200)).body
        .data,
    ).toEqual([]);
    await prisma.farmAccessAssignment.update({
      where: { id: assignmentA },
      data: { isActive: true },
    });
    await api().get(path(farms.first)).set('Authorization', auth()).expect(200);
  });

  it.each(['staff', 'admin'] as const)(
    'rejects inactive farms for %s',
    async (kind) => {
      await prisma.farmAccessAssignment.create({
        data: {
          organizationId: orgA,
          membershipId: memberships.staffA,
          farmId: farms.inactive,
        },
      });
      await api()
        .get(path(farms.inactive))
        .set('Authorization', auth(users[kind]))
        .expect(403);
    },
  );

  it.each(['membership', 'user', 'organization'] as const)(
    'rejects inactive %s with an already-issued token',
    async (kind) => {
      if (kind === 'membership')
        await prisma.organizationMembership.update({
          where: { id: memberships.staffA },
          data: { isActive: false },
        });
      if (kind === 'user')
        await prisma.user.update({
          where: { id: users.staff },
          data: { isActive: false },
        });
      if (kind === 'organization')
        await prisma.organization.update({
          where: { id: orgA },
          data: { isActive: false },
        });
      await api()
        .get(path(farms.first))
        .set('Authorization', auth())
        .expect(kind === 'user' ? 401 : 403);
    },
  );

  it('applies role changes on the next request and rejects stale privileged context', async () => {
    const stale = new OrganizationContext(
      orgA,
      memberships.adminA,
      users.admin,
      'ADMIN',
    );
    await prisma.organizationMembership.update({
      where: { id: memberships.adminA },
      data: { role: 'STAFF' },
    });
    await api()
      .get(path(farms.first))
      .set('Authorization', auth(users.admin))
      .expect(403);
    await expect(service.resolve(stale, farms.first)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await prisma.farmAccessAssignment.create({
      data: {
        organizationId: orgA,
        membershipId: memberships.adminA,
        farmId: farms.first,
      },
    });
    await api()
      .get(path(farms.first))
      .set('Authorization', auth(users.admin))
      .expect(200);
    await api()
      .get(path(farms.second))
      .set('Authorization', auth(users.admin))
      .expect(403);
  });

  it('rejects malformed/missing farm selection and missing/invalid authentication', async () => {
    await api().get(path('invalid')).set('Authorization', auth()).expect(403);
    const context = new OrganizationContext(
      orgA,
      memberships.staffA,
      users.staff,
      'STAFF',
    );
    await expect(service.resolve(context, undefined)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await api().get(path(farms.first)).expect(401);
    await api()
      .get(path(farms.first))
      .set('Authorization', 'Bearer invalid')
      .expect(401);
    await api().get('/unverified-farm').expect(403);
    await api()
      .get('/unverified-farm/' + farms.first)
      .expect(403);
  });

  it('keeps concurrent organization/farm selections independent', async () => {
    const response = await Promise.all([
      api().get(path(farms.first)).set('Authorization', auth()).expect(200),
      api()
        .get(path(farms.foreign, orgB))
        .set('Authorization', auth())
        .expect(200),
    ]);
    expect(response.map((entry) => entry.body.data)).toEqual([
      { organizationId: orgA, farmId: farms.first },
      { organizationId: orgB, farmId: farms.foreign },
    ]);
  });

  it.each([
    [
      'foreign farm',
      () => ({
        organizationId: orgA,
        membershipId: memberships.staffA,
        farmId: farms.foreign,
      }),
    ],
    [
      'foreign membership',
      () => ({
        organizationId: orgB,
        membershipId: memberships.staffA,
        farmId: farms.foreign,
      }),
    ],
    [
      'mismatched ownership',
      () => ({
        organizationId: orgA,
        membershipId: memberships.staffB,
        farmId: farms.first,
      }),
    ],
    [
      'missing membership',
      () => ({
        organizationId: orgA,
        membershipId: randomUUID(),
        farmId: farms.first,
      }),
    ],
    [
      'missing farm',
      () => ({
        organizationId: orgA,
        membershipId: memberships.staffA,
        farmId: randomUUID(),
      }),
    ],
  ] as const)(
    'prevents %s assignment at the database boundary',
    async (_kind, data) => {
      await expect(
        prisma.farmAccessAssignment.create({ data: data() }),
      ).rejects.toMatchObject({ code: 'P2003' });
    },
  );

  it('enforces assignment uniqueness and stable lifecycle fields', async () => {
    await expect(
      prisma.farmAccessAssignment.create({
        data: {
          organizationId: orgA,
          membershipId: memberships.staffA,
          farmId: farms.first,
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
    const persisted = await prisma.farmAccessAssignment.findUniqueOrThrow({
      where: { id: assignmentA },
    });
    expect(z.uuid().safeParse(persisted.id).success).toBe(true);
    expect(persisted.createdAt).toBeInstanceOf(Date);
    expect(persisted.updatedAt).toBeInstanceOf(Date);
    expect(persisted.isActive).toBe(true);
  });

  it('prevents reparenting assigned farms/memberships across organizations', async () => {
    await expect(
      prisma.farm.update({
        where: { id: farms.first },
        data: { organizationId: orgB, code: 'REPARENT' },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
    await prisma.farmAccessAssignment.create({
      data: {
        organizationId: orgA,
        membershipId: memberships.none,
        farmId: farms.first,
      },
    });
    await expect(
      prisma.organizationMembership.update({
        where: { id: memberships.none },
        data: { organizationId: orgB },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
  });

  it('protects assigned business records from destructive deletion', async () => {
    await expect(
      prisma.farm.delete({ where: { id: farms.first } }),
    ).rejects.toMatchObject({ code: 'P2003' });
    await expect(
      prisma.organizationMembership.delete({
        where: { id: memberships.staffA },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
  });
});
