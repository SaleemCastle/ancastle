import type { ApiResponse, PaginatedResponse } from './api.js';
import type { InventoryUnit } from './index.js';

/** Farm-scoped placement batch. Ownership and lifecycle are read-only to ordinary writes. */
export interface Flock {
    id: string;
    farmId: string;
    code: string;
    name: string;
    birdType: string | null;
    /** Calendar date (YYYY-MM-DD), without a time or timezone. */
    placementDate: string;
    /** Positive placement population, not the derived live population. */
    startingBirdCount: number;
    /** Optional calendar date (YYYY-MM-DD), on or after placementDate. */
    expectedMaturityDate: string | null;
    notes: string | null;
    /** false means closed; the record and placement population are preserved. */
    isActive: boolean;
    /** ISO 8601 timestamp. */
    createdAt: string;
    /** ISO 8601 timestamp. */
    updatedAt: string;
}

export type FlockResponse = ApiResponse<Flock>;
export type FlockListResponse = PaginatedResponse<Flock>;

export const FLOCK_MATURITY_STATES = [
    'BEFORE_EXPECTED_MATURITY',
    'AT_OR_PAST_EXPECTED_MATURITY',
    'NO_EXPECTED_MATURITY_DATE',
] as const;
export type FlockMaturityState = (typeof FLOCK_MATURITY_STATES)[number];

export interface FlockMetrics {
    /** Calendar date for age/maturity only; ledger totals reflect all current postings. */
    ageAndMaturityAsOfDate: string;
    startingBirdCount: number;
    cumulativeMortality: number;
    liveBirdCount: number;
    /** Decimal percentage points, rounded half-up to six places. */
    mortalityPercentage: string;
    ageDays: number;
    ageWeeks: number;
    daysToMaturity: number | null;
    maturityState: FlockMaturityState;
    cumulativeFeedUsage: {
        inventoryItemId: string;
        unit: InventoryUnit;
        quantity: string;
    }[];
}
export interface FlockWithMetrics extends Flock {
    metrics: FlockMetrics;
}
export type FlockDetailResponse = ApiResponse<FlockWithMetrics>;
export type FlockMetricsListResponse = PaginatedResponse<FlockWithMetrics>;

export interface MortalityEvent {
    id: string;
    farmId: string;
    flockId: string;
    actorUserId: string;
    deathCount: number;
    occurredAt: string;
    createdAt: string;
    cause: string | null;
    note: string | null;
    reference: string | null;
    reversesEventId: string | null;
}
export interface FeedUsage {
    id: string;
    farmId: string;
    flockId: string;
    actorUserId: string;
    inventoryItemId: string;
    inventoryMovementId: string;
    quantity: string;
    occurredAt: string;
    createdAt: string;
    note: string | null;
    reference: string | null;
    reversesUsageId: string | null;
}
export type MortalityResponse = ApiResponse<MortalityEvent>;
export type MortalityListResponse = PaginatedResponse<MortalityEvent>;
export type FeedUsageResponse = ApiResponse<FeedUsage>;
export type FeedUsageListResponse = PaginatedResponse<FeedUsage>;
