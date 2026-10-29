import { Injectable } from '@nestjs/common';

import { BusinessException } from '../../common/exceptions/business.exception.js';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import type { OrganizationContext } from '../authorization/organization-context.js';

export interface FarmStockItem {
  inventoryItemId: string;
  stockOnHand: Prisma.Decimal;
}

@Injectable()
export class InventoryStockService {
  constructor(private readonly prisma: PrismaService) {}

  async getStockOnHand(
    context: OrganizationContext,
    farmId: string,
    inventoryItemId: string,
  ): Promise<Prisma.Decimal> {
    await this.verifyOwnership(
      this.prisma,
      context.organizationId,
      farmId,
      inventoryItemId,
    );

    const result = await this.prisma.inventoryMovement.aggregate({
      where: {
        organizationId: context.organizationId,
        farmId,
        inventoryItemId,
      },
      _sum: {
        quantity: true,
      },
    });

    return result._sum.quantity ?? new Prisma.Decimal(0);
  }

  async listFarmStock(
    context: OrganizationContext,
    farmId: string,
  ): Promise<FarmStockItem[]> {
    await this.verifyFarm(this.prisma, context.organizationId, farmId);

    const items = await this.prisma.inventoryItem.findMany({
      where: {
        organizationId: context.organizationId,
      },
      select: {
        id: true,
      },
      orderBy: {
        code: 'asc',
      },
    });

    if (items.length === 0) {
      return [];
    }

    const balances = await this.prisma.inventoryMovement.groupBy({
      by: ['inventoryItemId'],
      where: {
        organizationId: context.organizationId,
        farmId,
      },
      _sum: {
        quantity: true,
      },
    });

    const balanceByItem = new Map(
      balances.map((balance) => [
        balance.inventoryItemId,
        balance._sum.quantity ?? new Prisma.Decimal(0),
      ]),
    );

    return items.map((item) => ({
      inventoryItemId: item.id,
      stockOnHand: balanceByItem.get(item.id) ?? new Prisma.Decimal(0),
    }));
  }

  async postMovement(
    context: OrganizationContext,
    input: {
      farmId: string;
      inventoryItemId: string;
      quantity: Prisma.Decimal;
      reason: 'RECEIPT' | 'ISSUE' | 'ADJUSTMENT';
      occurredAt: Date;
      note?: string;
      reference?: string;
    },
  ) {
    if (input.quantity.isZero()) {
      throw new BusinessException(
        'INVENTORY_MOVEMENT_ZERO_QUANTITY',
        'Inventory movement quantity must not be zero',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      await this.verifyOwnership(
        tx,
        context.organizationId,
        input.farmId,
        input.inventoryItemId,
      );

      // Serialize movement posting for this farm/item combination.
      //
      // PostgreSQL advisory transaction locks avoid maintaining a separate
      // mutable balance row purely for locking purposes.
      await tx.$executeRaw(
        Prisma.sql`
          SELECT pg_advisory_xact_lock(
            hashtext(${context.organizationId}),
            hashtext(${`${input.farmId}:${input.inventoryItemId}`})
          )
        `,
      );

      const balance = await tx.inventoryMovement.aggregate({
        where: {
          organizationId: context.organizationId,
          farmId: input.farmId,
          inventoryItemId: input.inventoryItemId,
        },
        _sum: {
          quantity: true,
        },
      });

      const currentStock = balance._sum.quantity ?? new Prisma.Decimal(0);

      const resultingStock = currentStock.add(input.quantity);

      if (resultingStock.isNegative()) {
        throw new BusinessException(
          'INSUFFICIENT_INVENTORY_STOCK',
          'Inventory movement would result in negative stock',
        );
      }

      return tx.inventoryMovement.create({
        data: {
          organizationId: context.organizationId,
          farmId: input.farmId,
          inventoryItemId: input.inventoryItemId,
          actorUserId: context.userId,
          quantity: input.quantity,
          reason: input.reason,
          occurredAt: input.occurredAt,
          note: input.note,
          reference: input.reference,
        },
      });
    });
  }

  private async verifyOwnership(
    prisma: Prisma.TransactionClient | PrismaService,
    organizationId: string,
    farmId: string,
    inventoryItemId: string,
  ): Promise<void> {
    const [farm, item] = await Promise.all([
      prisma.farm.findFirst({
        where: {
          id: farmId,
          organizationId,
        },
        select: {
          id: true,
        },
      }),
      prisma.inventoryItem.findFirst({
        where: {
          id: inventoryItemId,
          organizationId,
        },
        select: {
          id: true,
        },
      }),
    ]);

    if (!farm || !item) {
      throw new BusinessException(
        'INVENTORY_SCOPE_NOT_FOUND',
        'Inventory item or farm was not found',
      );
    }
  }

  private async verifyFarm(
    prisma: Prisma.TransactionClient | PrismaService,
    organizationId: string,
    farmId: string,
  ): Promise<void> {
    const farm = await prisma.farm.findFirst({
      where: {
        id: farmId,
        organizationId,
      },
      select: {
        id: true,
      },
    });

    if (!farm) {
      throw new BusinessException('FARM_NOT_FOUND', 'Farm was not found');
    }
  }
}
