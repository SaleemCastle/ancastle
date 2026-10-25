import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { LoginResponse } from '@ancastle/types';
import { DatabaseModule } from '../../database/database.module.js';
import { PrismaService } from '../../database/prisma.service.js';
import { HttpExceptionFilter } from '../../common/filters/http-exception.filter.js';
import { AuthModule } from './auth.module.js';
import { PasswordService } from './password.service.js';
import { TokenService } from './token.service.js';

describe('Refresh rotation regression (HTTP + PostgreSQL)', () => {
  const prisma = new PrismaService();
  const userId = randomUUID();
  const organizationId = randomUUID();
  const email = 'refresh-regression-' + userId + '@example.com';
  const password = 'Refresh-regression-test-input!';
  let app: INestApplication;
  let tokens: TokenService;
  const api = () => request(app.getHttpServer());
  beforeAll(async () => {
    vi.stubEnv('JWT_SECRET', 'refresh-regression-access-secret-at-least-32');
    vi.stubEnv(
      'JWT_REFRESH_SECRET',
      'refresh-regression-refresh-secret-at-least-32',
    );
    await prisma.$connect();
    await prisma.organization.create({
      data: {
        id: organizationId,
        name: 'Refresh regression',
        slug: 'refresh-' + organizationId,
      },
    });
    await prisma.user.create({
      data: {
        id: userId,
        email,
        passwordHash: await new PasswordService().hash(password),
      },
    });
    await prisma.organizationMembership.create({
      data: { organizationId, userId, role: 'OWNER' },
    });
    const module = await Test.createTestingModule({
      imports: [DatabaseModule, AuthModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();
    tokens = module.get(TokenService);
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
    await prisma.organizationMembership.updateMany({
      where: { userId, organizationId },
      data: { isActive: true },
    });
    await prisma.organization.update({
      where: { id: organizationId },
      data: { isActive: true },
    });
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    await prisma.authSession.deleteMany({ where: { userId } });
    await prisma.organizationMembership.deleteMany({
      where: { userId, organizationId },
    });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.organization.delete({ where: { id: organizationId } });
    await app?.close();
    await prisma.$disconnect();
    vi.unstubAllEnvs();
  });
  async function login(): Promise<LoginResponse> {
    return (
      await api().post('/api/auth/login').send({ email, password }).expect(201)
    ).body as LoginResponse;
  }
  it('rotates within the same second, stores only the new hash and rejects the consumed token', async () => {
    const original = await login();
    const payload = new JwtService().decode(original.refreshToken) as {
      iat: number;
      sid: string;
    };
    vi.spyOn(Date, 'now').mockReturnValue(payload.iat * 1000 + 100);
    const refreshed = await api()
      .post('/api/auth/refresh')
      .send({ refreshToken: original.refreshToken })
      .expect(201);
    expect(refreshed.body.refreshToken === original.refreshToken).toBe(false);
    const session = await prisma.authSession.findUniqueOrThrow({
      where: { id: payload.sid },
    });
    expect(
      session.refreshTokenHash ===
        tokens.hashRefreshToken(refreshed.body.refreshToken),
    ).toBe(true);
    expect(session.refreshTokenHash === refreshed.body.refreshToken).toBe(
      false,
    );
    await api()
      .post('/api/auth/refresh')
      .send({ refreshToken: original.refreshToken })
      .expect(401);
    await api()
      .post('/api/auth/refresh')
      .send({ refreshToken: refreshed.body.refreshToken })
      .expect(201);
  });
  it('allows exactly one concurrent redemption and leaves the winner usable', async () => {
    const original = await login();
    const responses = await Promise.all(
      Array.from({ length: 6 }, () =>
        api()
          .post('/api/auth/refresh')
          .send({ refreshToken: original.refreshToken }),
      ),
    );
    expect(responses.filter((entry) => entry.status === 201).length).toBe(1);
    expect(responses.filter((entry) => entry.status === 401).length).toBe(5);
    const winner = responses.find((entry) => entry.status === 201)!;
    await api()
      .post('/api/auth/refresh')
      .send({ refreshToken: winner.body.refreshToken })
      .expect(201);
  });
  it('keeps logout revocation effective for a rotated session', async () => {
    const original = await login();
    const next = await api()
      .post('/api/auth/refresh')
      .send({ refreshToken: original.refreshToken })
      .expect(201);
    await api()
      .post('/api/auth/logout')
      .send({ refreshToken: original.refreshToken })
      .expect(204);
    await api()
      .post('/api/auth/refresh')
      .send({ refreshToken: next.body.refreshToken })
      .expect(401);
  });
  it('continues accepting a pre-fix signed refresh token once and retires it on rotation', async () => {
    const original = await login();
    const payload = await tokens.verifyRefreshToken(original.refreshToken);
    const legacy = await new JwtService().signAsync(
      { sub: userId, sid: payload.sid, type: 'refresh' },
      { secret: process.env.JWT_REFRESH_SECRET, expiresIn: 900 },
    );
    await prisma.authSession.update({
      where: { id: payload.sid },
      data: { refreshTokenHash: tokens.hashRefreshToken(legacy) },
    });
    const next = await api()
      .post('/api/auth/refresh')
      .send({ refreshToken: legacy })
      .expect(201);
    expect(next.body.refreshToken === legacy).toBe(false);
    await api()
      .post('/api/auth/refresh')
      .send({ refreshToken: legacy })
      .expect(401);
  });
});
