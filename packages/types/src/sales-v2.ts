import type { ApiResponse, PaginatedResponse } from './api.js';
import type { FlockMetrics, Flock, FlockWithMetrics } from './flock.js';

/** Active population contract v2; liveBirdCount means remaining birds on farm. */
export interface FlockMetricsV2 extends FlockMetrics {
    /** Net fulfilled poultry sales (original depletions less exact reversals). */
    effectiveFulfilledBirdCount: number;
}
export interface FlockWithMetricsV2 extends Omit<FlockWithMetrics, 'metrics'> {
    metrics: FlockMetricsV2;
}
export type FlockDetailV2Response = ApiResponse<FlockWithMetricsV2>;
export type FlockMetricsListV2Response = PaginatedResponse<FlockWithMetricsV2>;
