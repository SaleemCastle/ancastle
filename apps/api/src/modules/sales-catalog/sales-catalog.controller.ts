import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  createSalesProductSchema,
  updateSalesProductSchema,
  salesProductLifecycleSchema,
  salesProductQuerySchema,
  resourceIdSchema,
  type CreateSalesProductInput,
  type UpdateSalesProductInput,
  type SalesProductQuery,
} from '@ancastle/validation';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { AuthGuard } from '../auth/auth.guard.js';
import { AuthorizationGuard } from '../authorization/authorization.guard.js';
import { CurrentOrganization } from '../authorization/current-organization.decorator.js';
import type { OrganizationContext } from '../authorization/organization-context.js';
import {
  OrganizationParam,
  RequirePermissions,
} from '../authorization/require-permissions.decorator.js';
import { Permission } from '../authorization/permissions.js';
import { SalesCatalogService } from './sales-catalog.service.js';

@Controller('organizations/:organizationId/sales-products')
@UseGuards(AuthGuard, AuthorizationGuard)
@OrganizationParam()
export class SalesCatalogController {
  constructor(private readonly catalog: SalesCatalogService) {}
  @Get()
  @RequirePermissions(Permission.SALES_PRODUCT_READ)
  list(
    @CurrentOrganization() context: OrganizationContext,
    @Query(new ZodValidationPipe(salesProductQuerySchema))
    query: SalesProductQuery,
  ) {
    return this.catalog.listProducts(context, query);
  }
  @Get(':productId')
  @RequirePermissions(Permission.SALES_PRODUCT_READ)
  async get(
    @CurrentOrganization() context: OrganizationContext,
    @Param('productId', new ZodValidationPipe(resourceIdSchema)) id: string,
  ) {
    return { data: await this.catalog.getProduct(context, id) };
  }
  @Post()
  @RequirePermissions(Permission.SALES_PRODUCT_MANAGE)
  async create(
    @CurrentOrganization() context: OrganizationContext,
    @Body(new ZodValidationPipe(createSalesProductSchema))
    input: CreateSalesProductInput,
  ) {
    return { data: await this.catalog.createProduct(context, input) };
  }
  @Patch(':productId')
  @RequirePermissions(Permission.SALES_PRODUCT_MANAGE)
  async update(
    @CurrentOrganization() context: OrganizationContext,
    @Param('productId', new ZodValidationPipe(resourceIdSchema)) id: string,
    @Body(new ZodValidationPipe(updateSalesProductSchema))
    input: UpdateSalesProductInput,
  ) {
    return { data: await this.catalog.updateProduct(context, id, input) };
  }
  @Post(':productId/deactivate')
  @RequirePermissions(Permission.SALES_PRODUCT_MANAGE)
  async deactivate(
    @CurrentOrganization() context: OrganizationContext,
    @Param('productId', new ZodValidationPipe(resourceIdSchema)) id: string,
    @Body(new ZodValidationPipe(salesProductLifecycleSchema))
    _input: Record<string, never>,
  ) {
    return { data: await this.catalog.setProductActive(context, id, false) };
  }
  @Post(':productId/reactivate')
  @RequirePermissions(Permission.SALES_PRODUCT_MANAGE)
  async reactivate(
    @CurrentOrganization() context: OrganizationContext,
    @Param('productId', new ZodValidationPipe(resourceIdSchema)) id: string,
    @Body(new ZodValidationPipe(salesProductLifecycleSchema))
    _input: Record<string, never>,
  ) {
    return { data: await this.catalog.setProductActive(context, id, true) };
  }
}
