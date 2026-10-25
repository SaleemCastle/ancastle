import { Injectable } from '@nestjs/common';
import type { ApplicationContextResponse } from '@ancastle/types';
import { PrismaService } from '../../database/prisma.service.js';
import { FarmAccessService } from '../authorization/farm-access.service.js';
import { AuthorizationService } from '../authorization/authorization.service.js';
import { OrganizationContext } from '../authorization/organization-context.js';
import { Permission } from '../authorization/permissions.js';

@Injectable()
export class ApplicationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: FarmAccessService,
    private readonly authorization: AuthorizationService,
  ) {}

  async context(
    userId: string,
    query: { page: number; pageSize: number },
  ): Promise<ApplicationContextResponse> {
    // Cross-organization discovery is limited to this authenticated identity's own active memberships.
    const where = {
      userId,
      isActive: true,
      user: { isActive: true },
      organization: { isActive: true },
    };
    const [memberships, totalItems] = await this.prisma.$transaction(
      [
        this.prisma.organizationMembership.findMany({
          where,
          select: {
            id: true,
            userId: true,
            organizationId: true,
            role: true,
            displayName: true,
            organization: { select: { id: true, name: true, slug: true } },
          },
          orderBy: [{ organization: { name: 'asc' } }, { id: 'asc' }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        this.prisma.organizationMembership.count({ where }),
      ],
      { isolationLevel: 'RepeatableRead' },
    );
    const data = await Promise.all(
      memberships.map(async (membership) => {
        const context = new OrganizationContext(
          membership.organizationId,
          membership.id,
          membership.userId,
          membership.role,
        );
        return {
          organization: membership.organization,
          membership: {
            displayName: membership.displayName,
            role: membership.role,
          },
          permissions: Object.values(Permission).filter((permission) =>
            this.authorization.hasPermission(context.role, permission),
          ),
          farms: await this.prisma.farm.findMany({
            where: this.access.farmWhere(context),
            select: { id: true, name: true, code: true },
            orderBy: [{ code: 'asc' }, { id: 'asc' }],
          }),
        };
      }),
    );
    return {
      data,
      meta: {
        ...query,
        totalItems,
        totalPages: Math.ceil(totalItems / query.pageSize),
      },
    };
  }
}
