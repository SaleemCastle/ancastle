import { Module } from '@nestjs/common';
import { HealthModule } from './modules/health/health.module.js';
import { DatabaseModule } from './database/database.module.js';
import { RedisModule } from './infrastructure/redis/redis.module.js';

@Module({
  imports: [HealthModule, DatabaseModule, RedisModule],
})
export class AppModule {}
