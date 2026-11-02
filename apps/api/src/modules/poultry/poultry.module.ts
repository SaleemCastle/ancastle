import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module.js';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { InventoryModule } from '../inventory/inventory.module.js';
import { FeedUsageService } from './feed-usage.service.js';

@Module({
  imports: [DatabaseModule, AuthorizationModule, InventoryModule],
  providers: [FeedUsageService],
  exports: [FeedUsageService],
})
export class PoultryModule {}
