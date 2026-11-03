import { Injectable } from '@nestjs/common';

import { BusinessException } from '../../common/exceptions/business.exception.js';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { FarmAccessService } from '../authorization/farm-access.service.js';
import type { OrganizationContext } from '../authorization/organization-context.js';
import { authorizedFlock, effectiveMortality } from './poultry-history.js';
import { lockFlockMutation } from './flock-mutation-lock.js';

interface MortalityMetadata {
  occurredAt: Date;
  cause?: string;
  note?: string;
  reference?: string;
}

export interface PostMortalityInput extends MortalityMetadata {
  flockId: string;
  deathCount: number;
}

@Injectable()
export class MortalityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly farms: FarmAccessService,
  ) {}

  async post(
    context: OrganizationContext,
    farmId: string,
    input: PostMortalityInput,
  ) {
    if (
      !Number.isInteger(input.deathCount) ||
      input.deathCount <= 0 ||
      input.deathCount > 2_147_483_647
    ) {
      throw new BusinessException(
        'MORTALITY_INVALID_COUNT',
        'Mortality count must be a positive integer',
      );
    }
    return this.prisma.$transaction(
      async (tx) => {
        await lockFlockMutation(tx, context, farmId, input.flockId);
        const flock = await authorizedFlock(
          tx,
          this.farms,
          context,
          farmId,
          input.flockId,
          true,
        );
        const mortality = await effectiveMortality(tx, {
          organizationId: context.organizationId,
          farmId,
          flockId: flock.id,
        });
        if (mortality.plus(input.deathCount).gt(flock.startingBirdCount)) {
          throw new BusinessException(
            'FLOCK_OVER_MORTALITY',
            'Mortality exceeds remaining live population',
          );
        }
        return tx.mortalityEvent.create({
          data: {
            organizationId: context.organizationId,
            farmId,
            flockId: flock.id,
            actorUserId: context.userId,
            deathCount: input.deathCount,
            occurredAt: input.occurredAt,
            cause: input.cause,
            note: input.note,
            reference: input.reference,
          },
        });
      },
      { isolationLevel: 'ReadCommitted' },
    );
  }

  /** Full compensation only, following M4-03. Reversal and ordinary posting
   * share a flock lock; neither path rewrites history or a population counter.
   */
  async reverse(
    context: OrganizationContext,
    farmId: string,
    flockId: string,
    eventId: string,
    input: MortalityMetadata,
  ) {
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          await lockFlockMutation(tx, context, farmId, flockId);
          await authorizedFlock(tx, this.farms, context, farmId, flockId);
          const original = await tx.mortalityEvent.findFirst({
            where: {
              id: eventId,
              organizationId: context.organizationId,
              farmId,
              flockId,
              reversesEventId: null,
            },
          });
          if (!original)
            throw new BusinessException(
              'MORTALITY_NOT_FOUND',
              'Mortality event was not found',
              404,
            );
          return tx.mortalityEvent.create({
            data: {
              organizationId: context.organizationId,
              farmId,
              flockId,
              actorUserId: context.userId,
              deathCount: original.deathCount,
              reversesEventId: original.id,
              occurredAt: input.occurredAt,
              cause: input.cause,
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
          'MORTALITY_ALREADY_REVERSED',
          'Mortality event has already been reversed',
        );
      }
      throw error;
    }
  }
}
