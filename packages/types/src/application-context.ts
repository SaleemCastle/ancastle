import type { PaginatedResponse } from './api.js';
import type { OrganizationRole } from './organization-member.js';

export interface ApplicationFarm {
    id: string;
    name: string;
    code: string;
}

/** Fresh discovery for the signed-in user; resource APIs still enforce their guards. */
export interface ApplicationOrganization {
    organization: { id: string; name: string; slug: string };
    membership: { displayName: string | null; role: OrganizationRole };
    permissions: string[];
    farms: ApplicationFarm[];
}

export type ApplicationContextResponse = PaginatedResponse<ApplicationOrganization>;
