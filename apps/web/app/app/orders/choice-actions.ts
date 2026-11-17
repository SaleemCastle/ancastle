'use server';

import { resourceIdSchema, salesProductListResponseSchema } from '@ancastle/validation';
import { z } from 'zod';
import { unstable_rethrow } from 'next/navigation';
import { requireApplicationContext } from '@/lib/application/current-context';
import {
    ManagementApiError,
    customerListResponseSchema,
    managementApi,
} from '@/lib/management/api';

const choiceSearchSchema = z.string().trim().max(120);

export async function searchOrderChoicesAction(
    organizationValue: string,
    type: 'customer' | 'product',
    searchValue: string,
) {
    const organization = resourceIdSchema.safeParse(organizationValue);
    const search = choiceSearchSchema.safeParse(searchValue);
    if (!organization.success || !search.success)
        return { type, data: [], error: 'Enter a valid search and try again.' };
    try {
        const context = await requireApplicationContext({ organization: organization.data });
        const current = context.current;
        const permission = type === 'customer' ? 'customer:read' : 'sales-product:read';
        if (
            !current ||
            current.organization.id !== organization.data ||
            !current.permissions.includes('order:manage') ||
            !current.permissions.includes(permission)
        )
            throw new ManagementApiError('FORBIDDEN');
        const query = new URLSearchParams({ page: '1', pageSize: '100', isActive: 'true' });
        if (search.data) query.set('search', search.data);
        if (type === 'customer') {
            const result = await managementApi(
                `organizations/${organization.data}/customers?${query}`,
                customerListResponseSchema,
            );
            return { type, data: result.data };
        }
        const result = await managementApi(
            `organizations/${organization.data}/sales-products?${query}`,
            salesProductListResponseSchema,
        );
        return { type, data: result.data };
    } catch (error) {
        unstable_rethrow(error);
        return {
            type,
            data: [],
            error: 'Search could not be completed. Check access and try again.',
        };
    }
}
