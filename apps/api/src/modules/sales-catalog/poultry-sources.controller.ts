import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  createPoultryProductSourceSchema,
  poultryProductSourceLifecycleSchema,
  poultryProductSourceQuerySchema,
  resourceIdSchema,
  type CreatePoultryProductSourceInput,
  type PoultryProductSourceQuery,
} from '@ancastle/validation';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { AuthGuard } from '../auth/auth.guard.js';
import { AuthorizationGuard } from '../authorization/authorization.guard.js';
import { FarmAccessGuard } from '../authorization/farm-access.guard.js';
import { CurrentOrganization } from '../authorization/current-organization.decorator.js';
import { CurrentFarm } from '../authorization/current-farm.decorator.js';
import type { OrganizationContext } from '../authorization/organization-context.js';
import type { FarmContext } from '../authorization/farm-context.js';
import { FarmParam } from '../authorization/farm-param.decorator.js';
import {
  OrganizationParam,
  RequirePermissions,
} from '../authorization/require-permissions.decorator.js';
import { Permission } from '../authorization/permissions.js';
import { SalesCatalogService } from './sales-catalog.service.js';

@Controller(
  'organizations/:organizationId/farms/:farmId/sales-products/:productId/poultry-sources',
)
@UseGuards(AuthGuard, AuthorizationGuard, FarmAccessGuard)
@OrganizationParam()
@FarmParam()
export class PoultrySourcesController {
  constructor(private readonly catalog: SalesCatalogService) {}
  @Get()
  @RequirePermissions(Permission.SALES_PRODUCT_READ, Permission.FLOCK_READ)
  list(
    @CurrentOrganization() context: OrganizationContext,
    @CurrentFarm() farm: FarmContext,
    @Param('productId', new ZodValidationPipe(resourceIdSchema))
    productId: string,
    @Query(new ZodValidationPipe(poultryProductSourceQuerySchema))
    query: PoultryProductSourceQuery,
  ) {
    return this.catalog.listSources(context, farm.farmId, productId, query);
  }
  @Post()
  @RequirePermissions(
    Permission.SALES_PRODUCT_SOURCE_MANAGE,
    Permission.FLOCK_READ,
  )
  async attach(
    @CurrentOrganization() context: OrganizationContext,
    @CurrentFarm() farm: FarmContext,
    @Param('productId', new ZodValidationPipe(resourceIdSchema))
    productId: string,
    @Body(new ZodValidationPipe(createPoultryProductSourceSchema))
    input: CreatePoultryProductSourceInput,
  ) {
    return {
      data: await this.catalog.attachSource(
        context,
        farm.farmId,
        productId,
        input.flockId,
      ),
    };
  }
  @Post(':sourceId/deactivate')
  @RequirePermissions(
    Permission.SALES_PRODUCT_SOURCE_MANAGE,
    Permission.FLOCK_READ,
  )
  async deactivate(
    @CurrentOrganization() context: OrganizationContext,
    @CurrentFarm() farm: FarmContext,
    @Param('productId', new ZodValidationPipe(resourceIdSchema))
    productId: string,
    @Param('sourceId', new ZodValidationPipe(resourceIdSchema)) id: string,
    @Body(new ZodValidationPipe(poultryProductSourceLifecycleSchema))
    _input: Record<string, never>,
  ) {
    return {
      data: await this.catalog.setSourceActive(
        context,
        farm.farmId,
        productId,
        id,
        false,
      ),
    };
  }
  @Post(':sourceId/reactivate')
  @RequirePermissions(
    Permission.SALES_PRODUCT_SOURCE_MANAGE,
    Permission.FLOCK_READ,
  )
  async reactivate(
    @CurrentOrganization() context: OrganizationContext,
    @CurrentFarm() farm: FarmContext,
    @Param('productId', new ZodValidationPipe(resourceIdSchema))
    productId: string,
    @Param('sourceId', new ZodValidationPipe(resourceIdSchema)) id: string,
    @Body(new ZodValidationPipe(poultryProductSourceLifecycleSchema))
    _input: Record<string, never>,
  ) {
    return {
      data: await this.catalog.setSourceActive(
        context,
        farm.farmId,
        productId,
        id,
        true,
      ),
    };
  }
}
