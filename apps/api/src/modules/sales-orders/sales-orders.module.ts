import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { SalesOrdersController } from './sales-orders.controller.js';
import { SalesOrdersService } from './sales-orders.service.js';

@Module({
  imports: [AuthModule, AuthorizationModule],
  controllers: [SalesOrdersController],
  providers: [SalesOrdersService],
})
export class SalesOrdersModule {}
