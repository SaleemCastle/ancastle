import { Injectable } from '@nestjs/common';
import type {
  FarmInventoryResponse,
  InventoryMovement,
  InventoryMovementListResponse,
  InventoryStockStatus,
} from '@ancastle/types';
import type { InventoryMovementQuery } from '@ancastle/validation';

import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import type { OrganizationContext } from '../authorization/organization-context.js';
import { InventoryStockService } from './inventory-stock.service.js';

const movementSelect = {
  id: true,
  farmId: true,
  inventoryItemId: true,
  actorUserId: true,
  quantity: true,
  reason: true,
  occurredAt: true,
  note: true,
  reference: true,
  createdAt: true,
} satisfies Prisma.InventoryMovementSelect;

type MovementRecord = Prisma.InventoryMovementGetPayload<{
  select: typeof movementSelect;
}>;

function movementDetails(record: MovementRecord): InventoryMovement {
  return {
    ...record,
    quantity: record.quantity.toString(),
    occurredAt: record.occurredAt.toISOString(),
    createdAt: record.createdAt.toISOString(),
  };
}

function inventoryStockStatus(
  stockOnHand: Prisma.Decimal,
  lowStockThreshold: Prisma.Decimal | null,
): InventoryStockStatus {
  if (stockOnHand.isZero()) {
    return 'OUT_OF_STOCK';
  }

  if (lowStockThreshold === null) {
    return 'UNMONITORED';
  }

  if (stockOnHand.lessThanOrEqualTo(lowStockThreshold)) {
    return 'LOW';
  }

  return 'HEALTHY';
}

@Injectable()
export class FarmInventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stock: InventoryStockService,
  ) {}

  async listStock(
    context: OrganizationContext,
    farmId: string,
  ): Promise<FarmInventoryResponse> {
    const [items, balances] = await Promise.all([
      this.prisma.inventoryItem.findMany({
        where: {
          organizationId: context.organizationId,
        },
        select: {
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
        },
        orderBy: [{ code: 'asc' }, { id: 'asc' }],
      }),
      this.stock.listFarmStock(context, farmId),
    ]);

    const balanceByItem = new Map(
      balances.map((balance) => [balance.inventoryItemId, balance.stockOnHand]),
    );

    return {
      data: items.map((item) => {
        const stockOnHand = balanceByItem.get(item.id) ?? new Prisma.Decimal(0);

        return {
          item: {
            ...item,
            lowStockThreshold: item.lowStockThreshold?.toString() ?? null,
            createdAt: item.createdAt.toISOString(),
            updatedAt: item.updatedAt.toISOString(),
          },
          stockOnHand: stockOnHand.toString(),
          stockStatus: inventoryStockStatus(
            stockOnHand,
            item.lowStockThreshold,
          ),
        };
      }),
    };
  }

  async listMovements(
    context: OrganizationContext,
    farmId: string,
    input: InventoryMovementQuery,
  ): Promise<InventoryMovementListResponse> {
    // This verifies that the farm belongs to the active organization.
    // User-to-farm authorization is enforced separately by FarmAccessGuard.
    await this.stock.listFarmStock(context, farmId);

    const where: Prisma.InventoryMovementWhereInput = {
      organizationId: context.organizationId,
      farmId,
      ...(input.inventoryItemId
        ? { inventoryItemId: input.inventoryItemId }
        : {}),
      ...(input.reason ? { reason: input.reason } : {}),
    };

    const [records, totalItems] = await this.prisma.$transaction(
      [
        this.prisma.inventoryMovement.findMany({
          where,
          select: movementSelect,
          skip: (input.page - 1) * input.pageSize,
          take: input.pageSize,
          orderBy: [
            { occurredAt: 'desc' },
            { createdAt: 'desc' },
            { id: 'desc' },
          ],
        }),
        this.prisma.inventoryMovement.count({ where }),
      ],
      { isolationLevel: 'RepeatableRead' },
    );

    return {
      data: records.map(movementDetails),
      meta: {
        page: input.page,
        pageSize: input.pageSize,
        totalItems,
        totalPages: Math.ceil(totalItems / input.pageSize),
      },
    };
  }
}
