import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import type { OrganizationResponse } from '@ancastle/types';
import {
  organizationProfileUpdateSchema,
  type OrganizationProfileUpdateInput,
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
import { OrganizationsService } from './organizations.service.js';

@Controller('organizations/:organizationId')
@UseGuards(AuthGuard, AuthorizationGuard)
@OrganizationParam()
export class OrganizationsController {
  constructor(private readonly organizations: OrganizationsService) {}

  @Get()
  @RequirePermissions(Permission.ORGANIZATION_READ)
  async get(
    @CurrentOrganization() context: OrganizationContext,
  ): Promise<OrganizationResponse> {
    return { data: await this.organizations.get(context) };
  }

  @Patch()
  @RequirePermissions(Permission.ORGANIZATION_UPDATE)
  async update(
    @CurrentOrganization() context: OrganizationContext,
    @Body(new ZodValidationPipe(organizationProfileUpdateSchema))
    input: OrganizationProfileUpdateInput,
  ): Promise<OrganizationResponse> {
    return { data: await this.organizations.update(context, input) };
  }
}
