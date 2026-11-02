import type { ApiResponse, PaginatedResponse } from './api.js';

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
