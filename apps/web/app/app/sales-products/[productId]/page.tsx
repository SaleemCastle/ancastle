import type { Metadata } from 'next';
import Link from 'next/link';
import { salesProductResponseSchema } from '@ancastle/validation';
import { applicationHref, type ApplicationSearch } from '@/lib/application/selection';
import { ManagementPage } from '@/components/management/page';
import { ProductStatusForm } from '@/components/sales-catalog/forms';
import { ProductSources } from '@/components/sales-catalog/sources';
import {
    ManagementApiError,
    managementApi,
    inventoryItemResponseSchema,
} from '@/lib/management/api';
import { catalogPath, checkedId } from '@/lib/management/sales-catalog';
export const metadata: Metadata = { title: 'Sales product | Ancastle Farms' };
export default function ProductPage({
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
            title="Sales product"
            render={async (context, search) => {
                const current = context.current!;
                if (!current.permissions.includes('sales-product:read'))
                    throw new ManagementApiError('FORBIDDEN');
                const id = checkedId((await params).productId);
                const { data: product } = await managementApi(
                    `${catalogPath(current.organization.id)}/${id}`,
                    salesProductResponseSchema,
                );
                const item =
                    product.kind === 'PRODUCE' && current.permissions.includes('inventory:read')
                        ? (
                              await managementApi(
                                  `organizations/${current.organization.id}/inventory-items/${product.inventoryItemId}`,
                                  inventoryItemResponseSchema,
                              )
                          ).data
                        : null;
                return (
                    <div className="space-y-6">
                        <Link
                            prefetch={false}
                            href={applicationHref('/app/sales-products', current.organization.id)}
                            className="underline"
                        >
                            Back to catalog
                        </Link>
                        <h1 className="text-2xl font-semibold">{product.name}</h1>
                        <section
                            aria-label="Product definition"
                            className="space-y-3 rounded-xl border bg-card p-5"
                        >
                            <p>
                                {product.code} -{' '}
                                {product.kind === 'POULTRY' ? 'Poultry' : 'Produce'} -{' '}
                                {product.unit}
                            </p>
                            <p>Status: {product.isActive ? 'Active' : 'Inactive'}</p>
                            <p className="text-sm text-muted-foreground">
                                No stock or birds are reserved by this catalog entry.
                            </p>
                            {item && (
                                <p>
                                    Produce source:{' '}
                                    <Link
                                        prefetch={false}
                                        className="underline"
                                        href={applicationHref(
                                            '/app/inventory/' + item.id,
                                            current.organization.id,
                                        )}
                                    >
                                        {item.code} - {item.name}
                                    </Link>{' '}
                                    - {item.unit} - {item.isActive ? 'Active' : 'Inactive item'}
                                </p>
                            )}
                            {current.permissions.includes('sales-product:manage') && (
                                <>
                                    <Link
                                        prefetch={false}
                                        className="inline-block underline"
                                        href={applicationHref(
                                            '/app/sales-products/' + id + '/edit',
                                            current.organization.id,
                                        )}
                                    >
                                        Edit product
                                    </Link>
                                    <ProductStatusForm
                                        key={current.organization.id + ':' + product.id}
                                        organization={current.organization.id}
                                        product={product}
                                    />
                                </>
                            )}
                        </section>
                        {product.kind === 'POULTRY' && (
                            <ProductSources context={context} search={search} product={product} />
                        )}
                    </div>
                );
            }}
        />
    );
}
