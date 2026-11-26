import type { Metadata } from 'next';
import Link from 'next/link';
import { z } from 'zod';
import {
    eligibleInvoiceFulfilmentsResponseSchema,
    invoiceCustomersResponseSchema,
    invoiceIssuanceStatusResponseSchema,
    invoiceListResponseSchema,
    receivableInvoiceListResponseSchema,
    receivableSummarySchema,
    receivableInvoiceQuerySchema,
} from '@ancastle/validation';
import { ManagementPage } from '@/components/management/page';
import { IssueInvoicePanel } from '@/components/invoices/issue-panel';
import { Button, buttonVariants } from '@/components/ui/button';
import { applicationHref, type ApplicationSearch } from '@/lib/application/selection';
import { managementApi } from '@/lib/management/api';
import { formatJamaicaDate, formatJamaicaInstant, formatJmdAmount } from '@/lib/management/finance';

export const metadata: Metadata = { title: 'Invoices | Ancastle Farms' };

const extraFilters = z
    .object({
        status: z.enum(['UNPAID', 'PARTIALLY_PAID', 'PAID']).optional(),
        overdue: z.enum(['true', 'false']).optional(),
    })
    .strict();

function queryString(values: Record<string, string | number | undefined>) {
    const query = new URLSearchParams();
    Object.entries(values).forEach(([key, value]) => {
        if (value !== undefined && value !== '') query.set(key, String(value));
    });
    return query;
}

function statusLabel(status: string) {
    if (status === 'PAID') return 'Settled';
    if (status === 'PARTIALLY_PAID') return 'Partially settled';
    if (status === 'UNPAID') return 'Unpaid';
    return 'Receivables access required';
}

