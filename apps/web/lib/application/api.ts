import 'server-only';
import type { ApplicationOrganization } from '@ancastle/types';
import { applicationContextResponseSchema } from '@ancastle/validation';
import { authConfig } from '../auth/config';
import { AuthenticationRejectedError, AuthUnavailableError } from '../auth/errors';

export async function loadOrganizations(
    token: string,
    fetcher: typeof fetch = fetch,
): Promise<ApplicationOrganization[]> {
    const organizations: ApplicationOrganization[] = [];
    for (let page = 1; page <= 1000; page++) {
        let response;
        try {
            response = await fetcher(
                new URL('application/context?pageSize=100&page=' + page, authConfig().apiUrl),
                {
                    cache: 'no-store',
                    redirect: 'error',
                    signal: AbortSignal.timeout(5000),
                    headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' },
                },
            );
        } catch {
            throw new AuthUnavailableError();
        }
        if (response.status === 401) throw new AuthenticationRejectedError();
        if (!response.ok) throw new AuthUnavailableError();
        let result;
        try {
            result = applicationContextResponseSchema.safeParse(await response.json());
        } catch {
            throw new AuthUnavailableError();
        }
        if (!result.success || result.data.meta.page !== page) throw new AuthUnavailableError();
        organizations.push(...result.data.data);
        if (page >= result.data.meta.totalPages) return organizations;
    }
    throw new AuthUnavailableError();
}
