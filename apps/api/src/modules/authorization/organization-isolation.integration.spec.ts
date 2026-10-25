import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  UseGuards,
  type INestApplication,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { z } from 'zod';
import { PrismaService } from '../../database/prisma.service.js';
import { BusinessException } from '../../common/exceptions/business.exception.js';
import { HttpExceptionFilter } from '../../common/filters/http-exception.filter.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { AuthGuard } from '../auth/auth.guard.js';
import { TokenService } from '../auth/token.service.js';
import { AuthorizationGuard } from './authorization.guard.js';
import { AuthorizationService } from './authorization.service.js';
import { CurrentOrganization } from './current-organization.decorator.js';
import { OrganizationContext } from './organization-context.js';
import { Permission } from './permissions.js';
import {
  OrganizationParam,
  RequirePermissions,
} from './require-permissions.decorator.js';

const updateSchema = z.object({ name: z.string().trim().min(1).max(100) });

// Test-only routes exercise the primitives without shipping M1-07 management APIs.
@Controller('scope/:tenantId')
@UseGuards(AuthGuard, AuthorizationGuard)
@OrganizationParam('tenantId')
class IsolationController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Post('context')
  context(@CurrentOrganization() context: OrganizationContext) {
    return { data: context };
  }

  @Get('farms')
  @RequirePermissions(Permission.FARM_READ)
  async list(@CurrentOrganization() context: OrganizationContext) {
    const data = await this.prisma.farm.findMany({
      where: context.scope({}),
      select: { id: true, name: true, organizationId: true },
    });
    return { data };
  }

  @Get('farms/:id')
  @RequirePermissions(Permission.FARM_READ)
  async read(
    @CurrentOrganization() context: OrganizationContext,
    @Param('id', new ZodValidationPipe(z.uuid())) id: string,
  ) {
    const farm = await this.prisma.farm.findFirst({
      where: context.scope({ id }),
      select: { id: true, name: true, organizationId: true },
    });
    if (!farm) throw this.notFound();
    return { data: farm };
  }

  @Patch('farms/:id')
  @RequirePermissions(Permission.FARM_UPDATE)
  async update(
    @CurrentOrganization() context: OrganizationContext,
    @Param('id', new ZodValidationPipe(z.uuid())) id: string,
    @Body(new ZodValidationPipe(updateSchema))
    input: z.infer<typeof updateSchema>,
  ) {
    const result = await this.prisma.farm.updateMany({
      where: context.scope({ id }),
      data: input,
    });
    if (!result.count) throw this.notFound();
    return { data: { id } };
  }

  @Get('or-filter')
  @RequirePermissions(Permission.FARM_READ)
  async orFilter(
    @CurrentOrganization() context: OrganizationContext,
    @Param('tenantId') selectedId: string,
  ) {
    // A permissive OR, NOT, or conflicting tenant filter must still be constrained.
    return {
      data: await this.prisma.farm.findMany({
        where: context.scope({
          OR: [
            { NOT: { organizationId: selectedId } },
            { organizationId: selectedId },
          ],
        }),
        select: { id: true },
      }),
    };
  }

  private notFound() {
    return new BusinessException('FARM_NOT_FOUND', 'Farm was not found', 404);
  }
}

@Controller('missing-context')
class MissingContextController {
  @Get()
  read(@CurrentOrganization() context: OrganizationContext) {
    return context;
  }
}

