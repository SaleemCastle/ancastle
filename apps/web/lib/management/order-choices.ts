import 'server-only';
import { customerListResponseSchema, managementApi } from '@/lib/management/api';
import { salesProductListResponseSchema } from '@ancastle/validation';

export async function loadOrderChoices(organization: string) {
    const customersQuery = new URLSearchParams({ page: '1', pageSize: '100', isActive: 'true' });
    const productsQuery = new URLSearchParams({ page: '1', pageSize: '100', isActive: 'true' });
    const [customers, products] = await Promise.all([
        managementApi(
            `organizations/${organization}/customers?${customersQuery}`,
            customerListResponseSchema,
        ),
        managementApi(
            `organizations/${organization}/sales-products?${productsQuery}`,
            salesProductListResponseSchema,
        ),
    ]);
    return { customers: customers.data, products: products.data };
}
