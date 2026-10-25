import type { ApiResponse, PaginatedResponse } from './api.js';

export const ORGANIZATION_ROLES = ['OWNER', 'ADMIN', 'MANAGER', 'STAFF'] as const;
export type OrganizationRole = (typeof ORGANIZATION_ROLES)[number];

export interface OrganizationMember {
    membershipId: string;
    organizationId: string;
    userId: string;
    email: string;
    userIsActive: boolean;
    displayName: string | null;
    role: OrganizationRole;
    isActive: boolean;
    farmAccess: { allFarms: boolean; farmIds: string[] };
    createdAt: string;
    updatedAt: string;
}

export type OrganizationMemberResponse = ApiResponse<OrganizationMember>;
export type OrganizationMemberListResponse = PaginatedResponse<OrganizationMember>;
