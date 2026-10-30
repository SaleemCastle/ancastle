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

import type {
  InventoryItemListResponse,
  InventoryItemResponse,
} from '@ancastle/types';

import {
  createInventoryItemSchema,
  inventoryQuerySchema,
  resourceIdSchema,
  updateInventoryItemSchema,
  type CreateInventoryItemInput,
  type InventoryQuery,
  type UpdateInventoryItemInput,
} from '@ancastle/validation';

import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { AuthGuard } from '../auth/auth.guard.js';
import { AuthorizationGuard } from '../authorization/authorization.guard.js';
import { CurrentOrganization } from '../authorization/current-organization.decorator.js';
import { OrganizationContext } from '../authorization/organization-context.js';
import { Permission } from '../authorization/permissions.js';
import {
  OrganizationParam,
  RequirePermissions,
} from '../authorization/require-permissions.decorator.js';
import { InventoryItemsService } from './inventory-items.service.js';

@Controller('organizations/:organizationId/inventory-items')
@UseGuards(AuthGuard, AuthorizationGuard)
@OrganizationParam()
export class InventoryItemsController {
  constructor(private readonly inventoryItems: InventoryItemsService) {}

  @Get()
  @RequirePermissions(Permission.INVENTORY_READ)
  list(
    @CurrentOrganization() context: OrganizationContext,
    @Query(new ZodValidationPipe(inventoryQuerySchema))
    query: InventoryQuery,
  ): Promise<InventoryItemListResponse> {
    return this.inventoryItems.list(context, query);
  }

  @Post()
  @RequirePermissions(Permission.INVENTORY_ITEM_MANAGE)
  async create(
    @CurrentOrganization() context: OrganizationContext,
    @Body(new ZodValidationPipe(createInventoryItemSchema))
    input: CreateInventoryItemInput,
  ): Promise<InventoryItemResponse> {
    return {
      data: await this.inventoryItems.create(context, input),
    };
  }

  @Get(':inventoryItemId')
  @RequirePermissions(Permission.INVENTORY_READ)
  async get(
    @CurrentOrganization() context: OrganizationContext,
    @Param('inventoryItemId', new ZodValidationPipe(resourceIdSchema))
    id: string,
  ): Promise<InventoryItemResponse> {
    return {
      data: await this.inventoryItems.get(context, id),
    };
  }

  @Patch(':inventoryItemId')
  @RequirePermissions(Permission.INVENTORY_ITEM_MANAGE)
  async update(
    @CurrentOrganization() context: OrganizationContext,
    @Param('inventoryItemId', new ZodValidationPipe(resourceIdSchema))
    id: string,
    @Body(new ZodValidationPipe(updateInventoryItemSchema))
    input: UpdateInventoryItemInput,
  ): Promise<InventoryItemResponse> {
    return {
      data: await this.inventoryItems.update(context, id, input),
    };
  }

  @Post(':inventoryItemId/deactivate')
  @RequirePermissions(Permission.INVENTORY_LIFECYCLE_MANAGE)
  async deactivate(
    @CurrentOrganization() context: OrganizationContext,
    @Param('inventoryItemId', new ZodValidationPipe(resourceIdSchema))
    id: string,
  ): Promise<InventoryItemResponse> {
    return {
      data: await this.inventoryItems.deactivate(context, id),
    };
  }

  @Post(':inventoryItemId/reactivate')
  @RequirePermissions(Permission.INVENTORY_LIFECYCLE_MANAGE)
  async reactivate(
    @CurrentOrganization() context: OrganizationContext,
    @Param('inventoryItemId', new ZodValidationPipe(resourceIdSchema))
    id: string,
  ): Promise<InventoryItemResponse> {
    return {
      data: await this.inventoryItems.reactivate(context, id),
    };
  }
}
