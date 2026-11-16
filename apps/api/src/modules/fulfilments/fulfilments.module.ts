import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { InventoryModule } from '../inventory/inventory.module.js';
import { FulfilmentActivationService } from './fulfilment-activation.service.js';
import { FulfilmentsController } from './fulfilments.controller.js';
import { FulfilmentsService } from './fulfilments.service.js';

@Module({
  imports: [AuthModule, AuthorizationModule, InventoryModule],
  controllers: [FulfilmentsController],
  providers: [FulfilmentsService, FulfilmentActivationService],
})
export class FulfilmentsModule {}
