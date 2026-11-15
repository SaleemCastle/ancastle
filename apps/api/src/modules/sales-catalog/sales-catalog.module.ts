import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { SalesCatalogController } from './sales-catalog.controller.js';
import { PoultrySourcesController } from './poultry-sources.controller.js';
import { SalesCatalogService } from './sales-catalog.service.js';

@Module({
  imports: [AuthModule, AuthorizationModule],
  controllers: [SalesCatalogController, PoultrySourcesController],
  providers: [SalesCatalogService],
})
export class SalesCatalogModule {}
