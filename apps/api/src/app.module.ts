import { Module } from '@nestjs/common';
import { HealthModule } from './modules/health/health.module.js';
import { DatabaseModule } from './database/database.module.js';
import { RedisModule } from './infrastructure/redis/redis.module.js';
import { LoggerModule } from 'nestjs-pino';
import { createLoggerConfig } from './config/logger.config.js';

@Module({
  imports: [
    HealthModule,
    DatabaseModule,
    RedisModule,
    LoggerModule.forRoot(createLoggerConfig()),
  ],
})
export class AppModule {}
