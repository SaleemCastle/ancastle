import type { Metadata } from 'next';
import { salesProductResponseSchema } from '@ancastle/validation';
import type { ApplicationSearch } from '@/lib/application/selection';
import { ManagementPage } from '@/components/management/page';
import { ProductEditor } from '@/components/sales-catalog/editor';
import { ManagementApiError, managementApi } from '@/lib/management/api';
import { catalogPath, checkedId } from '@/lib/management/sales-catalog';
export const metadata: Metadata = { title: 'Edit product | Ancastle Farms' };
export default function EditProductPage({
    params,
    searchParams,
}: {
    params: Promise<{ productId: string }>;
    searchParams: Promise<ApplicationSearch>;
}) {
    return (
        <ManagementPage
            searchParams={searchParams}
            activePath="/app/sales-products"
            title="Edit product"
            render={async (context, search) => {
                if (!context.current!.permissions.includes('sales-product:manage'))
                    throw new ManagementApiError('FORBIDDEN');
                const id = checkedId((await params).productId);
                const product = await managementApi(
                    `${catalogPath(context.current!.organization.id)}/${id}`,
                    salesProductResponseSchema,
                );
                return <ProductEditor context={context} search={search} product={product.data} />;
            }}
        />
    );
}
