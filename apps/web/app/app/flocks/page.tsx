import type { Metadata } from 'next';
import type { FlockWithMetrics } from '@ancastle/types';
import Link from 'next/link';
import { flockApiQuerySchema } from '@ancastle/validation';
import { ManagementPage } from '@/components/management/page';
import { MasterDataList, type MasterDataColumn } from '@/components/management/master-data-list';
import { FlockAge, FlockStatus } from '@/components/flocks/details';
import { Button } from '@/components/ui/button';
import { applicationHref, type ApplicationSearch } from '@/lib/application/selection';
import { ManagementApiError, managementApi } from '@/lib/management/api';
import { flockApiPath, flockListResponseSchema, flockScope } from '@/lib/management/flock-api';
import { flockMetricsDate } from '@/lib/management/flocks';

export const metadata: Metadata = { title: 'Flocks | Ancastle Farms' };
export default function FlocksPage({ searchParams }: { searchParams: Promise<ApplicationSearch> }) {
    return (
        <ManagementPage
            searchParams={searchParams}
            activePath="/app/flocks"
            title="Flocks"
            render={async (context, search) => {
                const scope = flockScope(context);
                if (!scope)
                    return (
                        <>
                            <h1 className="text-2xl font-semibold">Flocks</h1>
                            <p className="mt-4">Select an available farm to view flocks.</p>
                        </>
                    );
                const parsed = flockApiQuerySchema.safeParse({
                    page: search.page,
                    pageSize: search.pageSize,
                    search: search.search,
                    birdType: search.birdType,
                    isActive: search.isActive === '' ? undefined : search.isActive,
                    ageAndMaturityAsOfDate: flockMetricsDate(),
                });
                if (!parsed.success) throw new ManagementApiError('VALIDATION_ERROR');
                const input = parsed.data;
                const query = new URLSearchParams({
                    page: String(input.page),
                    pageSize: String(input.pageSize),
                    ageAndMaturityAsOfDate: input.ageAndMaturityAsOfDate,
                });
                if (input.search) query.set('search', input.search);
                if (input.birdType) query.set('birdType', input.birdType);
                if (input.isActive !== undefined) query.set('isActive', String(input.isActive));
                const result = await managementApi(
                    `${flockApiPath(scope)}?${query}`,
                    flockListResponseSchema,
                );
                const href = (path: string) =>
                    applicationHref(path, scope.organization, scope.farm);
                const pageHref = (page: number) => {
                    const value = new URLSearchParams(query);
                    value.delete('ageAndMaturityAsOfDate');
                    value.set('page', String(page));
                    return href('/app/flocks') + '&' + value;
                };
                const columns: MasterDataColumn<FlockWithMetrics>[] = [
                    {
                        key: 'code',
                        header: 'Code',
                        render: (flock) => (
                            <span className="whitespace-nowrap font-medium">{flock.code}</span>
                        ),
                    },
                    {
                        key: 'name',
                        header: 'Flock',
                        render: (flock) => (
                            <Link
                                prefetch={false}
                                href={href('/app/flocks/' + flock.id)}
                                className="wrap-break-word font-medium underline"
                            >
                                {flock.name}
                            </Link>
                        ),
                    },
                    {
                        key: 'birdType',
                        header: 'Bird type',
                        render: (flock) => flock.birdType ?? 'Not provided',
                    },
                    {
                        key: 'placement',
                        header: 'Placement date',
                        render: (flock) => flock.placementDate,
                    },
                    {
                        key: 'starting',
                        header: 'Starting population',
                        render: (flock) => flock.startingBirdCount,
                    },
                    {
                        key: 'live',
                        header: 'Live population',
                        render: (flock) => flock.metrics.liveBirdCount,
                    },
                    {
                        key: 'age',
                        header: 'Age / maturity',
                        render: (flock) => <FlockAge flock={flock} />,
                    },
                    {
                        key: 'state',
                        header: 'Lifecycle',
                        render: (flock) => <FlockStatus isActive={flock.isActive} />,
                    },
                ];
                const filtered = Boolean(
                    input.search ||
                    input.birdType ||
                    input.isActive !== undefined ||
                    input.page > 1,
                );
                return (
                    <MasterDataList
                        title="Flocks"
                        description={`Flocks at ${context.farm!.name}. Age and maturity as of ${input.ageAndMaturityAsOfDate} (UTC today); populations include all current postings.`}
                        caption="Farm flocks and authoritative metrics"
                        items={result.data}
                        getRowKey={(flock) => flock.id}
                        columns={columns}
                        primaryAction={
                            context.current!.permissions.includes('flock:manage')
                                ? { label: 'Create flock', href: href('/app/flocks/new') }
                                : undefined
                        }
                        search={{
                            action: '/app/flocks',
                            organization: scope.organization,
                            defaultValue: input.search,
                            placeholder: 'Code, name or bird type',
                            pageSize: input.pageSize,
                            hiddenFields: {
                                farm: scope.farm,
                                isActive:
                                    input.isActive === undefined
                                        ? undefined
                                        : String(input.isActive),
                                birdType: input.birdType,
                            },
                        }}
                        filters={
                            <form
                                action="/app/flocks"
                                className="flex min-w-0 flex-wrap items-end gap-3"
                            >
                                <input
                                    type="hidden"
                                    name="organization"
                                    value={scope.organization}
                                />
                                <input type="hidden" name="farm" value={scope.farm} />
                                <input type="hidden" name="search" value={input.search ?? ''} />
                                <input type="hidden" name="pageSize" value={input.pageSize} />
                                <div>
                                    <label
                                        htmlFor="flock-state"
                                        className="mb-2 block text-sm font-medium"
                                    >
                                        Lifecycle
                                    </label>
                                    <select
                                        id="flock-state"
                                        name="isActive"
                                        defaultValue={
                                            input.isActive === undefined
                                                ? ''
                                                : String(input.isActive)
                                        }
                                        className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                                    >
                                        <option value="">All flocks</option>
                                        <option value="true">Active</option>
                                        <option value="false">Closed</option>
                                    </select>
                                </div>
                                <div className="min-w-0">
                                    <label
                                        htmlFor="flock-bird-type"
                                        className="mb-2 block text-sm font-medium"
                                    >
                                        Bird type (exact)
                                    </label>
                                    <input
                                        id="flock-bird-type"
                                        name="birdType"
                                        defaultValue={input.birdType}
                                        maxLength={120}
                                        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                                    />
                                </div>
                                <Button type="submit" variant="outline">
                                    Apply filters
                                </Button>
                                <Link
                                    prefetch={false}
                                    href={href('/app/flocks')}
                                    className="py-2 text-sm underline"
                                >
                                    Clear filters
                                </Link>
                            </form>
                        }
                        emptyTitle={filtered ? 'No flocks match this view.' : 'No flocks yet.'}
                        emptyDescription={
                            filtered
                                ? 'Try another search or clear the filters.'
                                : 'Flocks placed at this farm will appear here.'
                        }
                        pagination={{
                            page: result.meta.page,
                            totalPages: result.meta.totalPages,
                            totalItems: result.meta.totalItems,
                            itemLabel: 'flock',
                            previousHref:
                                result.meta.page > 1 ? pageHref(result.meta.page - 1) : undefined,
                            nextHref:
                                result.meta.page < result.meta.totalPages
                                    ? pageHref(result.meta.page + 1)
                                    : undefined,
                        }}
                    />
                );
            }}
        />
    );
}
