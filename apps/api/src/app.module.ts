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
import { InventoryModule } from './modules/inventory/inventory.module.js';
import { SalesCatalogModule } from './modules/sales-catalog/sales-catalog.module.js';
import { PoultryModule } from './modules/poultry/poultry.module.js';
import { SalesOrdersModule } from './modules/sales-orders/sales-orders.module.js';
import { FulfilmentsModule } from './modules/fulfilments/fulfilments.module.js';
import { InvoicesModule } from './modules/invoices/invoices.module.js';
import { PaymentsModule } from './modules/payments/payments.module.js';
import { ReceivablesModule } from './modules/receivables/receivables.module.js';

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
    InventoryModule,
    PoultryModule,
    SalesCatalogModule,
    SalesOrdersModule,
    FulfilmentsModule,
    InvoicesModule,
    PaymentsModule,
    ReceivablesModule,
  ],
})
export class AppModule {}
