import { ApplicationModule } from './modules/application/application.module.js';
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
import { CustomersModule } from './modules/customers/customers.module.js';
import { SuppliersModule } from './modules/suppliers/suppliers.module.js';

@Module({
  imports: [
    HealthModule,
    ApplicationModule,
    DatabaseModule,
    RedisModule,
    LoggerModule.forRoot(createLoggerConfig()),
    AuthModule,
    AuthorizationModule,
    OrganizationsModule,
    FarmsModule,
    UsersModule,
    CustomersModule,
    SuppliersModule,
  ],
})
export class AppModule {}
