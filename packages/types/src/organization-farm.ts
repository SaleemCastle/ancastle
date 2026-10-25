import type { ApiResponse, PaginatedResponse } from './api.js';

export interface OrganizationProfile {
    id: string;
    name: string;
    slug: string;
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
}

export interface FarmDetails {
    id: string;
    organizationId: string;
    name: string;
    code: string;
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
}

export type OrganizationResponse = ApiResponse<OrganizationProfile>;
export type FarmResponse = ApiResponse<FarmDetails>;
export type FarmListResponse = PaginatedResponse<FarmDetails>;
