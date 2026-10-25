import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../../database/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { BusinessException } from '../../common/exceptions/business.exception.js';
import { AuthorizationService } from './authorization.service.js';
import { FarmContext } from './farm-context.js';
import type { OrganizationContext } from './organization-context.js';
import { Permission } from './permissions.js';

const farmIdSchema = z.uuid();

@Injectable()
export class FarmAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorization: AuthorizationService,
  ) {}

  /** Requires the fresh OrganizationContext verified by AuthorizationGuard. */
  farmWhere(
    context: OrganizationContext,
    options: { includeInactive?: boolean } = {},
  ): Prisma.FarmWhereInput {
    const where: Prisma.FarmWhereInput = {
      isActive:
        options.includeInactive &&
        this.authorization.hasPermission(context.role, Permission.FARM_UPDATE)
          ? undefined
          : true,
      organization: {
        isActive: true,
        organizationMemberships: {
          some: {
            id: context.membershipId,
            userId: context.userId,
            role: context.role,
            isActive: true,
            user: { isActive: true },
          },
        },
      },
    };

    if (
      !this.authorization.hasPermission(
        context.role,
        Permission.FARM_ACCESS_ALL,
      )
    ) {
      where.accessAssignments = {
        some: {
          organizationId: context.organizationId,
          membershipId: context.membershipId,
          isActive: true,
        },
      };
    }

    return context.scope(where);
  }

  async resolve(
    context: OrganizationContext,
    selectedFarmId: unknown,
  ): Promise<FarmContext> {
    const farmId = farmIdSchema.safeParse(selectedFarmId);
    if (!farmId.success) throw this.forbidden();

    const farm = await this.prisma.farm.findFirst({
      where: { AND: [this.farmWhere(context), { id: farmId.data }] },
      select: { id: true, organizationId: true },
    });
    if (!farm) throw this.forbidden();

    return new FarmContext(farm.organizationId, farm.id);
  }

  private forbidden(): BusinessException {
    return new BusinessException(
      'FORBIDDEN',
      'You do not have permission to perform this action',
      403,
    );
  }
}
