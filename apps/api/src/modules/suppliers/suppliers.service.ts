import { Injectable } from '@nestjs/common';
import type { Supplier, SupplierListResponse } from '@ancastle/types';
import type {
  CreateSupplierInput,
  MasterDataQuery,
  UpdateSupplierInput,
} from '@ancastle/validation';

import { BusinessException } from '../../common/exceptions/business.exception.js';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import type { OrganizationContext } from '../authorization/organization-context.js';

const supplierSelect = {
  id: true,
  code: true,
  name: true,
  contactPerson: true,
  phone: true,
  email: true,
  address: true,
  notes: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.SupplierSelect;

type SupplierRecord = Prisma.SupplierGetPayload<{
  select: typeof supplierSelect;
}>;

function details(record: SupplierRecord): Supplier {
  return {
    ...record,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

@Injectable()
export class SuppliersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    context: OrganizationContext,
    input: MasterDataQuery,
  ): Promise<SupplierListResponse> {
    const where: Prisma.SupplierWhereInput = {
      organizationId: context.organizationId,
      ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
      ...(input.search
        ? {
            OR: [
              {
                code: {
                  contains: input.search,
                  mode: 'insensitive',
                },
              },
              {
                name: {
                  contains: input.search,
                  mode: 'insensitive',
                },
              },
              {
                contactPerson: {
                  contains: input.search,
                  mode: 'insensitive',
                },
              },
              {
                email: {
                  contains: input.search,
                  mode: 'insensitive',
                },
              },
              {
                phone: {
                  contains: input.search,
                  mode: 'insensitive',
                },
              },
            ],
          }
        : {}),
    };

    const [records, totalItems] = await this.prisma.$transaction(
      [
        this.prisma.supplier.findMany({
          where,
          select: supplierSelect,
          skip: (input.page - 1) * input.pageSize,
          take: input.pageSize,
          orderBy: [{ code: 'asc' }, { id: 'asc' }],
        }),
        this.prisma.supplier.count({ where }),
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

  async get(context: OrganizationContext, id: string): Promise<Supplier> {
    const record = await this.prisma.supplier.findFirst({
      where: {
        id,
        organizationId: context.organizationId,
      },
      select: supplierSelect,
    });

    if (!record) {
      throw this.notFound();
    }

    return details(record);
  }

  async create(
    context: OrganizationContext,
    input: CreateSupplierInput,
  ): Promise<Supplier> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        // Supplier codes are sequential within an organization. Lock the
        // organization so concurrent creates allocate codes one at a time.
        await tx.$queryRaw(
          Prisma.sql`
            SELECT "id"
            FROM "organizations"
            WHERE "id" = ${context.organizationId}::uuid
            FOR UPDATE
          `,
        );

        const latest = await tx.supplier.findFirst({
          where: {
            organizationId: context.organizationId,
            code: {
              startsWith: 'SUP-',
            },
          },
          select: {
            code: true,
          },
          orderBy: {
            code: 'desc',
          },
        });

        const code = this.nextCode(latest?.code);

        const record = await tx.supplier.create({
          data: {
            organizationId: context.organizationId,
            code,
            name: input.name,
            contactPerson: input.contactPerson,
            phone: input.phone,
            email: input.email,
            address: input.address,
            notes: input.notes,
          },
          select: supplierSelect,
        });

        return details(record);
      });
    } catch (error) {
      this.rethrow(error);
    }
  }

  async update(
    context: OrganizationContext,
    id: string,
    input: UpdateSupplierInput,
  ): Promise<Supplier> {
    try {
      const [record] = await this.prisma.supplier.updateManyAndReturn({
        where: {
          id,
          organizationId: context.organizationId,
        },
        data: {
          name: input.name,
          contactPerson: input.contactPerson,
          phone: input.phone,
          email: input.email,
          address: input.address,
          notes: input.notes,
        },
        select: supplierSelect,
      });

      if (!record) {
        throw this.notFound();
      }

      return details(record);
    } catch (error) {
      this.rethrow(error);
    }
  }

  async deactivate(
    context: OrganizationContext,
    id: string,
  ): Promise<Supplier> {
    return this.setActive(context, id, false);
  }

  async reactivate(
    context: OrganizationContext,
    id: string,
  ): Promise<Supplier> {
    return this.setActive(context, id, true);
  }

  private async setActive(
    context: OrganizationContext,
    id: string,
    isActive: boolean,
  ): Promise<Supplier> {
    const [record] = await this.prisma.supplier.updateManyAndReturn({
      where: {
        id,
        organizationId: context.organizationId,
      },
      data: {
        isActive,
      },
      select: supplierSelect,
    });

    if (!record) {
      throw this.notFound();
    }

    return details(record);
  }

  private nextCode(previousCode?: string): string {
    if (!previousCode) {
      return 'SUP-000001';
    }

    const match = /^SUP-(\d{6})$/.exec(previousCode);

    if (!match) {
      throw new BusinessException(
        'SUPPLIER_CODE_GENERATION_FAILED',
        'Unable to generate the next supplier code',
        500,
      );
    }

    const current = Number(match[1]);
    const next = current + 1;

    if (next > 999999) {
      throw new BusinessException(
        'SUPPLIER_CODE_LIMIT_REACHED',
        'Supplier code limit has been reached',
        409,
      );
    }

    return `SUP-${String(next).padStart(6, '0')}`;
  }

  private notFound(): BusinessException {
    return new BusinessException(
      'SUPPLIER_NOT_FOUND',
      'Supplier was not found',
      404,
    );
  }

  private rethrow(error: unknown): never {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new BusinessException(
        'SUPPLIER_CODE_EXISTS',
        'A supplier with this code already exists in this organization',
        409,
      );
    }

    throw error;
  }
}
