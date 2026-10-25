import 'server-only';
import { farmListResponseSchema } from '@ancastle/validation';
import type { FarmDetails } from '@ancastle/types';
import { managementApi } from './api';
import { AuthUnavailableError } from '../auth/errors';

export async function memberFarmChoices(organization: string): Promise<FarmDetails[]> {
    const farms: FarmDetails[] = [];
    for (let page = 1; page <= 1000; page++) {
        const result = await managementApi(
            'organizations/' + organization + '/farms?pageSize=100&page=' + page,
            farmListResponseSchema,
        );
        if (result.meta.page !== page) throw new AuthUnavailableError();
        farms.push(...result.data);
        if (page >= result.meta.totalPages) return farms;
    }
    throw new AuthUnavailableError();
}
