import type { Metadata } from 'next';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { salesProductQuerySchema, salesProductListResponseSchema } from '@ancastle/validation';
import { ManagementPage } from '@/components/management/page';
import { MasterDataList, MasterDataStatus } from '@/components/management/master-data-list';
import { ManagementApiError, managementApi } from '@/lib/management/api';
import { catalogPath, pageHref } from '@/lib/management/sales-catalog';
import { applicationHref, type ApplicationSearch } from '@/lib/application/selection';

export const metadata: Metadata = { title: 'Sales catalog | Ancastle Farms' };
export default function CatalogPage({
    searchParams,
}: {
    searchParams: Promise<ApplicationSearch>;
}) {
    return (
        <ManagementPage
            searchParams={searchParams}
            activePath="/app/sales-products"
            title="Sales catalog"
            render={async (context, search) => {
                const current = context.current!;
                if (!current.permissions.includes('sales-product:read'))
                    throw new ManagementApiError('FORBIDDEN');
                const parsed = salesProductQuerySchema.safeParse({
                    page: search.page,
                    pageSize: search.pageSize,
                    search: search.search || undefined,
                    kind: search.kind || undefined,
                    isActive: search.isActive || undefined,
                });
                if (!parsed.success) throw new ManagementApiError('VALIDATION_ERROR');
                const query = new URLSearchParams({
                    page: String(parsed.data.page),
                    pageSize: String(parsed.data.pageSize),
                });
                if (parsed.data.search) query.set('search', parsed.data.search);
                if (parsed.data.kind) query.set('kind', parsed.data.kind);
                if (parsed.data.isActive !== undefined)
                    query.set('isActive', String(parsed.data.isActive));
                const result = await managementApi(
                    `${catalogPath(current.organization.id)}?${query}`,
                    salesProductListResponseSchema,
                );
                const path = '/app/sales-products';
                const scoped = { ...search, organization: current.organization.id };
                return (
                    <MasterDataList
                        title="Sales catalog"
                        description="Products define what may be sold. Catalog eligibility does not reserve stock or birds."
                        caption="Organization sales products"
                        items={result.data}
                        getRowKey={(product) => product.id}
                        columns={[
                            { key: 'code', header: 'Code', render: (product) => product.code },
                            {
                                key: 'name',
                                header: 'Product',
                                render: (product) => (
                                    <Link
                                        prefetch={false}
                                        className="underline"
                                        href={applicationHref(
                                            `${path}/${product.id}`,
                                            current.organization.id,
                                            context.farm?.id,
                                        )}
                                    >
                                        {product.name}
                                    </Link>
                                ),
                            },
                            {
                                key: 'kind',
                                header: 'Kind',
                                render: (product) =>
                                    product.kind === 'POULTRY' ? 'Poultry' : 'Produce',
                            },
                            { key: 'unit', header: 'Unit', render: (product) => product.unit },
                            {
                                key: 'source',
                                header: 'Source',
                                render: (product) =>
                                    product.kind === 'PRODUCE' &&
                                    current.permissions.includes('inventory:read') ? (
                                        <Link
                                            prefetch={false}
                                            className="underline"
                                            href={applicationHref(
                                                '/app/inventory/' + product.inventoryItemId,
                                                current.organization.id,
                                            )}
                                        >
                                            View linked produce item
                                        </Link>
                                    ) : product.kind === 'POULTRY' ? (
                                        'Farm flock eligibility'
                                    ) : (
                                        'Produce inventory definition'
                                    ),
                            },
                            {
                                key: 'status',
                                header: 'Status',
                                render: (product) => (
                                    <MasterDataStatus isActive={product.isActive} />
                                ),
                            },
                        ]}
                        primaryAction={
                            current.permissions.includes('sales-product:manage')
                                ? {
                                      label: 'Add product',
                                      href: applicationHref(path + '/new', current.organization.id),
                                  }
                                : undefined
                        }
                        search={{
                            action: path,
                            organization: current.organization.id,
                            defaultValue: parsed.data.search,
                            pageSize: parsed.data.pageSize,
                            hiddenFields: {
                                kind: parsed.data.kind,
                                isActive: search.isActive as string | undefined,
                            },
                        }}
                        filters={
                            <form action={path} className="flex flex-wrap items-end gap-3">
                                <input
                                    type="hidden"
                                    name="organization"
                                    value={current.organization.id}
                                />
                                <input
                                    type="hidden"
                                    name="search"
                                    value={parsed.data.search ?? ''}
                                />
                                <input type="hidden" name="pageSize" value={parsed.data.pageSize} />
                                <label className="space-y-2">
                                    Kind
                                    <select
                                        name="kind"
                                        defaultValue={parsed.data.kind ?? ''}
                                        className="ml-2 h-11 rounded-md border px-3"
                                    >
                                        <option value="">All kinds</option>
                                        <option value="POULTRY">Poultry</option>
                                        <option value="PRODUCE">Produce</option>
                                    </select>
                                </label>
                                <label className="space-y-2">
                                    Status
                                    <select
                                        name="isActive"
                                        defaultValue={(search.isActive as string) ?? ''}
                                        className="ml-2 h-11 rounded-md border px-3"
                                    >
                                        <option value="">All statuses</option>
                                        <option value="true">Active</option>
                                        <option value="false">Inactive</option>
                                    </select>
                                </label>
                                <Button type="submit" variant="outline">
                                    Apply filters
                                </Button>
                            </form>
                        }
                        emptyTitle="No products found"
                        emptyDescription="Create a product or adjust the filters."
                        pagination={{
                            ...result.meta,
                            itemLabel: 'products',
                            previousHref:
                                result.meta.page > 1
                                    ? pageHref(path, scoped, 'page', result.meta.page - 1)
                                    : undefined,
                            nextHref:
                                result.meta.page < result.meta.totalPages
                                    ? pageHref(path, scoped, 'page', result.meta.page + 1)
                                    : undefined,
                        }}
                    />
                );
            }}
        />
    );
}
