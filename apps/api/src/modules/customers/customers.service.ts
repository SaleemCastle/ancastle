import { Injectable } from '@nestjs/common';
import type { Customer, CustomerListResponse } from '@ancastle/types';
import type {
  CreateCustomerInput,
  MasterDataQuery,
  UpdateCustomerInput,
} from '@ancastle/validation';

import { BusinessException } from '../../common/exceptions/business.exception.js';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import type { OrganizationContext } from '../authorization/organization-context.js';

const customerSelect = {
  id: true,
  code: true,
  type: true,
  name: true,
  contactPerson: true,
  phone: true,
  email: true,
  address: true,
  notes: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.CustomerSelect;

type CustomerRecord = Prisma.CustomerGetPayload<{
  select: typeof customerSelect;
}>;

function details(record: CustomerRecord): Customer {
  return {
    ...record,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    context: OrganizationContext,
    input: MasterDataQuery,
  ): Promise<CustomerListResponse> {
    const where: Prisma.CustomerWhereInput = {
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
        this.prisma.customer.findMany({
          where,
          select: customerSelect,
          skip: (input.page - 1) * input.pageSize,
          take: input.pageSize,
          orderBy: [{ code: 'asc' }, { id: 'asc' }],
        }),
        this.prisma.customer.count({ where }),
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

  async get(context: OrganizationContext, id: string): Promise<Customer> {
    const record = await this.prisma.customer.findFirst({
      where: {
        id,
        organizationId: context.organizationId,
      },
      select: customerSelect,
    });

    if (!record) {
      throw this.notFound();
    }

    return details(record);
  }

  async create(
    context: OrganizationContext,
    input: CreateCustomerInput,
  ): Promise<Customer> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        // Customer codes are sequential within an organization. Lock the
        // organization so concurrent creates allocate codes one at a time.
        await tx.$queryRaw(
          Prisma.sql`
          SELECT "id"
          FROM "organizations"
          WHERE "id" = ${context.organizationId}::uuid
          FOR UPDATE
        `,
        );

        const latest = await tx.customer.findFirst({
          where: {
            organizationId: context.organizationId,
            code: {
              startsWith: 'CUS-',
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

        const record = await tx.customer.create({
          data: {
            organizationId: context.organizationId,
            code,
            type: input.type,
            name: input.name,
            contactPerson: input.contactPerson,
            phone: input.phone,
            email: input.email,
            address: input.address,
            notes: input.notes,
          },
          select: customerSelect,
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
    input: UpdateCustomerInput,
  ): Promise<Customer> {
    try {
      const [record] = await this.prisma.customer.updateManyAndReturn({
        where: {
          id,
          organizationId: context.organizationId,
        },
        data: {
          type: input.type,
          name: input.name,
          contactPerson: input.contactPerson,
          phone: input.phone,
          email: input.email,
          address: input.address,
          notes: input.notes,
        },
        select: customerSelect,
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
  ): Promise<Customer> {
    return this.setActive(context, id, false);
  }

  async reactivate(
    context: OrganizationContext,
    id: string,
  ): Promise<Customer> {
    return this.setActive(context, id, true);
  }

  private async setActive(
    context: OrganizationContext,
    id: string,
    isActive: boolean,
  ): Promise<Customer> {
    const [record] = await this.prisma.customer.updateManyAndReturn({
      where: {
        id,
        organizationId: context.organizationId,
      },
      data: {
        isActive,
      },
      select: customerSelect,
    });

    if (!record) {
      throw this.notFound();
    }

    return details(record);
  }

  private nextCode(previousCode?: string): string {
    if (!previousCode) {
      return 'CUS-000001';
    }

    const match = /^CUS-(\d{6})$/.exec(previousCode);

    if (!match) {
      throw new BusinessException(
        'CUSTOMER_CODE_GENERATION_FAILED',
        'Unable to generate the next customer code',
        500,
      );
    }

    const current = Number(match[1]);
    const next = current + 1;

    if (next > 999999) {
      throw new BusinessException(
        'CUSTOMER_CODE_LIMIT_REACHED',
        'Customer code limit has been reached',
        409,
      );
    }

    return `CUS-${String(next).padStart(6, '0')}`;
  }

  private notFound(): BusinessException {
    return new BusinessException(
      'CUSTOMER_NOT_FOUND',
      'Customer was not found',
      404,
    );
  }

  private rethrow(error: unknown): never {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new BusinessException(
        'CUSTOMER_CODE_EXISTS',
        'A customer with this code already exists in this organization',
        409,
      );
    }

    throw error;
  }

  private isTransactionWriteConflict(error: unknown): boolean {
    const adapterConflict =
      error instanceof Error &&
      error.name === 'DriverAdapterError' &&
      typeof error.cause === 'object' &&
      error.cause !== null &&
      'kind' in error.cause &&
      error.cause.kind === 'TransactionWriteConflict';

    return (
      adapterConflict ||
      (error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2034')
    );
  }
}
