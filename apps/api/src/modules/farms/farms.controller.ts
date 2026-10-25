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
import type { FarmListResponse, FarmResponse } from '@ancastle/types';
import {
  createFarmSchema,
  farmListQuerySchema,
  resourceIdSchema,
  updateFarmSchema,
  type CreateFarmInput,
  type FarmListQuery,
  type UpdateFarmInput,
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
import { FarmsService } from './farms.service.js';

@Controller('organizations/:organizationId/farms')
@UseGuards(AuthGuard, AuthorizationGuard)
@OrganizationParam()
export class FarmsController {
  constructor(private readonly farms: FarmsService) {}

  @Get()
  @RequirePermissions(Permission.FARM_READ)
  list(
    @CurrentOrganization() context: OrganizationContext,
    @Query(new ZodValidationPipe(farmListQuerySchema)) query: FarmListQuery,
  ): Promise<FarmListResponse> {
    return this.farms.list(context, query);
  }

  @Post()
  @RequirePermissions(Permission.FARM_CREATE)
  async create(
    @CurrentOrganization() context: OrganizationContext,
    @Body(new ZodValidationPipe(createFarmSchema)) input: CreateFarmInput,
  ): Promise<FarmResponse> {
    return { data: await this.farms.create(context, input) };
  }

  @Get(':farmId')
  @RequirePermissions(Permission.FARM_READ)
  async get(
    @CurrentOrganization() context: OrganizationContext,
    @Param('farmId', new ZodValidationPipe(resourceIdSchema)) id: string,
  ): Promise<FarmResponse> {
    return { data: await this.farms.get(context, id) };
  }

  @Patch(':farmId')
  @RequirePermissions(Permission.FARM_UPDATE)
  async update(
    @CurrentOrganization() context: OrganizationContext,
    @Param('farmId', new ZodValidationPipe(resourceIdSchema)) id: string,
    @Body(new ZodValidationPipe(updateFarmSchema)) input: UpdateFarmInput,
  ): Promise<FarmResponse> {
    return { data: await this.farms.update(context, id, input) };
  }
}
