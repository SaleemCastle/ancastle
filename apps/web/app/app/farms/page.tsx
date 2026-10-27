import type { Metadata } from 'next';
import Link from 'next/link';
import { farmListQuerySchema, farmListResponseSchema } from '@ancastle/validation';
import { managementApi, ManagementApiError } from '@/lib/management/api';
import { applicationHref, type ApplicationSearch } from '@/lib/application/selection';
import { ManagementPage } from '@/components/management/page';
import { Button } from '@/components/ui/button';
import {
    MasterDataList,
    MasterDataStatus,
    type MasterDataColumn,
} from '@/components/management/master-data-list';

export const metadata: Metadata = { title: 'Farms | Ancastle Farms' };

export default function FarmsPage({ searchParams }: { searchParams: Promise<ApplicationSearch> }) {
    return (
        <ManagementPage
            searchParams={searchParams}
            activePath="/app/farms"
            title="Farms"
            render={async (context, search) => {
                const current = context.current!;
                if (!current.permissions.includes('farm:read'))
                    throw new ManagementApiError('FORBIDDEN');
                const parsed = farmListQuerySchema.safeParse({
                    page: search.page,
                    pageSize: search.pageSize,
                    isActive: search.isActive === '' ? undefined : search.isActive,
                });
                if (!parsed.success) throw new ManagementApiError('VALIDATION_ERROR');
                const query = new URLSearchParams({
                    page: String(parsed.data.page),
                    pageSize: String(parsed.data.pageSize),
                });
                if (parsed.data.isActive !== undefined)
                    query.set('isActive', String(parsed.data.isActive));
                const result = await managementApi(
                    'organizations/' + current.organization.id + '/farms?' + query.toString(),
                    farmListResponseSchema,
                );
                const pageHref = (page: number) => {
                    const value = new URLSearchParams(query);
                    value.set('page', String(page));
                    return (
                        applicationHref('/app/farms', current.organization.id) +
                        '&' +
                        value.toString()
                    );
                };
                const canEdit = current.permissions.includes('farm:update');
                const columns: MasterDataColumn<(typeof result.data)[number]>[] = [
                    {
                        key: 'name',
                        header: 'Name',
                        render: (farm) => <span className="font-medium">{farm.name}</span>,
                    },
                    {
                        key: 'code',
                        header: 'Code',
                        render: (farm) => farm.code,
                    },
                    {
                        key: 'status',
                        header: 'Status',
                        render: (farm) => <MasterDataStatus isActive={farm.isActive} />,
                    },
                    {
                        key: 'actions',
                        header: 'Actions',
                        render: (farm) => (
                            <Link
                                prefetch={false}
                                href={applicationHref(
                                    '/app/farms/' + farm.id,
                                    current.organization.id,
                                )}
                                className="font-medium text-primary hover:underline"
                            >
                                {canEdit ? 'Edit' : 'View'}
                                <span className="sr-only"> {farm.name}</span>
                            </Link>
                        ),
                    },
                ];
                return (
                    <MasterDataList
                        title="Farms"
                        description="Manage the farms available in this organization."
                        caption="Accessible farms"
                        items={result.data}
                        getRowKey={(farm) => farm.id}
                        columns={columns}
                        primaryAction={
                            current.permissions.includes('farm:create')
                                ? {
                                      label: 'Create farm',
                                      href: applicationHref(
                                          '/app/farms/new',
                                          current.organization.id,
                                      ),
                                  }
                                : undefined
                        }
                        filters={
                            <form action="/app/farms" className="flex flex-wrap items-end gap-3">
                                <input
                                    type="hidden"
                                    name="organization"
                                    value={current.organization.id}
                                />

                                <input type="hidden" name="pageSize" value={parsed.data.pageSize} />

                                <div>
                                    <label
                                        htmlFor="status-filter"
                                        className="mb-2 block text-sm font-medium"
                                    >
                                        Status
                                    </label>

                                    <select
                                        id="status-filter"
                                        name="isActive"
                                        defaultValue={search.isActive ?? ''}
                                        className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                                    >
                                        <option value="">All accessible farms</option>
                                        <option value="true">Active</option>
                                        <option value="false">Inactive</option>
                                    </select>
                                </div>

                                <Button type="submit" variant="outline" className="h-10">
                                    Apply filter
                                </Button>
                            </form>
                        }
                        emptyTitle="No farms match this view."
                        emptyDescription="Try changing the status filter to find another farm."
                        pagination={{
                            page: result.meta.page,
                            totalPages: result.meta.totalPages,
                            totalItems: result.meta.totalItems,
                            itemLabel: 'farm',
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
