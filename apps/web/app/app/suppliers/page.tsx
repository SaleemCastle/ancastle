import type { Metadata } from 'next';
import Link from 'next/link';
import { masterDataQuerySchema } from '@ancastle/validation';
import {
    supplierListResponseSchema,
    managementApi,
    ManagementApiError,
} from '@/lib/management/api';
import { applicationHref, type ApplicationSearch } from '@/lib/application/selection';
import { ManagementPage } from '@/components/management/page';
import { Button } from '@/components/ui/button';
import {
    MasterDataList,
    MasterDataStatus,
    type MasterDataColumn,
} from '@/components/management/master-data-list';

export const metadata: Metadata = {
    title: 'Suppliers | Ancastle Farms',
};

export default function SuppliersPage({
    searchParams,
}: {
    searchParams: Promise<ApplicationSearch>;
}) {
    return (
        <ManagementPage
            searchParams={searchParams}
            activePath="/app/suppliers"
            title="Suppliers"
            render={async (context, search) => {
                const current = context.current!;

                if (!current.permissions.includes('supplier:read')) {
                    throw new ManagementApiError('FORBIDDEN');
                }

                const parsed = masterDataQuerySchema.safeParse({
                    page: search.page,
                    pageSize: search.pageSize,
                    search: search.search,
                    isActive: search.isActive === '' ? undefined : search.isActive,
                });

                if (!parsed.success) {
                    throw new ManagementApiError('VALIDATION_ERROR');
                }

                const query = new URLSearchParams({
                    page: String(parsed.data.page),
                    pageSize: String(parsed.data.pageSize),
                });

                if (parsed.data.search) {
                    query.set('search', parsed.data.search);
                }

                if (parsed.data.isActive !== undefined) {
                    query.set('isActive', String(parsed.data.isActive));
                }

                const result = await managementApi(
                    'organizations/' + current.organization.id + '/suppliers?' + query.toString(),
                    supplierListResponseSchema,
                );

                const pageHref = (page: number) => {
                    const value = new URLSearchParams(query);
                    value.set('page', String(page));

                    return (
                        applicationHref('/app/suppliers', current.organization.id) +
                        '&' +
                        value.toString()
                    );
                };

                const canEdit = current.permissions.includes('supplier:update');

                const columns: MasterDataColumn<(typeof result.data)[number]>[] = [
                    {
                        key: 'code',
                        header: 'Code',
                        render: (supplier) => <span className="font-medium">{supplier.code}</span>,
                    },
                    {
                        key: 'name',
                        header: 'Supplier',
                        render: (supplier) => (
                            <div>
                                <p className="font-medium">{supplier.name}</p>
                            </div>
                        ),
                    },
                    {
                        key: 'contact',
                        header: 'Contact',
                        render: (supplier) => (
                            <div className="space-y-1">
                                {supplier.contactPerson && <p>{supplier.contactPerson}</p>}

                                {supplier.phone && (
                                    <p className="text-sm text-muted-foreground">
                                        {supplier.phone}
                                    </p>
                                )}

                                {supplier.email && (
                                    <p className="break-all text-sm text-muted-foreground">
                                        {supplier.email}
                                    </p>
                                )}

                                {!supplier.contactPerson && !supplier.phone && !supplier.email && (
                                    <span className="text-sm text-muted-foreground">
                                        No contact details
                                    </span>
                                )}
                            </div>
                        ),
                    },
                    {
                        key: 'status',
                        header: 'Status',
                        render: (supplier) => <MasterDataStatus isActive={supplier.isActive} />,
                    },
                    {
                        key: 'actions',
                        header: 'Actions',
                        render: (supplier) => (
                            <Link
                                prefetch={false}
                                href={applicationHref(
                                    '/app/suppliers/' + supplier.id,
                                    current.organization.id,
                                )}
                                className="font-medium text-primary hover:underline"
                            >
                                {canEdit ? 'Edit' : 'View'}
                                <span className="sr-only"> {supplier.name}</span>
                            </Link>
                        ),
                    },
                ];

                const hasQuery = Boolean(parsed.data.search) || parsed.data.isActive !== undefined;

                return (
                    <MasterDataList
                        title="Suppliers"
                        description="Manage supplier records for this organization."
                        caption="Suppliers are entities that provide goods or services to your organization. You can add, edit, and view supplier details here."
                        items={result.data}
                        getRowKey={(supplier) => supplier.id}
                        columns={columns}
                        primaryAction={
                            current.permissions.includes('supplier:create')
                                ? {
                                      label: 'Add supplier',
                                      href: applicationHref(
                                          '/app/suppliers/new',
                                          current.organization.id,
                                      ),
                                  }
                                : undefined
                        }
                        search={{
                            action: '/app/suppliers',
                            organization: current.organization.id,
                            defaultValue: parsed.data.search,
                            placeholder: 'Search suppliers by name, code or contact...',
                            pageSize: parsed.data.pageSize,
                            hiddenFields: {
                                isActive:
                                    parsed.data.isActive === undefined
                                        ? undefined
                                        : String(parsed.data.isActive),
                            },
                        }}
                        filters={
                            <form
                                action="/app/suppliers"
                                className="flex flex-wrap items-end gap-3"
                            >
                                <input
                                    type="hidden"
                                    name="organization"
                                    value={current.organization.id}
                                />

                                <input type="hidden" name="pageSize" value={parsed.data.pageSize} />

                                {parsed.data.search && (
                                    <input type="hidden" name="search" value={parsed.data.search} />
                                )}

                                <div>
                                    <label
                                        htmlFor="supplier-status-filter"
                                        className="mb-2 block text-sm font-medium"
                                    >
                                        Status
                                    </label>

                                    <select
                                        id="supplier-status-filter"
                                        name="isActive"
                                        defaultValue={search.isActive ?? ''}
                                        className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                                    >
                                        <option value="">All suppliers</option>
                                        <option value="true">Active</option>
                                        <option value="false">Inactive</option>
                                    </select>
                                </div>

                                <Button type="submit" variant="outline" className="h-10">
                                    Apply filter
                                </Button>
                            </form>
                        }
                        emptyTitle={
                            hasQuery ? 'No suppliers match this view.' : 'No suppliers yet.'
                        }
                        emptyDescription={
                            hasQuery
                                ? 'Try changing the search or status filter.'
                                : 'Add your first supplier to start building your supplier directory.'
                        }
                        pagination={{
                            page: result.meta.page,
                            totalPages: result.meta.totalPages,
                            totalItems: result.meta.totalItems,
                            itemLabel: 'supplier',
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
