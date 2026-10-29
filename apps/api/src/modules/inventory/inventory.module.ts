import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { InventoryItemsController } from './inventory-items.controller.js';
import { InventoryItemsService } from './inventory-items.service.js';
import { InventoryStockService } from './inventory-stock.service.js';

@Module({
  imports: [DatabaseModule, AuthModule, AuthorizationModule],
  controllers: [InventoryItemsController],
  providers: [InventoryItemsService, InventoryStockService],
  exports: [InventoryItemsService, InventoryStockService],
})
export class InventoryModule {}
