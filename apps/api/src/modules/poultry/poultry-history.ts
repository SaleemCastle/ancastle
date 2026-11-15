import { BusinessException } from '../../common/exceptions/business.exception.js';
import { Prisma } from '../../generated/prisma/client.js';
import type { InventoryUnit } from '../../generated/prisma/client.js';
import type { FarmAccessService } from '../authorization/farm-access.service.js';
import type { OrganizationContext } from '../authorization/organization-context.js';

export interface FlockHistoryScope {
  organizationId: string;
  farmId: string;
  flockId: string;
}

export async function authorizedFlock(
  tx: Prisma.TransactionClient,
  farms: FarmAccessService,
  context: OrganizationContext,
  farmId: string,
  flockId: string,
  activeOnly = false,
) {
  const flock = await tx.flock.findFirst({
    where: {
      id: flockId,
      organizationId: context.organizationId,
      farmId,
      ...(activeOnly ? { isActive: true } : {}),
      farm: farms.farmWhere(context),
    },
  });
  if (!flock) {
    throw new BusinessException('FLOCK_NOT_FOUND', 'Flock was not found', 404);
  }
  return flock;
}

// Use a local Decimal constructor: do not change global inventory precision.
export const MetricDecimal = Prisma.Decimal.clone({
  precision: 40,
  rounding: Prisma.Decimal.ROUND_HALF_UP,
});

export interface EffectiveFlockPopulation {
  mortality: Prisma.Decimal;
  fulfilledBirds: Prisma.Decimal;
}

/** Read both append-only ledgers in one PostgreSQL statement snapshot. SQL SUM
 * avoids overflowing an individual PostgreSQL integer or a JavaScript number
 * before cancelling full reversals.
 */
export async function effectivePopulation(
  tx: Prisma.TransactionClient,
  scope: FlockHistoryScope,
): Promise<EffectiveFlockPopulation> {
  const [result] = await tx.$queryRaw<
    { mortality: string; fulfilledBirds: string }[]
  >(Prisma.sql`
    SELECT
      COALESCE((SELECT SUM(CASE WHEN "reversesEventId" IS NULL
        THEN "deathCount"::bigint ELSE -"deathCount"::bigint END)
        FROM "mortality_events"
        WHERE "organizationId" = ${scope.organizationId}::uuid
          AND "farmId" = ${scope.farmId}::uuid
          AND "flockId" = ${scope.flockId}::uuid), 0)::text AS mortality,
      COALESCE((SELECT SUM(CASE WHEN "reversesDepletionId" IS NULL
        THEN "birdCount"::bigint ELSE -"birdCount"::bigint END)
        FROM "flock_sale_depletions"
        WHERE "organizationId" = ${scope.organizationId}::uuid
          AND "farmId" = ${scope.farmId}::uuid
          AND "flockId" = ${scope.flockId}::uuid), 0)::text AS "fulfilledBirds"
  `);
  return {
    mortality: new MetricDecimal(result!.mortality),
    fulfilledBirds: new MetricDecimal(result!.fulfilledBirds),
  };
}

/** Compatibility helper for callers that need only the established M4 metric. */
export async function effectiveMortality(
  tx: Prisma.TransactionClient,
  scope: FlockHistoryScope,
): Promise<Prisma.Decimal> {
  return (await effectivePopulation(tx, scope)).mortality;
}

export async function effectiveFulfilledBirdCount(
  tx: Prisma.TransactionClient,
  scope: FlockHistoryScope,
): Promise<Prisma.Decimal> {
  return (await effectivePopulation(tx, scope)).fulfilledBirds;
}

export interface CumulativeFeedUsage {
  inventoryItemId: string;
  unit: InventoryUnit;
  quantity: Prisma.Decimal;
}

/** FeedUsage, not stock movements, explains consumption by flock. Keep distinct
 * items/units separate; no mathematically meaningful mixed-unit grand total exists.
 */
export async function cumulativeFeedUsage(
  tx: Prisma.TransactionClient,
  scope: FlockHistoryScope,
): Promise<CumulativeFeedUsage[]> {
  const rows = await tx.$queryRaw<
    {
      inventoryItemId: string;
      unit: InventoryUnit;
      quantity: string;
    }[]
  >(Prisma.sql`
    SELECT usage."inventoryItemId", item."unit",
      SUM(CASE WHEN usage."reversesUsageId" IS NULL
        THEN usage."quantity" ELSE -usage."quantity" END)::text AS quantity
    FROM "feed_usages" AS usage
    JOIN "inventory_items" AS item ON item."id" = usage."inventoryItemId"
      AND item."organizationId" = usage."organizationId"
    WHERE usage."organizationId" = ${scope.organizationId}::uuid
      AND usage."farmId" = ${scope.farmId}::uuid AND usage."flockId" = ${scope.flockId}::uuid
    GROUP BY usage."inventoryItemId", item."unit"
    ORDER BY usage."inventoryItemId"
  `);
  return rows.map((row) => ({
    ...row,
    quantity: new MetricDecimal(row.quantity),
  }));
}
