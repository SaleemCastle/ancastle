import { Injectable } from '@nestjs/common';
import type {
  OrganizationMember,
  OrganizationMemberListResponse,
} from '@ancastle/types';
import type {
  BootstrapOrganizationUserInput,
  MemberFarmAccessInput,
  MemberProfileUpdateInput,
  MembershipUpdateInput,
  OrganizationMemberListQuery,
} from '@ancastle/validation';
import { MembershipRole, Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { BusinessException } from '../../common/exceptions/business.exception.js';
import { PasswordService } from '../auth/password.service.js';
import { AuthorizationService } from '../authorization/authorization.service.js';
import type { OrganizationContext } from '../authorization/organization-context.js';
import {
  Permission,
  type Permission as PermissionType,
} from '../authorization/permissions.js';

const memberSelect = {
  id: true,
  organizationId: true,
  userId: true,
  displayName: true,
  role: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  user: { select: { email: true, isActive: true } },
  farmAccessAssignments: {
    where: { isActive: true },
    select: { farmId: true },
    orderBy: { farmId: 'asc' },
  },
} satisfies Prisma.OrganizationMembershipSelect;
type MemberRecord = Prisma.OrganizationMembershipGetPayload<{
  select: typeof memberSelect;
}>;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly authorization: AuthorizationService,
  ) {}

  private member(record: MemberRecord): OrganizationMember {
    return {
      membershipId: record.id,
      organizationId: record.organizationId,
      userId: record.userId,
      email: record.user.email,
      userIsActive: record.user.isActive,
      displayName: record.displayName,
      role: record.role,
      isActive: record.isActive,
      farmAccess: {
        allFarms: this.authorization.hasPermission(
          record.role,
          Permission.FARM_ACCESS_ALL,
        ),
        farmIds: record.farmAccessAssignments.map(
          (assignment) => assignment.farmId,
        ),
      },
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  }

  async list(
    context: OrganizationContext,
    query: OrganizationMemberListQuery,
  ): Promise<OrganizationMemberListResponse> {
    const where: Prisma.OrganizationMembershipWhereInput = context.scope(
      query.isActive === undefined ? {} : { isActive: query.isActive },
    );
    const [records, totalItems] = await this.prisma.$transaction(
      [
        this.prisma.organizationMembership.findMany({
          where,
          select: memberSelect,
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        this.prisma.organizationMembership.count({ where }),
      ],
      { isolationLevel: 'RepeatableRead' },
    );
    return {
      data: records.map((record) => this.member(record)),
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        totalItems,
        totalPages: Math.ceil(totalItems / query.pageSize),
      },
    };
  }

  async get(
    context: OrganizationContext,
    userId: string,
  ): Promise<OrganizationMember> {
    const record = await this.findMember(this.prisma, context, userId);
    return this.member(record);
  }

  async bootstrap(
    context: OrganizationContext,
    input: BootstrapOrganizationUserInput,
  ): Promise<OrganizationMember> {
    const passwordHash = await this.passwords.hash(input.password);
    try {
      return await this.mutate(
        context,
        [Permission.USER_CREATE, Permission.MEMBERSHIP_MANAGE],
        async (tx) => {
          await this.validateFarms(tx, context, input.farmIds);
          const user = await tx.user.create({
            data: { email: input.email, passwordHash },
            select: { id: true },
          });
          const record = await tx.organizationMembership.create({
            data: {
              organizationId: context.organizationId,
              userId: user.id,
              role: input.role,
              displayName: input.displayName,
              farmAccessAssignments: {
                create: input.farmIds.map((farmId) => ({ farmId })),
              },
            },
            select: memberSelect,
          });
          return this.member(record);
        },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new BusinessException(
          'USER_CREATION_CONFLICT',
          'User creation could not be completed',
          409,
        );
      }
      throw error;
    }
  }

  async updateProfile(
    context: OrganizationContext,
    userId: string,
    input: MemberProfileUpdateInput,
  ): Promise<OrganizationMember> {
    return this.mutate(context, [Permission.USER_UPDATE], async (tx) => {
      const result = await tx.organizationMembership.updateMany({
        where: context.scope({ userId }),
        data: { displayName: input.displayName },
      });
      if (!result.count) throw this.notFound();
      return this.member(await this.findMember(tx, context, userId));
    });
  }

  async updateMembership(
    context: OrganizationContext,
    userId: string,
    input: MembershipUpdateInput,
  ): Promise<OrganizationMember> {
    const required: PermissionType[] = [Permission.MEMBERSHIP_MANAGE];
    if (input.isActive !== undefined) required.push(Permission.USER_DEACTIVATE);
    return this.mutate(
      context,
      required,
      async (tx) => {
        const current = await this.findMember(tx, context, userId);
        const role = input.role ?? current.role;
        const isActive = input.isActive ?? current.isActive;
        const losingAdministration =
          current.isActive &&
          current.user.isActive &&
          this.authorization.hasPermission(
            current.role,
            Permission.MEMBERSHIP_MANAGE,
          ) &&
          (!isActive ||
            !this.authorization.hasPermission(
              role,
              Permission.MEMBERSHIP_MANAGE,
            ));
        if (losingAdministration) {
          const administrativeRoles = Object.values(MembershipRole).filter(
            (value) =>
              this.authorization.hasPermission(
                value,
                Permission.MEMBERSHIP_MANAGE,
              ),
          );
          const administrators = await tx.organizationMembership.count({
            where: {
              organizationId: context.organizationId,
              isActive: true,
              user: { isActive: true },
              role: { in: administrativeRoles },
            },
          });
          if (administrators <= 1)
            throw new BusinessException(
              'LAST_ADMINISTRATOR',
              'At least one active administrator must remain in the organization',
              409,
            );
        }
        const result = await tx.organizationMembership.updateMany({
          where: context.scope({ userId }),
          data: { role, isActive },
        });
        if (!result.count) throw this.notFound();
        return this.member(await this.findMember(tx, context, userId));
      },
      {
        lockOrganization: true,
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      },
    );
  }

  async replaceFarmAccess(
    context: OrganizationContext,
    userId: string,
    input: MemberFarmAccessInput,
  ): Promise<OrganizationMember> {
    return this.mutate(context, [Permission.MEMBERSHIP_MANAGE], async (tx) => {
      const current = await this.findMember(tx, context, userId);
      await this.validateFarms(tx, context, input.farmIds);
      await tx.farmAccessAssignment.updateMany({
        where: context.scope({ membershipId: current.id }),
        data: { isActive: false },
      });
      if (input.farmIds.length) {
        await tx.farmAccessAssignment.updateMany({
          where: context.scope({
            membershipId: current.id,
            farmId: { in: input.farmIds },
          }),
          data: { isActive: true },
        });
        await tx.farmAccessAssignment.createMany({
          data: input.farmIds.map((farmId) => ({
            organizationId: context.organizationId,
            membershipId: current.id,
            farmId,
          })),
          skipDuplicates: true,
        });
      }
      return this.member(await this.findMember(tx, context, userId));
    });
  }

  private async validateFarms(
    tx: Prisma.TransactionClient,
    context: OrganizationContext,
    farmIds: string[],
  ): Promise<void> {
    if (
      farmIds.length &&
      (await tx.farm.count({
        where: context.scope({ id: { in: farmIds } }),
      })) !== farmIds.length
    ) {
      throw new BusinessException(
        'INVALID_FARM_ACCESS',
        'Selected farms are not available in this organization',
        400,
      );
    }
  }

  private async findMember(
    tx: Prisma.TransactionClient,
    context: OrganizationContext,
    userId: string,
  ): Promise<MemberRecord> {
    const record = await tx.organizationMembership.findFirst({
      where: context.scope({ userId }),
      select: memberSelect,
    });
    if (!record) throw this.notFound();
    return record;
  }

  private async mutate<T>(
    context: OrganizationContext,
    permissions: PermissionType[],
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
    options: {
      lockOrganization?: boolean;
      isolationLevel?: Prisma.TransactionIsolationLevel;
    } = {},
  ): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.prisma.$transaction(
          async (tx) => {
            if (options.lockOrganization) {
              // Serialize administrator changes so the next request counts committed state.
              await tx.$queryRaw(
                Prisma.sql`SELECT "id" FROM "organizations" WHERE "id" = ${context.organizationId}::uuid FOR UPDATE`,
              );
            }
            const actor = await tx.organizationMembership.findFirst({
              where: context.scope({
                id: context.membershipId,
                userId: context.userId,
                role: context.role,
                isActive: true,
                user: { isActive: true },
                organization: { isActive: true },
              }),
              select: { role: true },
            });
            if (
              !actor ||
              !this.authorization.hasAllPermissions(actor.role, permissions)
            ) {
              throw new BusinessException(
                'FORBIDDEN',
                'You do not have permission to perform this action',
                403,
              );
            }
            return operation(tx);
          },
          { isolationLevel: options.isolationLevel ?? 'Serializable' },
        );
      } catch (error) {
        // The pinned PostgreSQL adapter may report commit conflicts directly,
        // before Prisma wraps them as P2034. Retry only that specific cause.
        const adapterConflict =
          error instanceof Error &&
          error.name === 'DriverAdapterError' &&
          typeof error.cause === 'object' &&
          error.cause !== null &&
          'kind' in error.cause &&
          error.cause.kind === 'TransactionWriteConflict';
        if (
          adapterConflict ||
          (error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === 'P2034')
        ) {
          if (attempt < 2) continue;
          throw new BusinessException(
            'CONCURRENT_UPDATE',
            'The data changed during this request; please retry',
            409,
          );
        }
        throw error;
      }
    }
  }

  private notFound(): BusinessException {
    return new BusinessException(
      'ORGANIZATION_USER_NOT_FOUND',
      'Organization user was not found',
      404,
    );
  }
}
