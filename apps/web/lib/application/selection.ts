import type { ApplicationFarm, ApplicationOrganization } from '@ancastle/types';
import { applicationSelectionSchema } from '@ancastle/validation';

export class ApplicationAccessDeniedError extends Error {
    constructor() {
        super('This organization or farm is unavailable.');
    }
}
export type ApplicationSearch = Record<string, string | string[] | undefined>;

/** Select only from the fresh API access response; client state is never proof of access. */
export function selectApplicationContext(
    organizations: ApplicationOrganization[],
    search: ApplicationSearch,
) {
    const parsed = applicationSelectionSchema.safeParse({
        organization: search.organization === '' ? undefined : search.organization,
        farm: search.farm === '' ? undefined : search.farm,
    });
    if (!parsed.success) throw new ApplicationAccessDeniedError();
    const current = parsed.data.organization
        ? organizations.find((entry) => entry.organization.id === parsed.data.organization)
        : organizations[0];
    if (parsed.data.organization && !current) throw new ApplicationAccessDeniedError();
    let farm: ApplicationFarm | null = null;
    if (parsed.data.farm) {
        farm = current?.farms.find((entry) => entry.id === parsed.data.farm) ?? null;
        if (!farm) throw new ApplicationAccessDeniedError();
    } else if (current?.farms.length === 1) farm = current.farms[0];
    return { current: current ?? null, farm };
}

export function applicationHref(path: string, organizationId?: string, farmId?: string) {
    const query = new URLSearchParams();
    if (organizationId) query.set('organization', organizationId);
    if (farmId) query.set('farm', farmId);
    return path + (query.size ? '?' + query.toString() : '');
}
