import 'server-only';
import Link from 'next/link';
import { inventoryQuerySchema, resourceIdSchema } from '@ancastle/validation';
import type { ApplicationSearch } from '@/lib/application/selection';
import { ManagementApiError, managementApi, inventoryItemListResponseSchema } from './api';
import { Button } from '@/components/ui/button';

export const catalogPath = (organization: string) => `organizations/${organization}/sales-products`;
export function checkedId(value: string) {
    const parsed = resourceIdSchema.safeParse(value);
    if (!parsed.success) throw new ManagementApiError('SALES_PRODUCT_NOT_FOUND');
    return parsed.data;
}
export function pageHref(path: string, search: ApplicationSearch, key: string, page: number) {
    const params = new URLSearchParams();
    for (const [name, value] of Object.entries(search))
        if (typeof value === 'string') params.set(name, value);
    params.set(key, String(page));
    return path + '?' + params.toString();
}
export function Pages({
    path,
    search,
    pageKey = 'page',
    meta,
}: {
    path: string;
    search: ApplicationSearch;
    pageKey?: string;
    meta: { page: number; totalPages: number; totalItems: number };
}) {
    return (
        <nav
            aria-label={`${pageKey} pagination`}
            className="flex flex-wrap items-center gap-4 py-4 text-sm"
        >
            <span>
                {meta.totalItems} results - Page {meta.page} of {Math.max(1, meta.totalPages)}
            </span>
            {meta.page > 1 && (
                <Link prefetch={false} href={pageHref(path, search, pageKey, meta.page - 1)}>
                    Previous
                </Link>
            )}
            {meta.page < meta.totalPages && (
                <Link prefetch={false} href={pageHref(path, search, pageKey, meta.page + 1)}>
                    Next
                </Link>
            )}
        </nav>
    );
}
export async function loadProduceChoices({
    organization,
    path,
    search,
}: {
    organization: string;
    path: string;
    search: ApplicationSearch;
}) {
    const parsed = inventoryQuerySchema.safeParse({
        page: search.itemPage,
        pageSize: 20,
        search: search.itemSearch,
        category: 'PRODUCE',
        isActive: 'true',
    });
    if (!parsed.success) throw new ManagementApiError('VALIDATION_ERROR');
    const query = new URLSearchParams({
        page: String(parsed.data.page),
        pageSize: '20',
        category: 'PRODUCE',
        isActive: 'true',
    });
    if (parsed.data.search) query.set('search', parsed.data.search);
    const result = await managementApi(
        `organizations/${organization}/inventory-items?${query}`,
        inventoryItemListResponseSchema,
    );
    return {
        items: result.data,
        filters: (
            <section
                aria-label="Find produce source"
                className="mt-6 rounded-xl border bg-card p-5"
            >
                <form action={path} className="flex flex-wrap items-end gap-3">
                    <input type="hidden" name="organization" value={organization} />
                    <div className="min-w-0 flex-1 space-y-2">
                        <label htmlFor="item-search">Find produce source</label>
                        <input
                            id="item-search"
                            name="itemSearch"
                            defaultValue={parsed.data.search}
                            maxLength={120}
                            className="h-11 w-full rounded-md border px-3"
                        />
                    </div>
                    <Button type="submit" variant="outline">
                        Search produce
                    </Button>
                </form>
                <Pages
                    path={path}
                    search={{ ...search, organization }}
                    pageKey="itemPage"
                    meta={result.meta}
                />
            </section>
        ),
    };
}
