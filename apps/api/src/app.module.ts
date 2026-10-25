import { Module } from '@nestjs/common';
import { HealthModule } from './modules/health/health.module.js';
import { DatabaseModule } from './database/database.module.js';
import { RedisModule } from './infrastructure/redis/redis.module.js';
import { LoggerModule } from 'nestjs-pino';
import { createLoggerConfig } from './config/logger.config.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { AuthorizationModule } from './modules/authorization/authorization.module.js';

import { OrganizationsModule } from './modules/organizations/organizations.module.js';
import { FarmsModule } from './modules/farms/farms.module.js';

import { UsersModule } from './modules/users/users.module.js';

@Module({
  imports: [
    HealthModule,
    DatabaseModule,
    RedisModule,
    LoggerModule.forRoot(createLoggerConfig()),
    AuthModule,
    AuthorizationModule,
    OrganizationsModule,
    FarmsModule,
    UsersModule,
  ],
})
export class AppModule {}
