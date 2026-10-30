import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { FarmInventoryController } from './farm-inventory.controller.js';
import { FarmInventoryService } from './farm-inventory.service.js';
import { InventoryItemsController } from './inventory-items.controller.js';
import { InventoryItemsService } from './inventory-items.service.js';
import { InventoryStockService } from './inventory-stock.service.js';

@Module({
  imports: [DatabaseModule, AuthModule, AuthorizationModule],
  controllers: [InventoryItemsController, FarmInventoryController],
  providers: [
    InventoryItemsService,
    InventoryStockService,
    FarmInventoryService,
  ],
  exports: [InventoryItemsService, InventoryStockService, FarmInventoryService],
})
export class InventoryModule {}
