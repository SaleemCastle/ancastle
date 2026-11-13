import type { ApiResponse, PaginatedResponse } from './api.js';
import type { FlockMetrics, Flock } from './flock.js';

/** Staged for POP. Existing FlockMetrics/export aliases retain M4 semantics until cutover. */
export interface FlockMetricsV2 extends FlockMetrics {
    effectiveFulfilledBirdCount: number;
    /** Remaining ON FARM = starting - effective mortality - effective fulfilled birds. */
    liveBirdCount: number;
}
export interface FlockWithMetricsV2 extends Flock {
    metrics: FlockMetricsV2;
}
export type FlockDetailV2Response = ApiResponse<FlockWithMetricsV2>;
export type FlockMetricsListV2Response = PaginatedResponse<FlockWithMetricsV2>;
