import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';

import type {
  FarmInventoryResponse,
  InventoryMovementListResponse,
  InventoryMovementResponse,
} from '@ancastle/types';

import { Prisma } from '../../generated/prisma/client.js';

import {
  createInventoryMovementSchema,
  inventoryMovementQuerySchema,
  type CreateInventoryMovementInput,
  type InventoryMovementQuery,
} from '@ancastle/validation';

import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { AuthGuard } from '../auth/auth.guard.js';
import { AuthorizationGuard } from '../authorization/authorization.guard.js';
import { CurrentFarm } from '../authorization/current-farm.decorator.js';
import { CurrentOrganization } from '../authorization/current-organization.decorator.js';
import { FarmAccessGuard } from '../authorization/farm-access.guard.js';
import type { FarmContext } from '../authorization/farm-context.js';
import { FarmParam } from '../authorization/farm-param.decorator.js';
import type { OrganizationContext } from '../authorization/organization-context.js';
import { Permission } from '../authorization/permissions.js';
import {
  OrganizationParam,
  RequirePermissions,
} from '../authorization/require-permissions.decorator.js';
import { FarmInventoryService } from './farm-inventory.service.js';
import { InventoryStockService } from './inventory-stock.service.js';

@Controller('organizations/:organizationId/farms/:farmId/inventory')
@UseGuards(AuthGuard, AuthorizationGuard, FarmAccessGuard)
@OrganizationParam()
@FarmParam()
export class FarmInventoryController {
  constructor(
    private readonly farmInventory: FarmInventoryService,
    private readonly stock: InventoryStockService,
  ) {}

  @Get()
  @RequirePermissions(Permission.INVENTORY_READ)
  listStock(
    @CurrentOrganization() context: OrganizationContext,
    @CurrentFarm() farm: FarmContext,
  ): Promise<FarmInventoryResponse> {
    return this.farmInventory.listStock(context, farm.farmId);
  }

  @Get('movements')
  @RequirePermissions(Permission.INVENTORY_READ)
  listMovements(
    @CurrentOrganization() context: OrganizationContext,
    @CurrentFarm() farm: FarmContext,
    @Query(new ZodValidationPipe(inventoryMovementQuerySchema))
    query: InventoryMovementQuery,
  ): Promise<InventoryMovementListResponse> {
    return this.farmInventory.listMovements(context, farm.farmId, query);
  }

  @Post('movements')
  @RequirePermissions(Permission.INVENTORY_MOVEMENT_POST)
  async postMovement(
    @CurrentOrganization() context: OrganizationContext,
    @CurrentFarm() farm: FarmContext,
    @Body(new ZodValidationPipe(createInventoryMovementSchema))
    input: CreateInventoryMovementInput,
  ): Promise<InventoryMovementResponse> {
    const movement = await this.stock.postMovement(context, {
      farmId: farm.farmId,
      inventoryItemId: input.inventoryItemId,
      quantity: new Prisma.Decimal(input.quantity),
      reason: input.reason,
      occurredAt: input.occurredAt,
      note: input.note,
      reference: input.reference,
    });

    return {
      data: {
        id: movement.id,
        farmId: movement.farmId,
        inventoryItemId: movement.inventoryItemId,
        actorUserId: movement.actorUserId,
        quantity: movement.quantity.toString(),
        reason: movement.reason,
        occurredAt: movement.occurredAt.toISOString(),
        note: movement.note,
        reference: movement.reference,
        createdAt: movement.createdAt.toISOString(),
      },
    };
  }
}
