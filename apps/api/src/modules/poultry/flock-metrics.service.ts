import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../database/prisma.service.js';
import { FarmAccessService } from '../authorization/farm-access.service.js';
import type { OrganizationContext } from '../authorization/organization-context.js';
import { calculateFlockMetrics } from './flock-metrics.js';
import {
  authorizedFlock,
  cumulativeFeedUsage,
  effectiveMortality,
} from './poultry-history.js';

@Injectable()
export class FlockMetricsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly farms: FarmAccessService,
  ) {}

  /** Current cumulative ledger totals in one consistent snapshot. ageAndMaturityAsOfDate is an
   * explicit calendar date for age and maturity, not a historical ledger cutoff.
   */
  async get(
    context: OrganizationContext,
    farmId: string,
    flockId: string,
    ageAndMaturityAsOfDate: string,
  ) {
    return this.prisma.$transaction(
      async (tx) => {
        const flock = await authorizedFlock(
          tx,
          this.farms,
          context,
          farmId,
          flockId,
        );
        const scope = {
          organizationId: context.organizationId,
          farmId,
          flockId: flock.id,
        };
        const mortality = await effectiveMortality(tx, scope);
        const feed = await cumulativeFeedUsage(tx, scope);
        return calculateFlockMetrics(
          {
            startingBirdCount: flock.startingBirdCount,
            placementDate: flock.placementDate.toISOString().slice(0, 10),
            expectedMaturityDate:
              flock.expectedMaturityDate?.toISOString().slice(0, 10) ?? null,
          },
          mortality,
          feed,
          ageAndMaturityAsOfDate,
        );
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
}
