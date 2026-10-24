import { Injectable } from '@nestjs/common';
import type { HealthStatus } from '@ancastle/types';
import { PrismaService } from '../../database/prisma.service.js';
import { RedisService } from '../../infrastructure/redis/redis.service.js';

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async check(): Promise<HealthStatus> {
    const [database, redis] = await Promise.all([
      this.checkDatabase(),
      this.checkRedis(),
    ]);

    return {
      status: database === 'up' && redis === 'up' ? 'ok' : 'error',
      service: 'ancastle-api',
      timestamp: new Date().toISOString(),
      dependencies: {
        database,
        redis,
      },
    };
  }

  private async checkDatabase(): Promise<'up' | 'down'> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return 'up';
    } catch {
      return 'down';
    }
  }

  private async checkRedis(): Promise<'up' | 'down'> {
    try {
      await this.redis.getClient().ping();
      return 'up';
    } catch {
      return 'down';
    }
  }
}