describe('Organization isolation (HTTP + PostgreSQL)', () => {
  const prisma = new PrismaService();
  const jwt = new JwtService();
  const tokens = new TokenService(jwt);
  const orgA = randomUUID();
  const orgB = randomUUID();
  const userId = randomUUID();
  const outsiderId = randomUUID();
  let app: INestApplication;
  let accessToken: string;
  let outsiderToken: string;
  let farmA: string;
  let farmB: string;
  let membershipA: string;

  beforeAll(async () => {
    vi.stubEnv('JWT_SECRET', 'organization-isolation-test-secret');
    await prisma.$connect();
    await prisma.organization.createMany({
      data: [
        { id: orgA, name: 'Tenant A', slug: 'isolation-' + orgA },
        { id: orgB, name: 'Tenant B', slug: 'isolation-' + orgB },
      ],
    });
    await prisma.user.createMany({
      data: [
        {
          id: userId,
          email: userId + '@example.com',
          passwordHash: 'unused-test-hash',
        },
        {
          id: outsiderId,
          email: outsiderId + '@example.com',
          passwordHash: 'unused-test-hash',
        },
      ],
    });
    membershipA = (
      await prisma.organizationMembership.create({
        data: { userId, organizationId: orgA, role: 'ADMIN' },
      })
    ).id;
    await prisma.organizationMembership.create({
      data: { userId, organizationId: orgB, role: 'STAFF' },
    });
    farmA = (
      await prisma.farm.create({
        data: { organizationId: orgA, name: 'Farm A', code: 'A' },
      })
    ).id;
    farmB = (
      await prisma.farm.create({
        data: { organizationId: orgB, name: 'Farm B', code: 'B' },
      })
    ).id;
    accessToken = await tokens.createAccessToken(
      userId,
      userId + '@example.com',
    );
    outsiderToken = await tokens.createAccessToken(
      outsiderId,
      outsiderId + '@example.com',
    );

    const module = await Test.createTestingModule({
      controllers: [IsolationController, MissingContextController],
      providers: [
        { provide: TokenService, useValue: tokens },
        AuthorizationService,
        { provide: PrismaService, useValue: prisma },
        AuthGuard,
        AuthorizationGuard,
      ],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
  });

  beforeEach(async () => {
    await prisma.user.update({
      where: { id: userId },
      data: { isActive: true },
    });
    await prisma.organization.updateMany({
      where: { id: { in: [orgA, orgB] } },
      data: { isActive: true },
    });
    await prisma.organizationMembership.updateMany({
      where: { userId },
      data: { isActive: true },
    });
  });

  afterAll(async () => {
    if (app) await app.close();
    await prisma.farm.deleteMany({
      where: { organizationId: { in: [orgA, orgB] } },
    });
    await prisma.organizationMembership.deleteMany({
      where: { organizationId: { in: [orgA, orgB] } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [userId, outsiderId] } },
    });
    await prisma.organization.deleteMany({
      where: { id: { in: [orgA, orgB] } },
    });
    await prisma.$disconnect();
    vi.unstubAllEnvs();
  });

  const api = () => request(app.getHttpServer());
  const bearer = () => 'Bearer ' + accessToken;
  const path = (org: string, resource = 'farms') =>
    '/scope/' + org + '/' + resource;

  it('exposes only verified membership context and ignores spoofed body/query/header identity', async () => {
    const response = await api()
      .post(path(orgA, 'context'))
      .set('Authorization', bearer())
      .set('x-organization-id', orgB)
      .query({ organizationId: orgB, userId: outsiderId, role: 'OWNER' })
      .send({
        organizationId: orgB,
        userId: outsiderId,
        role: 'OWNER',
        membershipId: randomUUID(),
      })
      .expect(201);
    expect(response.body).toEqual({
      data: {
        organizationId: orgA,
        userId,
        membershipId: membershipA,
        role: 'ADMIN',
      },
    });
  });

  it('scopes lists and complex filters to the selected verified organization', async () => {
    const a = await api()
      .get(path(orgA))
      .set('Authorization', bearer())
      .expect(200);
    const b = await api()
      .get(path(orgB))
      .set('Authorization', bearer())
      .expect(200);
    const filtered = await api()
      .get(path(orgA, 'or-filter'))
      .set('Authorization', bearer())
      .expect(200);
    expect(a.body.data.map((farm: { id: string }) => farm.id)).toEqual([farmA]);
    expect(b.body.data.map((farm: { id: string }) => farm.id)).toEqual([farmB]);
    expect(filtered.body.data).toEqual([{ id: farmA }]);
  });

  it('allows authorized reads and writes and cannot reassign ownership using payload IDs', async () => {
    const response = await api()
      .get(path(orgA, 'farms/' + farmA))
      .set('Authorization', bearer())
      .expect(200);
    expect(response.body.data.organizationId).toBe(orgA);
    await api()
      .patch(path(orgA, 'farms/' + farmA))
      .set('Authorization', bearer())
      .send({
        name: 'Updated A',
        organizationId: orgB,
        userId: outsiderId,
        role: 'OWNER',
        farmId: farmB,
      })
      .expect(200);
    expect(
      await prisma.farm.findUnique({ where: { id: farmA } }),
    ).toMatchObject({
      name: 'Updated A',
      organizationId: orgA,
    });
  });

  it('returns identical not-found responses for inaccessible and nonexistent resource IDs', async () => {
    for (const method of ['get', 'patch'] as const) {
      const foreign = await api()
        [method](path(orgA, 'farms/' + farmB))
        .set('Authorization', bearer())
        .send({ name: 'Compromised', organizationId: orgB })
        .expect(404);
      const missing = await api()
        [method](path(orgA, 'farms/' + randomUUID()))
        .set('Authorization', bearer())
        .send({ name: 'Compromised' })
        .expect(404);
      expect(foreign.body).toEqual(missing.body);
      expect(foreign.body).toEqual({
        error: { code: 'FARM_NOT_FOUND', message: 'Farm was not found' },
      });
    }
    expect(
      await prisma.farm.findUnique({ where: { id: farmB } }),
    ).toMatchObject({ name: 'Farm B' });
  });

  it('does not carry administrator permissions from A into B', async () => {
    await api()
      .patch(path(orgB, 'farms/' + farmB))
      .set('Authorization', bearer())
      .send({
        name: 'Compromised',
        organizationId: orgA,
        role: 'OWNER',
        userId,
      })
      .expect(403);
  });

  it('rejects absent and nonexistent memberships without revealing organization existence', async () => {
    const existing = await api()
      .post(path(orgA, 'context'))
      .set('Authorization', 'Bearer ' + outsiderToken)
      .send({ userId, role: 'OWNER' })
      .expect(403);
    const missing = await api()
      .post(path(randomUUID(), 'context'))
      .set('Authorization', 'Bearer ' + outsiderToken)
      .expect(403);
    expect(existing.body).toEqual(missing.body);
    expect(existing.body).toEqual({
      error: {
        code: 'FORBIDDEN',
        message: 'You do not have permission to perform this action',
      },
    });
  });

  it.each(['membership', 'organization', 'user'])(
    'rejects inactive %s on subsequent requests',
    async (kind) => {
      if (kind === 'membership')
        await prisma.organizationMembership.update({
          where: { id: membershipA },
          data: { isActive: false },
        });
      if (kind === 'organization')
        await prisma.organization.update({
          where: { id: orgA },
          data: { isActive: false },
        });
      if (kind === 'user')
        await prisma.user.update({
          where: { id: userId },
          data: { isActive: false },
        });
      await api()
        .get(path(orgA))
        .set('Authorization', bearer())
        .expect(kind === 'user' ? 401 : 403);
    },
  );

  it('rejects missing/invalid/expired authentication', async () => {
    await api().get(path(orgA)).expect(401);
    await api()
      .get(path(orgA))
      .set('Authorization', 'Bearer invalid')
      .expect(401);
    const expired = await jwt.signAsync(
      { sub: userId, email: userId + '@example.com', type: 'access' },
      {
        secret: process.env.JWT_SECRET,
        expiresIn: -1,
      },
    );
    await api()
      .get(path(orgA))
      .set('Authorization', 'Bearer ' + expired)
      .expect(401);
  });

  it('rejects malformed organization/resource IDs and invalid update data safely', async () => {
    await api().get(path('invalid')).set('Authorization', bearer()).expect(403);
    const idResponse = await api()
      .get(path(orgA, 'farms/invalid'))
      .set('Authorization', bearer())
      .expect(400);
    const bodyResponse = await api()
      .patch(path(orgA, 'farms/' + farmA))
      .set('Authorization', bearer())
      .send({ name: '' })
      .expect(400);
    expect(idResponse.body.error.code).toBe('VALIDATION_ERROR');
    expect(bodyResponse.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('fails closed if a controller consumes context without a verifying guard', async () => {
    await api().get('/missing-context').expect(403);
  });

  it('keeps concurrent tenant contexts independent', async () => {
    const responses = await Promise.all(
      [orgA, orgB, orgA, orgB].map((org) =>
        api()
          .post(path(org, 'context'))
          .set('Authorization', bearer())
          .expect(201),
      ),
    );
    expect(
      responses.map((response) => response.body.data.organizationId),
    ).toEqual([orgA, orgB, orgA, orgB]);
  });
});
