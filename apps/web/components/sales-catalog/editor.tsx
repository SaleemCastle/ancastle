import Link from 'next/link';
import type { SalesProduct } from '@ancastle/types';
import type { ManagementContext } from '@/components/management/page';
import type { ApplicationSearch } from '@/lib/application/selection';
import { applicationHref } from '@/lib/application/selection';
import { ManagementApiError } from '@/lib/management/api';
import { loadProduceChoices } from '@/lib/management/sales-catalog';
import { ProductForm } from './forms';

export async function ProductEditor({
    context,
    search,
    product,
}: {
    context: ManagementContext;
    search: ApplicationSearch;
    product?: SalesProduct;
}) {
    const current = context.current!;
    if (!current.permissions.includes('sales-product:manage'))
        throw new ManagementApiError('FORBIDDEN');
    const canLinkProduce = current.permissions.includes('inventory:read');
    const path = '/app/sales-products/' + (product ? product.id + '/edit' : 'new');
    const choices = canLinkProduce
        ? await loadProduceChoices({ organization: current.organization.id, path, search })
        : null;
    return (
        <>
            <h1 className="text-2xl font-semibold">{product ? 'Edit product' : 'Add product'}</h1>
            <Link
                prefetch={false}
                className="mt-3 inline-block underline"
                href={applicationHref(
                    '/app/sales-products' + (product ? '/' + product.id : ''),
                    current.organization.id,
                )}
            >
                Back to {product ? 'product' : 'catalog'}
            </Link>
            {choices?.filters}
            <ProductForm
                key={`${current.organization.id}:${product?.id ?? 'new'}:${search.itemPage ?? ''}:${search.itemSearch ?? ''}`}
                organization={current.organization.id}
                product={product}
                items={choices?.items ?? []}
                canLinkProduce={canLinkProduce}
            />
        </>
    );
}