export default function InvoicesPage({
    searchParams,
}: {
    searchParams: Promise<ApplicationSearch>;
}) {
    return (
        <ManagementPage
            searchParams={searchParams}
            activePath="/app/invoices"
            title="Invoices"
            render={async (context, search) => {
                const current = context.current!;
                if (!current.permissions.includes('invoice:read'))
                    return (
                        <section className="space-y-3">
                            <h1 className="text-2xl font-semibold">Invoices</h1>
                            <p role="alert">
                                You do not have permission to read invoices in this organization.
                            </p>
                        </section>
                    );

                const parsed = receivableInvoiceQuerySchema.safeParse({
                    page: search.page,
                    pageSize: search.pageSize,
                    customerId: search.customerId,
                    search: search.search,
                    issueFrom: search.issueFrom,
                    issueTo: search.issueTo,
                    dueFrom: search.dueFrom,
                    dueTo: search.dueTo,
                    sortBy: search.sortBy,
                    sortDirection: search.sortDirection,
                    status: search.status,
                    overdue: search.overdue,
                });
                if (!parsed.success)
                    return (
                        <section className="space-y-3">
                            <h1 className="text-2xl font-semibold">Invoices</h1>
                            <p role="alert">One or more invoice filters are invalid.</p>
                            <Link
                                className="underline"
                                href={applicationHref('/app/invoices', current.organization.id)}
                            >
                                Clear filters
                            </Link>
                        </section>
                    );
                const extra = extraFilters.safeParse({
                    status: search.status,
                    overdue: search.overdue,
                });
                const receivablesAccess = current.permissions.includes('receivable:read');
                const fields = parsed.data;
                const filterState = {
                    search: fields.search,
                    customerId: fields.customerId,
                    issueFrom: fields.issueFrom,
                    issueTo: fields.issueTo,
                    dueFrom: fields.dueFrom,
                    dueTo: fields.dueTo,
                    sortBy: fields.sortBy,
                    sortDirection: fields.sortDirection,
                    ...(receivablesAccess
                        ? { status: extra.data?.status, overdue: extra.data?.overdue }
                        : {}),
                };
                const customersResult = managementApi(
                    `organizations/${current.organization.id}/invoices/customers`,
                    invoiceCustomersResponseSchema,
                );
                const rowsResult = receivablesAccess
                    ? managementApi(
                          `organizations/${current.organization.id}/receivables/invoices?${queryString(
                              {
                                  page: fields.page,
                                  pageSize: fields.pageSize,
                                  ...filterState,
                              },
                          )}`,
                          receivableInvoiceListResponseSchema,
                      )
                    : managementApi(
                          `organizations/${current.organization.id}/invoices?${queryString({
                              page: fields.page,
                              pageSize: fields.pageSize,
                              ...filterState,
                          })}`,
                          invoiceListResponseSchema,
                      );
                const summaryResult = receivablesAccess
                    ? managementApi(
                          `organizations/${current.organization.id}/receivables/summary`,
                          receivableSummarySchema,
                      )
                    : Promise.resolve(null);
                const [customerResult, rowsResponse, summaryResponse] = await Promise.all([
                    customersResult,
                    rowsResult,
                    summaryResult,
                ]).catch((error) => {
                    throw error;
                });
                type InvoiceListRow = {
                    id: string;
                    invoiceNumber: string;
                    customerName: string;
                    customerId: string;
                    issuedAt: string;
                    dueAt: string;
                    total: string;
                    allocated: string | null;
                    outstanding: string | null;
                    status: string | null;
                    overdue: boolean | null;
                };
                const rows: InvoiceListRow[] = receivablesAccess
                    ? (
                          rowsResponse as Awaited<typeof rowsResult> & {
                              data: Array<{
                                  invoiceId: string;
                                  invoiceNumber: string;
                                  customerName: string;
                                  customerId: string;
                                  issuedAt: string;
                                  dueAt: string;
                                  grossAmount: string;
                                  allocatedAmount: string;
                                  outstandingAmount: string;
                                  status: string;
                                  overdue: boolean;
                              }>;
                          }
                      ).data.map((row) => ({
                          id: row.invoiceId,
                          invoiceNumber: row.invoiceNumber,
                          customerName: row.customerName,
                          customerId: row.customerId,
                          issuedAt: row.issuedAt,
                          dueAt: row.dueAt,
                          total: row.grossAmount,
                          allocated: row.allocatedAmount,
                          outstanding: row.outstandingAmount,
                          status: row.status,
                          overdue: row.overdue,
                      }))
                    : (
                          rowsResponse as Awaited<typeof rowsResult> & {
                              data: Array<{
                                  id: string;
                                  invoiceNumber: string;
                                  customerBillingSnapshot: { name: string };
                                  customerId: string;
                                  issuedAt: string;
                                  dueAt: string;
                                  grossAmount: string;
                              }>;
                          }
                      ).data.map((row) => ({
                          id: row.id,
                          invoiceNumber: row.invoiceNumber,
                          customerName: row.customerBillingSnapshot.name,
                          customerId: row.customerId,
                          issuedAt: row.issuedAt,
                          dueAt: row.dueAt,
                          total: row.grossAmount,
                          allocated: null,
                          outstanding: null,
                          status: null,
                          overdue: null,
                      }));
                const meta = rowsResponse.meta;
                const retained = queryString({
                    ...filterState,
                    pageSize: fields.pageSize !== 20 ? fields.pageSize : undefined,
                });
                const pageHref = (page: number) => {
                    const query = new URLSearchParams(retained);
                    query.set('page', String(page));
                    return `${applicationHref('/app/invoices', current.organization.id)}&${query.toString()}`;
                };
                const canIssue =
                    current.permissions.includes('invoice:issue') &&
                    current.permissions.includes('order:read') &&
                    current.permissions.includes('fulfilment:read');
                let issuePanel = null;
                if (canIssue) {
                    if (!context.farm)
                        issuePanel = (
                            <section className="rounded-2xl border border-border bg-card p-5">
                                <h2 className="font-semibold">Issue from a posted fulfilment</h2>
                                <p className="mt-1 text-sm text-muted-foreground">
                                    Choose an authorized farm in the workspace selector to review
                                    eligible fulfilments.
                                </p>
                            </section>
                        );
                    else {
                        const [status, eligible] = await Promise.all([
                            managementApi(
                                `organizations/${current.organization.id}/invoices/issuance-status`,
                                invoiceIssuanceStatusResponseSchema,
                            ),
                            managementApi(
                                `organizations/${current.organization.id}/invoices/eligible-fulfilments/${context.farm.id}`,
                                eligibleInvoiceFulfilmentsResponseSchema,
                            ),
                        ]);
                        issuePanel = (
                            <IssueInvoicePanel
                                organizationId={current.organization.id}
                                farmId={context.farm.id}
                                candidates={eligible.data}
                                enabled={status.data.enabled}
                                disabledMessage={status.data.message}
                            />
                        );
                    }
                }

                return (
                    <div className="space-y-6">
                        <header className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                                <h1 className="text-2xl font-semibold tracking-tight">Invoices</h1>
                                <p className="mt-1 text-sm text-muted-foreground">
                                    Issued invoices for {current.organization.name}. Invoice records
                                    retain the customer and product details captured at issuance.
                                </p>
                            </div>
                        </header>
                        {summaryResponse && (
                            <section
                                aria-label="Invoice summary"
                                className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
                            >
                                {[
                                    ['Total invoiced', summaryResponse.data.totalInvoiced],
                                    ['Total outstanding', summaryResponse.data.totalOutstanding],
                                    ['Total overdue', summaryResponse.data.totalOverdue],
                                    ['Total settled', summaryResponse.data.totalSettled],
                                ].map(([label, amount]) => (
                                    <article
                                        key={label}
                                        className="rounded-2xl border border-border bg-card p-4"
                                    >
                                        <h2 className="text-sm text-muted-foreground">{label}</h2>
                                        <p className="mt-2 text-xl font-semibold tabular-nums">
                                            {formatJmdAmount(amount)}
                                        </p>
                                        <p className="mt-1 text-xs text-muted-foreground">
                                            Organization-wide · as of{' '}
                                            {formatJamaicaDate(summaryResponse.data.asOfDate)}
                                        </p>
                                    </article>
                                ))}
                            </section>
                        )}
                        {issuePanel}
                        <section className="space-y-4 rounded-2xl border border-border bg-card p-4 sm:p-5">
                            <form
                                action="/app/invoices"
                                role="search"
                                className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
                            >
                                <input
                                    type="hidden"
                                    name="organization"
                                    value={current.organization.id}
                                />
                                <label className="space-y-1 text-sm font-medium sm:col-span-2">
                                    Search
                                    <input
                                        name="search"
                                        type="search"
                                        defaultValue={fields.search ?? ''}
                                        placeholder="Invoice number or customer"
                                        className="h-10 w-full rounded-md border border-input bg-background px-3 font-normal"
                                    />
                                </label>
                                <label className="space-y-1 text-sm font-medium">
                                    Customer
                                    <select
                                        name="customerId"
                                        defaultValue={fields.customerId ?? ''}
                                        className="h-10 w-full rounded-md border border-input bg-background px-3 font-normal"
                                    >
                                        <option value="">All customers</option>
                                        {customerResult.data.map((customer) => (
                                            <option
                                                key={customer.customerId}
                                                value={customer.customerId}
                                            >
                                                {customer.customerName}
                                            </option>
                                        ))}
                                    </select>
                                </label>
                                <label className="space-y-1 text-sm font-medium">
                                    Settlement status
                                    <select
                                        name="status"
                                        defaultValue={
                                            receivablesAccess ? (extra.data?.status ?? '') : ''
                                        }
                                        disabled={!receivablesAccess}
                                        className="h-10 w-full rounded-md border border-input bg-background px-3 font-normal"
                                    >
                                        <option value="">All statuses</option>
                                        <option value="UNPAID">Unpaid</option>
                                        <option value="PARTIALLY_PAID">Partially settled</option>
                                        <option value="PAID">Settled</option>
                                    </select>
                                </label>
                                <label className="space-y-1 text-sm font-medium">
                                    Issue date from
                                    <input
                                        type="date"
                                        name="issueFrom"
                                        defaultValue={fields.issueFrom ?? ''}
                                        className="h-10 w-full rounded-md border border-input bg-background px-3 font-normal"
                                    />
                                </label>
                                <label className="space-y-1 text-sm font-medium">
                                    Issue date to
                                    <input
                                        type="date"
                                        name="issueTo"
                                        defaultValue={fields.issueTo ?? ''}
                                        className="h-10 w-full rounded-md border border-input bg-background px-3 font-normal"
                                    />
                                </label>
                                <label className="space-y-1 text-sm font-medium">
                                    Due date from
                                    <input
                                        type="date"
                                        name="dueFrom"
                                        defaultValue={fields.dueFrom ?? ''}
                                        className="h-10 w-full rounded-md border border-input bg-background px-3 font-normal"
                                    />
                                </label>
                                <label className="space-y-1 text-sm font-medium">
                                    Due date to
                                    <input
                                        type="date"
                                        name="dueTo"
                                        defaultValue={fields.dueTo ?? ''}
                                        className="h-10 w-full rounded-md border border-input bg-background px-3 font-normal"
                                    />
                                </label>
                                <label className="space-y-1 text-sm font-medium">
                                    Overdue
                                    <select
                                        name="overdue"
                                        disabled={!receivablesAccess}
                                        defaultValue={
                                            receivablesAccess ? (extra.data?.overdue ?? '') : ''
                                        }
                                        className="h-10 w-full rounded-md border border-input bg-background px-3 font-normal"
                                    >
                                        <option value="">Any</option>
                                        <option value="true">Overdue</option>
                                        <option value="false">Not overdue</option>
                                    </select>
                                </label>
                                <label className="space-y-1 text-sm font-medium">
                                    Sort by
                                    <select
                                        name="sortBy"
                                        defaultValue={fields.sortBy}
                                        className="h-10 w-full rounded-md border border-input bg-background px-3 font-normal"
                                    >
                                        <option value="issuedAt">Issue date</option>
                                        <option value="dueAt">Due date</option>
                                        <option value="invoiceNumber">Invoice number</option>
                                    </select>
                                </label>
                                <label className="space-y-1 text-sm font-medium">
                                    Direction
                                    <select
                                        name="sortDirection"
                                        defaultValue={fields.sortDirection}
                                        className="h-10 w-full rounded-md border border-input bg-background px-3 font-normal"
                                    >
                                        <option value="desc">Descending</option>
                                        <option value="asc">Ascending</option>
                                    </select>
                                </label>
                                <input type="hidden" name="pageSize" value={fields.pageSize} />
                                <div className="flex items-end gap-2 sm:col-span-2 xl:col-span-4">
                                    <Button type="submit" variant="outline">
                                        Apply filters
                                    </Button>
                                    <Link
                                        className={buttonVariants({ variant: 'ghost' })}
                                        href={applicationHref(
                                            '/app/invoices',
                                            current.organization.id,
                                        )}
                                    >
                                        Clear filters
                                    </Link>
                                </div>
                                {!receivablesAccess && (
                                    <p className="text-xs text-muted-foreground sm:col-span-2 xl:col-span-4">
                                        Settlement and overdue filters are available to users with
                                        receivables access.
                                    </p>
                                )}
                            </form>
                            {rows.length === 0 ? (
                                <div className="rounded-xl border border-dashed p-8 text-center">
                                    <h2 className="font-semibold">No invoices found</h2>
                                    <p className="mt-1 text-sm text-muted-foreground">
                                        Adjust the filters or clear them to see other invoices.
                                    </p>
                                </div>
                            ) : (
                                <>
                                    <div className="hidden overflow-x-auto md:block">
                                        <table className="w-full min-w-[920px] text-left text-sm">
                                            <caption className="sr-only">
                                                Invoices and receivables
                                            </caption>
                                            <thead className="border-b text-xs uppercase tracking-wide text-muted-foreground">
                                                <tr>
                                                    <th className="p-3">Invoice</th>
                                                    <th className="p-3">Customer</th>
                                                    <th className="p-3">Issue date</th>
                                                    <th className="p-3">Due date</th>
                                                    <th className="p-3 text-right">
                                                        Invoice total
                                                    </th>
                                                    <th className="p-3 text-right">Allocated</th>
                                                    <th className="p-3 text-right">Outstanding</th>
                                                    <th className="p-3">Settlement</th>
                                                    <th className="p-3">Due status</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {rows.map((row) => (
                                                    <tr
                                                        key={row.id}
                                                        className="border-b last:border-0"
                                                    >
                                                        <td className="p-3">
                                                            <Link
                                                                prefetch={false}
                                                                className="font-semibold underline"
                                                                href={applicationHref(
                                                                    `/app/invoices/${row.id}`,
                                                                    current.organization.id,
                                                                )}
                                                            >
                                                                {row.invoiceNumber}
                                                            </Link>
                                                        </td>
                                                        <td className="p-3">
                                                            {row.customerName ||
                                                                'Name not captured'}
                                                        </td>
                                                        <td className="p-3">
                                                            {formatJamaicaInstant(row.issuedAt)}
                                                        </td>
                                                        <td className="p-3">
                                                            {formatJamaicaDate(row.dueAt)}
                                                        </td>
                                                        <td className="p-3 text-right tabular-nums">
                                                            {formatJmdAmount(row.total)}
                                                        </td>
                                                        <td className="p-3 text-right tabular-nums">
                                                            {row.allocated !== null
                                                                ? formatJmdAmount(row.allocated)
                                                                : 'Restricted'}
                                                        </td>
                                                        <td className="p-3 text-right tabular-nums">
                                                            {row.outstanding !== null
                                                                ? formatJmdAmount(row.outstanding)
                                                                : 'Restricted'}
                                                        </td>
                                                        <td className="p-3">
                                                            <span className="rounded-full border px-2 py-1 text-xs">
                                                                {statusLabel(row.status ?? '')}
                                                            </span>
                                                        </td>
                                                        <td className="p-3">
                                                            {row.overdue === null ? (
                                                                'Restricted'
                                                            ) : row.overdue ? (
                                                                <span className="font-medium text-destructive">
                                                                    Overdue
                                                                </span>
                                                            ) : (
                                                                <span>Not overdue</span>
                                                            )}
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                    <ul className="space-y-3 md:hidden">
                                        {rows.map((row) => (
                                            <li key={row.id} className="rounded-xl border p-4">
                                                <div className="flex items-start justify-between gap-3">
                                                    <div>
                                                        <Link
                                                            prefetch={false}
                                                            className="font-semibold underline"
                                                            href={applicationHref(
                                                                `/app/invoices/${row.id}`,
                                                                current.organization.id,
                                                            )}
                                                        >
                                                            {row.invoiceNumber}
                                                        </Link>
                                                        <p className="mt-1 text-sm">
                                                            {row.customerName ||
                                                                'Name not captured'}
                                                        </p>
                                                    </div>
                                                    <span className="rounded-full border px-2 py-1 text-xs">
                                                        {statusLabel(row.status ?? '')}
                                                    </span>
                                                </div>
                                                <dl className="mt-4 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
                                                    <dt className="text-muted-foreground">
                                                        Issue date
                                                    </dt>
                                                    <dd className="text-right">
                                                        {formatJamaicaInstant(row.issuedAt)}
                                                    </dd>
                                                    <dt className="text-muted-foreground">
                                                        Due date
                                                    </dt>
                                                    <dd className="text-right">
                                                        {formatJamaicaDate(row.dueAt)}
                                                    </dd>
                                                    <dt className="text-muted-foreground">
                                                        Invoice total
                                                    </dt>
                                                    <dd className="text-right tabular-nums">
                                                        {formatJmdAmount(row.total)}
                                                    </dd>
                                                    <dt className="text-muted-foreground">
                                                        Allocated
                                                    </dt>
                                                    <dd className="text-right tabular-nums">
                                                        {row.allocated !== null
                                                            ? formatJmdAmount(row.allocated)
                                                            : 'Restricted'}
                                                    </dd>
                                                    <dt className="text-muted-foreground">
                                                        Outstanding
                                                    </dt>
                                                    <dd className="text-right tabular-nums">
                                                        {row.outstanding !== null
                                                            ? formatJmdAmount(row.outstanding)
                                                            : 'Restricted'}
                                                    </dd>
                                                    <dt className="text-muted-foreground">
                                                        Due status
                                                    </dt>
                                                    <dd className="text-right">
                                                        {row.overdue === null
                                                            ? 'Restricted'
                                                            : row.overdue
                                                              ? 'Overdue'
                                                              : 'Not overdue'}
                                                    </dd>
                                                </dl>
                                            </li>
                                        ))}
                                    </ul>
                                    <nav
                                        aria-label="Invoice pages"
                                        className="flex flex-wrap items-center justify-between gap-3 border-t pt-4 text-sm"
                                    >
                                        <p>
                                            {meta.totalItems}{' '}
                                            {meta.totalItems === 1 ? 'invoice' : 'invoices'} · page{' '}
                                            {meta.page} of {Math.max(meta.totalPages, 1)}
                                        </p>
                                        <div className="flex gap-2">
                                            {meta.page > 1 && (
                                                <Link
                                                    className={buttonVariants({
                                                        variant: 'outline',
                                                    })}
                                                    href={pageHref(meta.page - 1)}
                                                >
                                                    Previous
                                                </Link>
                                            )}
                                            {meta.page < meta.totalPages && (
                                                <Link
                                                    className={buttonVariants({
                                                        variant: 'outline',
                                                    })}
                                                    href={pageHref(meta.page + 1)}
                                                >
                                                    Next
                                                </Link>
                                            )}
                                        </div>
                                    </nav>
                                </>
                            )}
                        </section>
                    </div>
                );
            }}
        />
    );
}
