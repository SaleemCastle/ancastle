import { z } from 'zod';

import { BusinessException } from '../../common/exceptions/business.exception.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { MetricDecimal, type CumulativeFeedUsage } from './poultry-history.js';

const calendarDate = z.iso.date();
const millisecondsPerDay = 86_400_000;

export interface FlockMetricDefinition {
  startingBirdCount: number;
  placementDate: string;
  expectedMaturityDate: string | null;
}

export interface FlockMetrics {
  /** Applies to age/maturity only; population/feed reflect the current ledger. */
  ageAndMaturityAsOfDate: string;
  startingBirdCount: number;
  cumulativeMortality: number;
  liveBirdCount: number;
  /** Percentage points, rounded half-up to 6 decimal places. */
  mortalityPercentage: Prisma.Decimal;
  ageDays: number;
  ageWeeks: number;
  daysToMaturity: number | null;
  maturityState:
    | 'BEFORE_EXPECTED_MATURITY'
    | 'AT_OR_PAST_EXPECTED_MATURITY'
    | 'NO_EXPECTED_MATURITY_DATE';
  cumulativeFeedUsage: CumulativeFeedUsage[];
}

/** No implicit clock, local timezone or timestamp truncation. Date-only strings
 * are compared as UTC calendar-day ordinals, so DST cannot change completed days.
 */
export function calculateFlockMetrics(
  flock: FlockMetricDefinition,
  mortality: Prisma.Decimal,
  feed: CumulativeFeedUsage[],
  ageAndMaturityAsOfDate: string,
): FlockMetrics {
  if (
    !calendarDate.safeParse(ageAndMaturityAsOfDate).success ||
    ageAndMaturityAsOfDate < flock.placementDate
  ) {
    throw new BusinessException(
      'FLOCK_INVALID_AS_OF_DATE',
      'As-of date must be a calendar date on or after placement',
    );
  }
  if (
    !Number.isSafeInteger(flock.startingBirdCount) ||
    flock.startingBirdCount <= 0 ||
    !mortality.isFinite() ||
    !mortality.isInteger() ||
    mortality.lt(0) ||
    mortality.gt(flock.startingBirdCount)
  ) {
    throw new BusinessException(
      'FLOCK_HISTORY_INVALID',
      'Flock history has an invalid population',
      409,
    );
  }
  const asOfDay = Date.parse(ageAndMaturityAsOfDate) / millisecondsPerDay;
  const ageDays =
    asOfDay - Date.parse(flock.placementDate) / millisecondsPerDay;
  const daysToMaturity =
    flock.expectedMaturityDate === null
      ? null
      : Math.max(
          0,
          Date.parse(flock.expectedMaturityDate) / millisecondsPerDay - asOfDay,
        );
  return {
    ageAndMaturityAsOfDate,
    startingBirdCount: flock.startingBirdCount,
    cumulativeMortality: mortality.toNumber(),
    liveBirdCount: flock.startingBirdCount - mortality.toNumber(),
    // Multiply before dividing; never convert the authoritative ratio to float.
    mortalityPercentage: new MetricDecimal(mortality)
      .mul(100)
      .div(flock.startingBirdCount)
      .toDecimalPlaces(6, MetricDecimal.ROUND_HALF_UP),
    ageDays,
    ageWeeks: Math.floor(ageDays / 7),
    daysToMaturity,
    maturityState:
      daysToMaturity === null
        ? 'NO_EXPECTED_MATURITY_DATE'
        : daysToMaturity > 0
          ? 'BEFORE_EXPECTED_MATURITY'
          : 'AT_OR_PAST_EXPECTED_MATURITY',
    cumulativeFeedUsage: feed,
  };
}
