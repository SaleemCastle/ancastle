import { Injectable } from '@nestjs/common';

import { BusinessException } from '../../common/exceptions/business.exception.js';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { FarmAccessService } from '../authorization/farm-access.service.js';
import type { OrganizationContext } from '../authorization/organization-context.js';
import { InventoryStockService } from '../inventory/inventory-stock.service.js';

// Internal domain input, not a public API contract. Ownership/actor come from
// verified context; generated movement IDs never come from a request payload.
export interface PostFeedUsageInput {
  flockId: string;
  inventoryItemId: string;
  quantity: Prisma.Decimal;
  occurredAt: Date;
  note?: string;
  reference?: string;
}

@Injectable()
export class FeedUsageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stock: InventoryStockService,
    private readonly farms: FarmAccessService,
  ) {}

  async post(
    context: OrganizationContext,
    farmId: string,
    input: PostFeedUsageInput,
  ) {
    this.validateQuantity(input.quantity);
    return this.prisma.$transaction(
      async (tx) => {
        await this.verifyFarm(tx, context, farmId);
        const flock = await tx.flock.findFirst({
          where: {
            id: input.flockId,
            organizationId: context.organizationId,
            farmId,
            isActive: true,
          },
          select: { id: true },
        });
        const item = await tx.inventoryItem.findFirst({
          where: {
            id: input.inventoryItemId,
            organizationId: context.organizationId,
            category: 'FEED',
            isActive: true,
          },
          select: { id: true },
        });
        if (!flock || !item) throw this.scopeNotFound();

        const movement = await this.stock.postMovementInTransaction(
          tx,
          context,
          {
            farmId,
            inventoryItemId: input.inventoryItemId,
            quantity: input.quantity.negated(),
            reason: 'ISSUE',
            occurredAt: input.occurredAt,
            note: input.note,
            reference: input.reference,
          },
        );
        return tx.feedUsage.create({
          data: {
            organizationId: context.organizationId,
            farmId,
            flockId: flock.id,
            inventoryItemId: item.id,
            actorUserId: context.userId,
            inventoryMovementId: movement.id,
            quantity: input.quantity,
            occurredAt: input.occurredAt,
            note: input.note,
            reference: input.reference,
          },
        });
      },
      { isolationLevel: 'ReadCommitted' },
    );
  }

  /** Cancel an erroneous posting in full. To correct it, append a new ordinary
   * usage afterward. Originals, reversals and both inventory entries remain.
   * A reversal is allowed for an inactive flock/item so history can be repaired.
   */
  async reverse(
    context: OrganizationContext,
    farmId: string,
    usageId: string,
    input: { occurredAt: Date; note?: string; reference?: string },
  ) {
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          await this.verifyFarm(tx, context, farmId);
          const original = await tx.feedUsage.findFirst({
            where: {
              id: usageId,
              organizationId: context.organizationId,
              farmId,
              reversesUsageId: null,
            },
          });
          if (!original) throw this.scopeNotFound();
          // The M3 lock serializes both feed consumption and compensation for this
          // stock position. The unique reversal key is the final duplicate guard.
          const movement = await this.stock.postMovementInTransaction(
            tx,
            context,
            {
              farmId,
              inventoryItemId: original.inventoryItemId,
              quantity: original.quantity,
              reason: 'ADJUSTMENT',
              occurredAt: input.occurredAt,
              note: input.note,
              reference: input.reference,
            },
          );
          return tx.feedUsage.create({
            data: {
              organizationId: context.organizationId,
              farmId,
              flockId: original.flockId,
              inventoryItemId: original.inventoryItemId,
              actorUserId: context.userId,
              inventoryMovementId: movement.id,
              quantity: original.quantity,
              reversesUsageId: original.id,
              occurredAt: input.occurredAt,
              note: input.note,
              reference: input.reference,
            },
          });
        },
        { isolationLevel: 'ReadCommitted' },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new BusinessException(
          'FEED_USAGE_ALREADY_REVERSED',
          'Feed usage has already been reversed',
        );
      }
      throw error;
    }
  }

  private async verifyFarm(
    tx: Prisma.TransactionClient,
    context: OrganizationContext,
    farmId: string,
  ) {
    const farm = await tx.farm.findFirst({
      where: { AND: [this.farms.farmWhere(context), { id: farmId }] },
      select: { id: true },
    });
    if (!farm) throw this.scopeNotFound();
  }

  private validateQuantity(quantity: Prisma.Decimal) {
    if (
      !quantity.isFinite() ||
      quantity.lte(0) ||
      quantity.decimalPlaces() > 3 ||
      quantity.gt('999999999999999.999')
    ) {
      throw new BusinessException(
        'FEED_USAGE_INVALID_QUANTITY',
        'Feed usage quantity must be positive with at most 3 decimal places',
      );
    }
  }

  private scopeNotFound() {
    return new BusinessException(
      'FEED_USAGE_SCOPE_NOT_FOUND',
      'Flock, feed item or farm was not found',
      404,
    );
  }
}
