import type { Metadata } from 'next';
import { ManagementPage } from '@/components/management/page';
import { OrderEditor } from '@/components/sales-orders/order-editor';
import { ManagementApiError } from '@/lib/management/api';
import { loadOrderChoices } from '@/lib/management/order-choices';
import type { ApplicationSearch } from '@/lib/application/selection';

export const metadata: Metadata = { title: 'Create order | Ancastle Farms' };

export default function NewSalesOrderPage({
    searchParams,
}: {
    searchParams: Promise<ApplicationSearch>;
}) {
    return (
        <ManagementPage
            searchParams={searchParams}
            activePath="/app/orders"
            title="Create sales order"
            render={async (context) => {
                const current = context.current!;
                if (!current.permissions.includes('order:manage'))
                    throw new ManagementApiError('FORBIDDEN');
                const { customers, products } = await loadOrderChoices(current.organization.id);
                return (
                    <>
                        <h1 className="text-2xl font-semibold">Create draft order</h1>
                        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
                            Prices are agreed per order line. The server validates and saves the
                            commercial snapshot. A draft does not reserve stock or birds.
                        </p>
                        <OrderEditor
                            organization={current.organization.id}
                            customers={customers}
                            products={products}
                        />
                    </>
                );
            }}
        />
    );
}
