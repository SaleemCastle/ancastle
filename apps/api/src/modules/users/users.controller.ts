import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import type {
  OrganizationMemberListResponse,
  OrganizationMemberResponse,
} from '@ancastle/types';
import {
  bootstrapOrganizationUserSchema,
  memberFarmAccessSchema,
  memberProfileUpdateSchema,
  membershipUpdateSchema,
  organizationMemberListQuerySchema,
  resourceIdSchema,
  type BootstrapOrganizationUserInput,
  type MemberFarmAccessInput,
  type MemberProfileUpdateInput,
  type MembershipUpdateInput,
  type OrganizationMemberListQuery,
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
import { UsersService } from './users.service.js';

@Controller('organizations/:organizationId/users')
@UseGuards(AuthGuard, AuthorizationGuard)
@OrganizationParam()
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @RequirePermissions(Permission.USER_READ)
  list(
    @CurrentOrganization() context: OrganizationContext,
    @Query(new ZodValidationPipe(organizationMemberListQuerySchema))
    query: OrganizationMemberListQuery,
  ): Promise<OrganizationMemberListResponse> {
    return this.users.list(context, query);
  }

  @Post()
  @RequirePermissions(Permission.USER_CREATE, Permission.MEMBERSHIP_MANAGE)
  async bootstrap(
    @CurrentOrganization() context: OrganizationContext,
    @Body(new ZodValidationPipe(bootstrapOrganizationUserSchema))
    input: BootstrapOrganizationUserInput,
  ): Promise<OrganizationMemberResponse> {
    return { data: await this.users.bootstrap(context, input) };
  }

  @Get(':userId')
  @RequirePermissions(Permission.USER_READ)
  async get(
    @CurrentOrganization() context: OrganizationContext,
    @Param('userId', new ZodValidationPipe(resourceIdSchema)) userId: string,
  ): Promise<OrganizationMemberResponse> {
    return { data: await this.users.get(context, userId) };
  }

  @Patch(':userId/profile')
  @RequirePermissions(Permission.USER_UPDATE)
  async profile(
    @CurrentOrganization() context: OrganizationContext,
    @Param('userId', new ZodValidationPipe(resourceIdSchema)) userId: string,
    @Body(new ZodValidationPipe(memberProfileUpdateSchema))
    input: MemberProfileUpdateInput,
  ): Promise<OrganizationMemberResponse> {
    return { data: await this.users.updateProfile(context, userId, input) };
  }

  @Patch(':userId/membership')
  @RequirePermissions(Permission.MEMBERSHIP_MANAGE)
  async membership(
    @CurrentOrganization() context: OrganizationContext,
    @Param('userId', new ZodValidationPipe(resourceIdSchema)) userId: string,
    @Body(new ZodValidationPipe(membershipUpdateSchema))
    input: MembershipUpdateInput,
  ): Promise<OrganizationMemberResponse> {
    return { data: await this.users.updateMembership(context, userId, input) };
  }

  @Put(':userId/farm-access')
  @RequirePermissions(Permission.MEMBERSHIP_MANAGE)
  async farmAccess(
    @CurrentOrganization() context: OrganizationContext,
    @Param('userId', new ZodValidationPipe(resourceIdSchema)) userId: string,
    @Body(new ZodValidationPipe(memberFarmAccessSchema))
    input: MemberFarmAccessInput,
  ): Promise<OrganizationMemberResponse> {
    return { data: await this.users.replaceFarmAccess(context, userId, input) };
  }
}
