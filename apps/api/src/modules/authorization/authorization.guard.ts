import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { z } from 'zod';
import { PrismaService } from '../../database/prisma.service.js';
import { AuthorizationService } from './authorization.service.js';
import {
  ORGANIZATION_PARAM_KEY,
  REQUIRED_PERMISSIONS_KEY,
} from './require-permissions.decorator.js';
import type { Permission } from './permissions.js';
import { BusinessException } from '../../common/exceptions/business.exception.js';
import {
  OrganizationContext,
  type OrganizationRequest,
} from './organization-context.js';

const organizationIdSchema = z.uuid();

@Injectable()
export class AuthorizationGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    private readonly authorizationService: AuthorizationService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<OrganizationRequest>();
    delete request.organizationContext;

    const requiredPermissions = this.reflector.getAllAndOverride<Permission[]>(
      REQUIRED_PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    const organizationParam = this.reflector.getAllAndOverride<string>(
      ORGANIZATION_PARAM_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!organizationParam && !requiredPermissions?.length) {
      return true;
    }

    if (!request.user) {
      throw this.forbidden();
    }

    // The route selects a membership to verify; it never establishes authority.
    const selectedOrganization = organizationIdSchema.safeParse(
      request.params?.[organizationParam ?? 'organizationId'],
    );
    if (!selectedOrganization.success) {
      throw this.forbidden();
    }

    const membership = await this.prisma.organizationMembership.findUnique({
      where: {
        organizationId_userId: {
          organizationId: selectedOrganization.data,
          userId: request.user.id,
        },
      },
      select: {
        id: true,
        organizationId: true,
        userId: true,
        role: true,
        isActive: true,
        organization: {
          select: {
            isActive: true,
          },
        },
      },
    });

    if (
      !membership ||
      !membership.isActive ||
      !membership.organization.isActive
    ) {
      throw this.forbidden();
    }

    if (
      !this.authorizationService.hasAllPermissions(
        membership.role,
        requiredPermissions ?? [],
      )
    ) {
      throw this.forbidden();
    }

    request.organizationContext = new OrganizationContext(
      membership.organizationId,
      membership.id,
      membership.userId,
      membership.role,
    );

    return true;
  }

  private forbidden(): BusinessException {
    return new BusinessException(
      'FORBIDDEN',
      'You do not have permission to perform this action',
      403,
    );
  }
}
