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

import type { SupplierListResponse, SupplierResponse } from '@ancastle/types';

import {
  createSupplierSchema,
  masterDataQuerySchema,
  resourceIdSchema,
  updateSupplierSchema,
  type CreateSupplierInput,
  type MasterDataQuery,
  type UpdateSupplierInput,
} from '@ancastle/validation';

import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { AuthGuard } from '../auth/auth.guard.js';
import { AuthorizationGuard } from '../authorization/authorization.guard.js';
import { CurrentOrganization } from '../authorization/current-organization.decorator.js';
import { OrganizationContext } from '../authorization/organization-context.js';
import {
  OrganizationParam,
  RequirePermissions,
} from '../authorization/require-permissions.decorator.js';
import { SuppliersService } from './suppliers.service.js';
import { Permission } from '../authorization/permissions.js';

@Controller('organizations/:organizationId/suppliers')
@UseGuards(AuthGuard, AuthorizationGuard)
@OrganizationParam()
export class SuppliersController {
  constructor(private readonly suppliers: SuppliersService) {}

  @Get()
  @RequirePermissions(Permission.SUPPLIER_READ)
  list(
    @CurrentOrganization() context: OrganizationContext,
    @Query(new ZodValidationPipe(masterDataQuerySchema))
    query: MasterDataQuery,
  ): Promise<SupplierListResponse> {
    return this.suppliers.list(context, query);
  }

  @Post()
  @RequirePermissions(Permission.SUPPLIER_CREATE)
  async create(
    @CurrentOrganization() context: OrganizationContext,
    @Body(new ZodValidationPipe(createSupplierSchema))
    input: CreateSupplierInput,
  ): Promise<SupplierResponse> {
    return {
      data: await this.suppliers.create(context, input),
    };
  }

  @Get(':supplierId')
  @RequirePermissions(Permission.SUPPLIER_READ)
  async get(
    @CurrentOrganization() context: OrganizationContext,
    @Param('supplierId', new ZodValidationPipe(resourceIdSchema))
    id: string,
  ): Promise<SupplierResponse> {
    return {
      data: await this.suppliers.get(context, id),
    };
  }

  @Patch(':supplierId')
  @RequirePermissions(Permission.SUPPLIER_UPDATE)
  async update(
    @CurrentOrganization() context: OrganizationContext,
    @Param('supplierId', new ZodValidationPipe(resourceIdSchema))
    id: string,
    @Body(new ZodValidationPipe(updateSupplierSchema))
    input: UpdateSupplierInput,
  ): Promise<SupplierResponse> {
    return {
      data: await this.suppliers.update(context, id, input),
    };
  }

  @Post(':supplierId/deactivate')
  @RequirePermissions(Permission.SUPPLIER_DEACTIVATE)
  async deactivate(
    @CurrentOrganization() context: OrganizationContext,
    @Param('supplierId', new ZodValidationPipe(resourceIdSchema))
    id: string,
  ): Promise<SupplierResponse> {
    return {
      data: await this.suppliers.deactivate(context, id),
    };
  }

  @Post(':supplierId/reactivate')
  @RequirePermissions(Permission.SUPPLIER_DEACTIVATE)
  async reactivate(
    @CurrentOrganization() context: OrganizationContext,
    @Param('supplierId', new ZodValidationPipe(resourceIdSchema))
    id: string,
  ): Promise<SupplierResponse> {
    return {
      data: await this.suppliers.reactivate(context, id),
    };
  }
}
