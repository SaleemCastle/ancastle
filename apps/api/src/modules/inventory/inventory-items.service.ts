import { Injectable } from '@nestjs/common';
import type { InventoryItem, InventoryItemListResponse } from '@ancastle/types';
import type {
  CreateInventoryItemInput,
  InventoryQuery,
  UpdateInventoryItemInput,
} from '@ancastle/validation';

import { BusinessException } from '../../common/exceptions/business.exception.js';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import type { OrganizationContext } from '../authorization/organization-context.js';

const inventoryItemSelect = {
  id: true,
  code: true,
  name: true,
  description: true,
  unit: true,
  category: true,
  lowStockThreshold: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.InventoryItemSelect;

type InventoryItemRecord = Prisma.InventoryItemGetPayload<{
  select: typeof inventoryItemSelect;
}>;

function details(record: InventoryItemRecord): InventoryItem {
  return {
    ...record,
    lowStockThreshold: record.lowStockThreshold?.toString() ?? null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

@Injectable()
export class InventoryItemsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    context: OrganizationContext,
    input: InventoryQuery,
  ): Promise<InventoryItemListResponse> {
    const where: Prisma.InventoryItemWhereInput = {
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
                description: {
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
        this.prisma.inventoryItem.findMany({
          where,
          select: inventoryItemSelect,
          skip: (input.page - 1) * input.pageSize,
          take: input.pageSize,
          orderBy: [{ code: 'asc' }, { id: 'asc' }],
        }),
        this.prisma.inventoryItem.count({ where }),
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

  async get(context: OrganizationContext, id: string): Promise<InventoryItem> {
    const record = await this.prisma.inventoryItem.findFirst({
      where: {
        id,
        organizationId: context.organizationId,
      },
      select: inventoryItemSelect,
    });

    if (!record) {
      throw this.notFound();
    }

    return details(record);
  }

  async create(
    context: OrganizationContext,
    input: CreateInventoryItemInput,
  ): Promise<InventoryItem> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        // Inventory item codes are sequential within an organization.
        // Lock the organization so concurrent creates allocate codes safely.
        await tx.$queryRaw(
          Prisma.sql`
            SELECT "id"
            FROM "organizations"
            WHERE "id" = ${context.organizationId}::uuid
            FOR UPDATE
          `,
        );

        const latest = await tx.inventoryItem.findFirst({
          where: {
            organizationId: context.organizationId,
            code: {
              startsWith: 'INV-',
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

        const record = await tx.inventoryItem.create({
          data: {
            organizationId: context.organizationId,
            code,
            name: input.name,
            description: input.description,
            unit: input.unit,
            category: input.category,
            lowStockThreshold: input.lowStockThreshold,
          },
          select: inventoryItemSelect,
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
    input: UpdateInventoryItemInput,
  ): Promise<InventoryItem> {
    try {
      const [record] = await this.prisma.inventoryItem.updateManyAndReturn({
        where: {
          id,
          organizationId: context.organizationId,
        },
        data: {
          name: input.name,
          description: input.description,
          unit: input.unit,
          category: input.category,
          lowStockThreshold: input.lowStockThreshold,
        },
        select: inventoryItemSelect,
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
  ): Promise<InventoryItem> {
    return this.setActive(context, id, false);
  }

  async reactivate(
    context: OrganizationContext,
    id: string,
  ): Promise<InventoryItem> {
    return this.setActive(context, id, true);
  }

  private async setActive(
    context: OrganizationContext,
    id: string,
    isActive: boolean,
  ): Promise<InventoryItem> {
    const [record] = await this.prisma.inventoryItem.updateManyAndReturn({
      where: {
        id,
        organizationId: context.organizationId,
      },
      data: {
        isActive,
      },
      select: inventoryItemSelect,
    });

    if (!record) {
      throw this.notFound();
    }

    return details(record);
  }

  private nextCode(previousCode?: string): string {
    if (!previousCode) {
      return 'INV-000001';
    }

    const match = /^INV-(\d{6})$/.exec(previousCode);

    if (!match) {
      throw new BusinessException(
        'INVENTORY_ITEM_CODE_GENERATION_FAILED',
        'Unable to generate the next inventory item code',
        500,
      );
    }

    const current = Number(match[1]);
    const next = current + 1;

    if (next > 999999) {
      throw new BusinessException(
        'INVENTORY_ITEM_CODE_LIMIT_REACHED',
        'Inventory item code limit has been reached',
        409,
      );
    }

    return `INV-${String(next).padStart(6, '0')}`;
  }

  private notFound(): BusinessException {
    return new BusinessException(
      'INVENTORY_ITEM_NOT_FOUND',
      'Inventory item was not found',
      404,
    );
  }

  private rethrow(error: unknown): never {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new BusinessException(
        'INVENTORY_ITEM_CODE_EXISTS',
        'An inventory item with this code already exists in this organization',
        409,
      );
    }

    throw error;
  }
}
