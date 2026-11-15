import type { SalesProduct } from '@ancastle/types';
import {
    poultryProductSourceQuerySchema,
    poultryProductSourceListResponseSchema,
    flockApiQuerySchema,
} from '@ancastle/validation';
import type { ManagementContext } from '@/components/management/page';
import type { ApplicationSearch } from '@/lib/application/selection';
import { ManagementApiError, managementApi } from '@/lib/management/api';
import { AuthUnavailableError } from '@/lib/auth/errors';
import { flockListResponseSchema } from '@/lib/management/flock-api';
import { flockMetricsDate } from '@/lib/management/flocks';
import { Pages } from '@/lib/management/sales-catalog';
import { Button } from '@/components/ui/button';
import { SourceForm } from './forms';

export async function ProductSources({
    context,
    search,
    product,
}: {
    context: ManagementContext;
    search: ApplicationSearch;
    product: SalesProduct;
}) {
    const current = context.current!;
    if (!current.permissions.includes('flock:read'))
        return <p>Farm source access is required to view eligibility.</p>;
    const organization = current.organization.id;
    const farm = context.farm;
    const path = '/app/sales-products/' + product.id;
    const manage = current.permissions.includes('sales-product-source:manage');
    const selector = (
        <form action={path} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="organization" value={organization} />
            <div className="min-w-0 flex-1 space-y-2">
                <label htmlFor="eligibility-farm">Source farm</label>
                <select
                    id="eligibility-farm"
                    name="farm"
                    defaultValue={farm?.id ?? ''}
                    required
                    className="h-11 w-full rounded-md border px-3"
                >
                    <option value="" disabled>
                        Select an accessible farm
                    </option>
                    {current.farms.map((choice) => (
                        <option key={choice.id} value={choice.id}>
                            {choice.name}
                        </option>
                    ))}
                </select>
            </div>
            <Button type="submit" variant="outline">
                View farm sources
            </Button>
        </form>
    );
    if (!farm)
        return (
            <section
                aria-label="Poultry eligibility"
                className="space-y-4 rounded-xl border bg-card p-5"
            >
                <h2 className="text-xl font-semibold">Poultry eligibility</h2>
                {selector}
                <p>Select an accessible farm to view source eligibility.</p>
            </section>
        );
    const parsed = poultryProductSourceQuerySchema.safeParse({
        page: search.sourcePage,
        pageSize: 20,
        isActive: search.sourceActive || undefined,
    });
    if (!parsed.success) throw new ManagementApiError('VALIDATION_ERROR');
    const query = new URLSearchParams({ page: String(parsed.data.page), pageSize: '20' });
    if (parsed.data.isActive !== undefined) query.set('isActive', String(parsed.data.isActive));
    const sources = await managementApi(
        `organizations/${organization}/farms/${farm.id}/sales-products/${product.id}/poultry-sources?${query}`,
        poultryProductSourceListResponseSchema,
    );
    const flockQuery = flockApiQuerySchema.safeParse({
        page: search.flockPage,
        pageSize: 20,
        search: search.flockSearch,
        isActive: 'true',
        ageAndMaturityAsOfDate: flockMetricsDate(),
    });
    if (!flockQuery.success) throw new ManagementApiError('VALIDATION_ERROR');
    const flockParams = new URLSearchParams({
        page: String(flockQuery.data.page),
        pageSize: '20',
        isActive: 'true',
        ageAndMaturityAsOfDate: flockQuery.data.ageAndMaturityAsOfDate,
    });
    if (flockQuery.data.search) flockParams.set('search', flockQuery.data.search);
    const flocks = manage
        ? await managementApi(
              `organizations/${organization}/farms/${farm.id}/flocks?${flockParams}`,
              flockListResponseSchema,
          )
        : null;
    if (
        sources.data.some(
            (source) => source.farmId !== farm.id || source.productId !== product.id,
        ) ||
        flocks?.data.some((flock) => flock.farmId !== farm.id)
    )
        throw new AuthUnavailableError();
    const scoped = { ...search, organization, farm: farm.id };
    return (
        <section
            key={`${organization}:${farm.id}:${product.id}`}
            aria-label="Poultry eligibility"
            className="min-w-0 space-y-5 rounded-xl border bg-card p-5"
        >
            <h2 className="text-xl font-semibold">Poultry eligibility</h2>
            {selector}
            <p className="text-sm text-muted-foreground">
                Explicit flock eligibility is not a reservation or a guarantee of available birds.
            </p>
            <form action={path} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="organization" value={organization} />
                <input type="hidden" name="farm" value={farm.id} />
                <label>
                    Status{' '}
                    <select
                        name="sourceActive"
                        defaultValue={(search.sourceActive as string) ?? ''}
                        className="h-11 rounded-md border px-3"
                    >
                        <option value="">All associations</option>
                        <option value="true">Active associations</option>
                        <option value="false">Inactive associations</option>
                    </select>
                </label>
                <Button type="submit" variant="outline">
                    Filter eligibility
                </Button>
            </form>
            {sources.data.length ? (
                <ul className="space-y-4">
                    {sources.data.map((source) => (
                        <li key={source.id} className="min-w-0 space-y-3 rounded-lg border p-4">
                            <h3 className="font-medium">
                                {source.flockCode} - {source.flockName}
                            </h3>
                            <p>
                                {source.isEligible
                                    ? 'Eligible'
                                    : [
                                          !source.isActive && 'Eligibility inactive',
                                          !source.productIsActive && 'Product inactive',
                                          !source.flockIsActive && 'Flock closed',
                                      ]
                                          .filter(Boolean)
                                          .join(', ')}
                            </p>
                            {manage && (
                                <SourceForm
                                    key={`${organization}:${farm.id}:${source.id}`}
                                    organization={organization}
                                    farm={farm.id}
                                    productId={product.id}
                                    source={source}
                                    disabled={
                                        !source.isActive &&
                                        (!product.isActive || !source.flockIsActive)
                                    }
                                />
                            )}
                        </li>
                    ))}
                </ul>
            ) : (
                <p>No source eligibility is recorded for this farm and filter.</p>
            )}
            <Pages path={path} search={scoped} pageKey="sourcePage" meta={sources.meta} />
            {manage && flocks && (
                <div className="space-y-4 border-t pt-5">
                    <h3 className="font-semibold">Attach an active flock</h3>
                    <form action={path} className="flex flex-wrap items-end gap-3">
                        <input type="hidden" name="organization" value={organization} />
                        <input type="hidden" name="farm" value={farm.id} />
                        <div className="min-w-0 flex-1 space-y-2">
                            <label htmlFor="flock-search">Find active flock</label>
                            <input
                                id="flock-search"
                                name="flockSearch"
                                defaultValue={flockQuery.data.search}
                                maxLength={120}
                                className="h-11 w-full rounded-md border px-3"
                            />
                        </div>
                        <Button type="submit" variant="outline">
                            Search flocks
                        </Button>
                    </form>
                    {!product.isActive && (
                        <p>Reactivate the product before attaching a new source.</p>
                    )}
                    {!flocks.data.length && <p>No matching active flocks in this farm.</p>}
                    <SourceForm
                        key={`${organization}:${farm.id}:${product.id}:attach:${flockQuery.data.page}:${flockQuery.data.search ?? ''}`}
                        organization={organization}
                        farm={farm.id}
                        productId={product.id}
                        flocks={flocks.data}
                        disabled={!product.isActive || !flocks.data.length}
                    />
                    <Pages path={path} search={scoped} pageKey="flockPage" meta={flocks.meta} />
                </div>
            )}
        </section>
    );
}
