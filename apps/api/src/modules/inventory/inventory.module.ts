import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module.js';
import { InventoryStockService } from './inventory-stock.service.js';

@Module({
  imports: [DatabaseModule],
  providers: [InventoryStockService],
  exports: [InventoryStockService],
})
export class InventoryModule {}
