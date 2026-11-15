import type { Metadata } from 'next';
import type { ApplicationSearch } from '@/lib/application/selection';
import { ManagementPage } from '@/components/management/page';
import { ProductEditor } from '@/components/sales-catalog/editor';
export const metadata: Metadata = { title: 'Add product | Ancastle Farms' };
export default function NewProductPage({
    searchParams,
}: {
    searchParams: Promise<ApplicationSearch>;
}) {
    return (
        <ManagementPage
            searchParams={searchParams}
            activePath="/app/sales-products"
            title="Add product"
            render={async (context, search) => <ProductEditor context={context} search={search} />}
        />
    );
}
