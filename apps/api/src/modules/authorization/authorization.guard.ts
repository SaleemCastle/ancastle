import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { PrismaService } from '../../database/prisma.service.js';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { AuthorizationService } from './authorization.service.js';
import {
  ORGANIZATION_PARAM_KEY,
  REQUIRED_PERMISSIONS_KEY,
} from './require-permissions.decorator.js';
import type { Permission } from './permissions.js';
import { BusinessException } from '../../common/exceptions/business.exception.js';

type AuthorizedRequest = Request & {
  user?: AuthenticatedUser;
};

@Injectable()
export class AuthorizationGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    private readonly authorizationService: AuthorizationService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredPermissions = this.reflector.getAllAndOverride<Permission[]>(
      REQUIRED_PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredPermissions || requiredPermissions.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthorizedRequest>();

    if (!request.user) {
      throw this.forbidden();
    }

    const organizationParam =
      this.reflector.getAllAndOverride<string>(ORGANIZATION_PARAM_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? 'organizationId';

    const rawOrganizationId = request.params?.[organizationParam];

    if (!rawOrganizationId || typeof rawOrganizationId !== 'string') {
      throw this.forbidden();
    }
    const organizationId = rawOrganizationId;

    if (!organizationId) {
      throw this.forbidden();
    }

    const membership = await this.prisma.organizationMembership.findUnique({
      where: {
        organizationId_userId: {
          organizationId,
          userId: request.user.id,
        },
      },
      include: {
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
        requiredPermissions,
      )
    ) {
      throw this.forbidden();
    }

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
