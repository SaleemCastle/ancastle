import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../database/prisma.service.js';
import type { RedisService } from '../../infrastructure/redis/redis.service.js';
import { HealthService } from './health.service.js';

describe('HealthService', () => {
  let service: HealthService;

  let prisma: {
    $queryRaw: ReturnType<typeof vi.fn>;
  };

  let redisClient: {
    ping: ReturnType<typeof vi.fn>;
  };

  let redis: {
    getClient: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    prisma = {
      $queryRaw: vi.fn(),
    };

    redisClient = {
      ping: vi.fn(),
    };

    redis = {
      getClient: vi.fn().mockReturnValue(redisClient),
    };

    service = new HealthService(
      prisma as unknown as PrismaService,
      redis as unknown as RedisService,
    );
  });

  it('reports healthy when PostgreSQL and Redis are available', async () => {
    prisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);
    redisClient.ping.mockResolvedValue('PONG');

    const result = await service.check();

    expect(result.status).toBe('ok');
    expect(result.dependencies).toEqual({
      database: 'up',
      redis: 'up',
    });
  });

  it('reports unhealthy when PostgreSQL is unavailable', async () => {
    prisma.$queryRaw.mockRejectedValue(new Error('database connection failed'));
    redisClient.ping.mockResolvedValue('PONG');

    const result = await service.check();

    expect(result.status).toBe('error');
    expect(result.dependencies).toEqual({
      database: 'down',
      redis: 'up',
    });
  });

  it('reports unhealthy when Redis is unavailable', async () => {
    prisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);
    redisClient.ping.mockRejectedValue(new Error('redis connection failed'));

    const result = await service.check();

    expect(result.status).toBe('error');
    expect(result.dependencies).toEqual({
      database: 'up',
      redis: 'down',
    });
  });

  it('reports unhealthy when PostgreSQL and Redis are unavailable', async () => {
    prisma.$queryRaw.mockRejectedValue(
      new Error('postgresql://username:password@secret-host/database'),
    );

    redisClient.ping.mockRejectedValue(
      new Error('redis://username:password@secret-host:6379'),
    );

    const result = await service.check();

    expect(result.status).toBe('error');
    expect(result.dependencies).toEqual({
      database: 'down',
      redis: 'down',
    });

    expect(JSON.stringify(result)).not.toContain('password');
    expect(JSON.stringify(result)).not.toContain('secret-host');
    expect(JSON.stringify(result)).not.toContain('postgresql://');
    expect(JSON.stringify(result)).not.toContain('redis://');
  });
});
