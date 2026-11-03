import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module.js';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { InventoryModule } from '../inventory/inventory.module.js';
import { FeedUsageService } from './feed-usage.service.js';
import { FlockMetricsService } from './flock-metrics.service.js';
import { MortalityService } from './mortality.service.js';

@Module({
  imports: [DatabaseModule, AuthorizationModule, InventoryModule],
  providers: [FeedUsageService, FlockMetricsService, MortalityService],
  exports: [FeedUsageService, FlockMetricsService, MortalityService],
})
export class PoultryModule {}
