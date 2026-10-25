import { Injectable } from '@nestjs/common';
import type { FarmDetails, FarmListResponse } from '@ancastle/types';
import type {
  CreateFarmInput,
  FarmListQuery,
  UpdateFarmInput,
} from '@ancastle/validation';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { BusinessException } from '../../common/exceptions/business.exception.js';
import { FarmAccessService } from '../authorization/farm-access.service.js';
import type { OrganizationContext } from '../authorization/organization-context.js';

const farmSelect = {
  id: true,
  organizationId: true,
  name: true,
  code: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.FarmSelect;

type FarmRecord = Prisma.FarmGetPayload<{ select: typeof farmSelect }>;

function details(record: FarmRecord): FarmDetails {
  return {
    ...record,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

@Injectable()
export class FarmsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: FarmAccessService,
  ) {}

  async list(
    context: OrganizationContext,
    input: FarmListQuery,
  ): Promise<FarmListResponse> {
    const where: Prisma.FarmWhereInput = {
      AND: [
        this.access.farmWhere(context, { includeInactive: true }),
        input.isActive === undefined ? {} : { isActive: input.isActive },
      ],
    };
    const [records, totalItems] = await this.prisma.$transaction(
      [
        this.prisma.farm.findMany({
          where,
          select: farmSelect,
          skip: (input.page - 1) * input.pageSize,
          take: input.pageSize,
          orderBy: [{ code: 'asc' }, { id: 'asc' }],
        }),
        this.prisma.farm.count({ where }),
      ],
      { isolationLevel: 'RepeatableRead' },
    );
    return {
      data: records.map(details),
      meta: {
        page: input.page,
        pageSize: input.pageSize,
        totalItems,
        totalPages: Math.ceil(totalItems / input.pageSize),
      },
    };
  }

  async get(context: OrganizationContext, id: string): Promise<FarmDetails> {
    const record = await this.prisma.farm.findFirst({
      where: {
        AND: [
          this.access.farmWhere(context, { includeInactive: true }),
          { id },
        ],
      },
      select: farmSelect,
    });
    if (!record) throw this.notFound();
    return details(record);
  }

  async create(
    context: OrganizationContext,
    input: CreateFarmInput,
  ): Promise<FarmDetails> {
    try {
      return details(
        await this.prisma.farm.create({
          data: {
            organizationId: context.organizationId,
            name: input.name,
            code: input.code,
          },
          select: farmSelect,
        }),
      );
    } catch (error) {
      this.rethrow(error);
    }
  }

  async update(
    context: OrganizationContext,
    id: string,
    input: UpdateFarmInput,
  ): Promise<FarmDetails> {
    try {
      const [record] = await this.prisma.farm.updateManyAndReturn({
        where: {
          AND: [
            this.access.farmWhere(context, { includeInactive: true }),
            { id },
          ],
        },
        data: { name: input.name, code: input.code, isActive: input.isActive },
        select: farmSelect,
      });
      if (!record) throw this.notFound();
      return details(record);
    } catch (error) {
      this.rethrow(error);
    }
  }

  private notFound(): BusinessException {
    return new BusinessException('FARM_NOT_FOUND', 'Farm was not found', 404);
  }

  private rethrow(error: unknown): never {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new BusinessException(
        'FARM_CODE_EXISTS',
        'A farm with this code already exists in this organization',
        409,
      );
    }
    throw error;
  }
}
