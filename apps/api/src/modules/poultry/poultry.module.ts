import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module.js';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { InventoryModule } from '../inventory/inventory.module.js';
import { FeedUsageService } from './feed-usage.service.js';
import { FlockMetricsService } from './flock-metrics.service.js';
import { MortalityService } from './mortality.service.js';
import { AuthModule } from '../auth/auth.module.js';
import { FlocksController } from './flocks.controller.js';
import { FlocksService } from './flocks.service.js';

@Module({
  imports: [DatabaseModule, AuthModule, AuthorizationModule, InventoryModule],
  controllers: [FlocksController],
  providers: [
    FeedUsageService,
    FlockMetricsService,
    MortalityService,
    FlocksService,
  ],
  exports: [FeedUsageService, FlockMetricsService, MortalityService],
})
export class PoultryModule {}
