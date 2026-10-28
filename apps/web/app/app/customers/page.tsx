import type { Metadata } from 'next';
import Link from 'next/link';
import { masterDataQuerySchema } from '@ancastle/validation';
import {
    customerListResponseSchema,
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
    title: 'Customers | Ancastle Farms',
};

export default function CustomersPage({
    searchParams,
}: {
    searchParams: Promise<ApplicationSearch>;
}) {
    return (
        <ManagementPage
            searchParams={searchParams}
            activePath="/app/customers"
            title="Customers"
            render={async (context, search) => {
                const current = context.current!;

                if (!current.permissions.includes('customer:read')) {
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
                    'organizations/' + current.organization.id + '/customers?' + query.toString(),
                    customerListResponseSchema,
                );

                const pageHref = (page: number) => {
                    const value = new URLSearchParams(query);
                    value.set('page', String(page));

                    return (
                        applicationHref('/app/customers', current.organization.id) +
                        '&' +
                        value.toString()
                    );
                };

                const canEdit = current.permissions.includes('customer:update');

                const columns: MasterDataColumn<(typeof result.data)[number]>[] = [
                    {
                        key: 'code',
                        header: 'Code',
                        render: (customer) => <span className="font-medium">{customer.code}</span>,
                    },
                    {
                        key: 'name',
                        header: 'Customer',
                        render: (customer) => (
                            <div>
                                <p className="font-medium">{customer.name}</p>
                                <p className="text-xs text-muted-foreground">
                                    {customer.type === 'BUSINESS' ? 'Business' : 'Individual'}
                                </p>
                            </div>
                        ),
                    },
                    {
                        key: 'contact',
                        header: 'Contact',
                        render: (customer) => (
                            <div className="space-y-1">
                                {customer.contactPerson && <p>{customer.contactPerson}</p>}

                                {customer.phone && (
                                    <p className="text-sm text-muted-foreground">
                                        {customer.phone}
                                    </p>
                                )}

                                {customer.email && (
                                    <p className="break-all text-sm text-muted-foreground">
                                        {customer.email}
                                    </p>
                                )}

                                {!customer.contactPerson && !customer.phone && !customer.email && (
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
                        render: (customer) => <MasterDataStatus isActive={customer.isActive} />,
                    },
                    {
                        key: 'actions',
                        header: 'Actions',
                        render: (customer) => (
                            <Link
                                prefetch={false}
                                href={applicationHref(
                                    '/app/customers/' + customer.id,
                                    current.organization.id,
                                )}
                                className="font-medium text-primary hover:underline"
                            >
                                {canEdit ? 'Edit' : 'View'}
                                <span className="sr-only"> {customer.name}</span>
                            </Link>
                        ),
                    },
                ];

                const hasQuery = Boolean(parsed.data.search) || parsed.data.isActive !== undefined;

                return (
                    <MasterDataList
                        title="Customers"
                        description="Manage customer records for this organization."
                        caption="Customers"
                        items={result.data}
                        getRowKey={(customer) => customer.id}
                        columns={columns}
                        primaryAction={
                            current.permissions.includes('customer:create')
                                ? {
                                      label: 'Add customer',
                                      href: applicationHref(
                                          '/app/customers/new',
                                          current.organization.id,
                                      ),
                                  }
                                : undefined
                        }
                        search={{
                            action: '/app/customers',
                            organization: current.organization.id,
                            defaultValue: parsed.data.search,
                            placeholder: 'Search customers by name, code or contact...',
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
                                action="/app/customers"
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
                                        htmlFor="customer-status-filter"
                                        className="mb-2 block text-sm font-medium"
                                    >
                                        Status
                                    </label>

                                    <select
                                        id="customer-status-filter"
                                        name="isActive"
                                        defaultValue={search.isActive ?? ''}
                                        className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                                    >
                                        <option value="">All customers</option>
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
                            hasQuery ? 'No customers match this view.' : 'No customers yet.'
                        }
                        emptyDescription={
                            hasQuery
                                ? 'Try changing the search or status filter.'
                                : 'Add your first customer to start building your customer directory.'
                        }
                        pagination={{
                            page: result.meta.page,
                            totalPages: result.meta.totalPages,
                            totalItems: result.meta.totalItems,
                            itemLabel: 'customer',
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
