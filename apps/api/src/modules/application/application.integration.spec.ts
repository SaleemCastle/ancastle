import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DatabaseModule } from '../../database/database.module.js';
import { PrismaService } from '../../database/prisma.service.js';
import { HttpExceptionFilter } from '../../common/filters/http-exception.filter.js';
import { TokenService } from '../auth/token.service.js';
import { ApplicationModule } from './application.module.js';

describe('Application access discovery (HTTP + PostgreSQL)', () => {
  const prisma = new PrismaService();
  const userId = randomUUID();
  const outsider = randomUUID();
  const orgs = {
    a: randomUUID(),
    b: randomUUID(),
    foreign: randomUUID(),
    inactive: randomUUID(),
  };
  const memberships = {
    a: randomUUID(),
    b: randomUUID(),
    foreign: randomUUID(),
    inactive: randomUUID(),
  };
  const farms = {
    a: randomUUID(),
    a2: randomUUID(),
    b: randomUUID(),
    unassigned: randomUUID(),
    inactive: randomUUID(),
    foreign: randomUUID(),
  };
  let app: INestApplication;
  let token: string;

  beforeAll(async () => {
    vi.stubEnv('JWT_SECRET', 'application-context-test-secret-at-least-32');
    await prisma.$connect();
    await prisma.organization.createMany({
      data: Object.entries(orgs).map(([name, id]) => ({
        id,
        name,
        slug: 'application-' + id,
      })),
    });
    await prisma.user.createMany({
      data: [userId, outsider].map((id) => ({
        id,
        email: id + '@example.com',
        passwordHash: 'unused-test-hash',
      })),
    });
    await prisma.organizationMembership.createMany({
      data: [
        {
          id: memberships.a,
          organizationId: orgs.a,
          userId,
          role: 'ADMIN',
          displayName: 'Organization A name',
        },
        {
          id: memberships.b,
          organizationId: orgs.b,
          userId,
          role: 'STAFF',
          displayName: 'Organization B name',
        },
        {
          id: memberships.inactive,
          organizationId: orgs.inactive,
          userId,
          role: 'OWNER',
        },
        {
          id: memberships.foreign,
          organizationId: orgs.foreign,
          userId: outsider,
          role: 'OWNER',
        },
      ],
    });
    await prisma.farm.createMany({
      data: [
        { id: farms.a, organizationId: orgs.a, name: 'A', code: 'A' },
        { id: farms.a2, organizationId: orgs.a, name: 'A2', code: 'A2' },
        {
          id: farms.inactive,
          organizationId: orgs.a,
          name: 'Inactive',
          code: 'INACTIVE',
          isActive: false,
        },
        { id: farms.b, organizationId: orgs.b, name: 'B', code: 'B' },
        {
          id: farms.unassigned,
          organizationId: orgs.b,
          name: 'Unassigned',
          code: 'UNASSIGNED',
        },
        {
          id: farms.foreign,
          organizationId: orgs.foreign,
          name: 'Private',
          code: 'PRIVATE',
        },
      ],
    });
    await prisma.farmAccessAssignment.createMany({
      data: [
        {
          organizationId: orgs.a,
          membershipId: memberships.a,
          farmId: farms.a,
        },
        {
          organizationId: orgs.b,
          membershipId: memberships.b,
          farmId: farms.b,
        },
      ],
    });
    const module = await Test.createTestingModule({
      imports: [DatabaseModule, ApplicationModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();
    token = await module
      .get(TokenService)
      .createAccessToken(userId, userId + '@example.com');
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
  });
  beforeEach(async () => {
    await prisma.user.update({
      where: { id: userId },
      data: { isActive: true },
    });
    await prisma.organization.updateMany({
      where: { id: { in: Object.values(orgs) } },
      data: { isActive: true },
    });
    await prisma.organization.update({
      where: { id: orgs.inactive },
      data: { isActive: false },
    });
    await prisma.organizationMembership.updateMany({
      where: { userId },
      data: { isActive: true },
    });
    await prisma.organizationMembership.update({
      where: { id: memberships.a },
      data: { role: 'ADMIN' },
    });
    await prisma.farmAccessAssignment.updateMany({
      where: { organizationId: { in: Object.values(orgs) } },
      data: { isActive: true },
    });
  });
  afterAll(async () => {
    await app?.close();
    await prisma.farmAccessAssignment.deleteMany({
      where: { organizationId: { in: Object.values(orgs) } },
    });
    await prisma.farm.deleteMany({
      where: { organizationId: { in: Object.values(orgs) } },
    });
    await prisma.organizationMembership.deleteMany({
      where: { organizationId: { in: Object.values(orgs) } },
    });
    await prisma.user.deleteMany({ where: { id: { in: [userId, outsider] } } });
    await prisma.organization.deleteMany({
      where: { id: { in: Object.values(orgs) } },
    });
    await prisma.$disconnect();
    vi.unstubAllEnvs();
  });
  const get = (query = '') =>
    request(app.getHttpServer())
      .get('/api/application/context' + query)
      .set('Authorization', 'Bearer ' + token);

  it('returns only this identity’s active organizations and scoped active farms with distinct roles', async () => {
    const response = await get().expect(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body.meta).toEqual({
      page: 1,
      pageSize: 20,
      totalItems: 2,
      totalPages: 1,
    });
    const [a, b] = response.body.data;
    expect(a.organization.id).toBe(orgs.a);
    expect(a.farms.map((farm: { id: string }) => farm.id)).toEqual([
      farms.a,
      farms.a2,
    ]);
    expect(a.membership).toEqual({
      role: 'ADMIN',
      displayName: 'Organization A name',
    });
    expect(a.permissions).toContain('farm:access-all');
    expect(b.organization.id).toBe(orgs.b);
    expect(b.farms.map((farm: { id: string }) => farm.id)).toEqual([farms.b]);
    expect(b.membership.role).toBe('STAFF');
    expect(b.permissions).not.toContain('farm:access-all');
    expect(JSON.stringify(response.body)).not.toContain(farms.foreign);
    expect(JSON.stringify(response.body)).not.toContain(farms.unassigned);
    expect(JSON.stringify(response.body)).not.toContain(farms.inactive);
    expect(Object.keys(a).sort()).toEqual([
      'farms',
      'membership',
      'organization',
      'permissions',
    ]);
    expect(Object.keys(a.organization).sort()).toEqual(['id', 'name', 'slug']);
    expect(Object.keys(a.farms[0]).sort()).toEqual(['code', 'id', 'name']);
    for (const secret of [
      'passwordHash',
      'accessToken',
      'refreshToken',
      'authSession',
      'membershipId',
    ])
      expect(JSON.stringify(response.body)).not.toContain(secret);
  });
  it.each([undefined, 'invalid'])(
    'rejects unauthenticated/invalid authentication',
    async (supplied) => {
      const req = request(app.getHttpServer()).get('/api/application/context');
      if (supplied) req.set('Authorization', 'Bearer ' + supplied);
      await req.expect(401);
    },
  );
  it('rejects globally inactive users', async () => {
    await prisma.user.update({
      where: { id: userId },
      data: { isActive: false },
    });
    await get().expect(401);
  });
  it('removes inactive memberships and organizations on the next request', async () => {
    await prisma.organizationMembership.update({
      where: { id: memberships.a },
      data: { isActive: false },
    });
    expect(
      (await get().expect(200)).body.data.map(
        (entry: { organization: { id: string } }) => entry.organization.id,
      ),
    ).toEqual([orgs.b]);
    await prisma.organization.update({
      where: { id: orgs.b },
      data: { isActive: false },
    });
    expect((await get().expect(200)).body).toMatchObject({
      data: [],
      meta: { totalItems: 0, totalPages: 0 },
    });
  });
  it('applies current role and assignment changes without relying on login claims', async () => {
    await prisma.organizationMembership.update({
      where: { id: memberships.a },
      data: { role: 'STAFF' },
    });
    let response = await get().expect(200);
    expect(response.body.data[0].permissions).not.toContain('farm:access-all');
    expect(
      response.body.data[0].farms.map((farm: { id: string }) => farm.id),
    ).toEqual([farms.a]);
    await prisma.farmAccessAssignment.updateMany({
      where: { membershipId: memberships.a },
      data: { isActive: false },
    });
    response = await get().expect(200);
    expect(response.body.data[0].farms).toEqual([]);
    expect(
      response.body.data[1].farms.map((farm: { id: string }) => farm.id),
    ).toEqual([farms.b]);
  });
  it('ignores body/header ownership/role claims and rejects unknown query claims', async () => {
    const response = await get()
      .set('x-organization-id', orgs.foreign)
      .set('x-user-id', outsider)
      .set('x-role', 'OWNER')
      .send({
        userId: outsider,
        organizationId: orgs.foreign,
        farmId: farms.foreign,
        role: 'OWNER',
      })
      .expect(200);
    expect(
      response.body.data.map(
        (entry: { organization: { id: string } }) => entry.organization.id,
      ),
    ).toEqual([orgs.a, orgs.b]);
    for (const query of [
      '?userId=' + outsider,
      '?organizationId=' + orgs.foreign,
      '?farmId=' + farms.foreign,
      '?role=OWNER',
    ])
      await get(query).expect(400);
  });
  it('paginates/counts only accessible organizations and rejects malformed pagination', async () => {
    const response = await get('?page=2&pageSize=1').expect(200);
    expect(response.body.data[0].organization.id).toBe(orgs.b);
    expect(response.body.meta).toEqual({
      page: 2,
      pageSize: 1,
      totalItems: 2,
      totalPages: 2,
    });
    expect((await get('?page=3&pageSize=1').expect(200)).body.data).toEqual([]);
    for (const query of ['?page=0', '?pageSize=101', '?page=bad'])
      await get(query).expect(400);
  });
});
