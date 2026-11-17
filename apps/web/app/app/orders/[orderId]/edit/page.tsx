import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { orderDetailResponseSchema, resourceIdSchema } from '@ancastle/validation';
import { ManagementPage } from '@/components/management/page';
import { OrderEditor } from '@/components/sales-orders/order-editor';
import { ManagementApiError, managementApi } from '@/lib/management/api';
import { loadOrderChoices } from '@/lib/management/order-choices';
import type { ApplicationSearch } from '@/lib/application/selection';
import type { Order } from '@ancastle/types';

export const metadata: Metadata = { title: 'Edit draft order | Ancastle Farms' };

export default function EditSalesOrderPage({
    params,
    searchParams,
}: {
    params: Promise<{ orderId: string }>;
    searchParams: Promise<ApplicationSearch>;
}) {
    return (
        <ManagementPage
            searchParams={searchParams}
            activePath="/app/orders"
            title="Edit draft order"
            render={async (context) => {
                const current = context.current!;
                if (!current.permissions.includes('order:manage'))
                    throw new ManagementApiError('FORBIDDEN');
                const { orderId: rawId } = await params;
                const parsedId = resourceIdSchema.safeParse(rawId);
                if (!parsedId.success) notFound();
                const detail = await managementApi(
                    `organizations/${current.organization.id}/orders/${parsedId.data}`,
                    orderDetailResponseSchema,
                );
                if (detail.data.commercialState !== 'DRAFT') notFound();
                const { sourceDetails: _sourceDetails, ...order } = detail.data;
                void _sourceDetails;
                const choices = await loadOrderChoices(current.organization.id);
                return (
                    <>
                        <h1 className="text-2xl font-semibold">Edit draft {order.code}</h1>
                        <p className="mt-2 text-sm text-muted-foreground">
                            Saving checks the version you opened. If another user has changed this
                            order, reload it and review the current draft.
                        </p>
                        <OrderEditor
                            organization={current.organization.id}
                            customers={choices.customers}
                            products={choices.products}
                            order={order as Order}
                        />
                    </>
                );
            }}
        />
    );
}
