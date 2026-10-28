import type { ReactNode } from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';

export interface MasterDataColumn<T> {
    key: string;
    header: string;
    render: (item: T) => ReactNode;
    className?: string;
}

export interface MasterDataPagination {
    page: number;
    totalPages: number;
    totalItems: number;
    itemLabel: string;
    previousHref?: string;
    nextHref?: string;
}

export interface MasterDataAction {
    label: string;
    href: string;
}

interface MasterDataListProps<T> {
    title: string;
    description?: string;
    caption: string;

    items: T[];
    getRowKey: (item: T) => string;
    columns: readonly MasterDataColumn<T>[];

    primaryAction?: MasterDataAction;

    search?: {
        action: string;
        organization: string;
        defaultValue?: string;
        placeholder?: string;
        pageSize?: number;
        hiddenFields?: Record<string, string | number | undefined>;
    };

    filters?: ReactNode;

    emptyTitle: string;
    emptyDescription?: string;

    pagination: MasterDataPagination;
    loading?: boolean;
    error?: string;
}

export function MasterDataStatus({ isActive }: { isActive: boolean }) {
    return (
        <span
            data-testid="customer-status"
            role="status"
            aria-label={`Status: ${isActive ? 'Active' : 'Inactive'}`}
            className={
                isActive
                    ? 'inline-flex rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-800'
                    : 'inline-flex rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground'
            }
        >
            {isActive ? 'Active' : 'Inactive'}
        </span>
    );
}

export function MasterDataList<T>({
    title,
    description,
    caption,
    items,
    getRowKey,
    columns,
    primaryAction,
    search,
    filters,
    emptyTitle,
    emptyDescription,
    pagination,
    loading,
    error,
}: MasterDataListProps<T>) {
    const totalPages = Math.max(1, pagination.totalPages);

    return (
        <div className="space-y-6">
            <header className="flex flex-wrap items-start justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
                    {description && (
                        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
                    )}
                </div>

                {primaryAction && (
                    <Link prefetch={false} href={primaryAction.href} className={buttonVariants()}>
                        {primaryAction.label}
                    </Link>
                )}
            </header>

            {(search || filters) && (
                <div className="rounded-2xl border border-border/80 bg-card p-4 shadow-sm">
                    <div className="flex flex-wrap items-end gap-3">
                        {search && (
                            <form
                                action={search.action}
                                role="search"
                                className="flex min-w-0 flex-1 flex-wrap items-end gap-3"
                            >
                                <input
                                    type="hidden"
                                    name="organization"
                                    value={search.organization}
                                />

                                {search.pageSize !== undefined && (
                                    <input type="hidden" name="pageSize" value={search.pageSize} />
                                )}

                                {Object.entries(search.hiddenFields ?? {}).map(
                                    ([name, value]) =>
                                        value !== undefined && (
                                            <input
                                                key={name}
                                                type="hidden"
                                                name={name}
                                                value={String(value)}
                                            />
                                        ),
                                )}

                                <div className="min-w-56 flex-1">
                                    <label
                                        htmlFor="master-data-search"
                                        className="mb-2 block text-sm font-medium"
                                    >
                                        Search
                                    </label>

                                    <div className="relative">
                                        <Search
                                            aria-hidden="true"
                                            className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                                        />
                                        <input
                                            id="master-data-search"
                                            name="search"
                                            type="search"
                                            defaultValue={search.defaultValue}
                                            placeholder={search.placeholder ?? 'Search records'}
                                            className="h-10 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm outline-none transition focus-visible:ring-2 focus-visible:ring-ring"
                                        />
                                    </div>
                                </div>

                                <Button type="submit" variant="outline" className="h-10">
                                    Search
                                </Button>
                            </form>
                        )}

                        {filters}
                    </div>
                </div>
            )}

            {loading ? (
                <div
                    role="status"
                    aria-live="polite"
                    className="rounded-2xl border border-border/80 bg-card px-6 py-12 text-center shadow-sm"
                >
                    <p className="font-medium">Loading {title.toLowerCase()}…</p>
                    <p className="mt-2 text-sm text-muted-foreground">
                        Please wait while the records are loaded.
                    </p>
                </div>
            ) : error ? (
                <div
                    role="alert"
                    className="rounded-2xl border border-destructive/30 bg-destructive/5 px-6 py-8"
                >
                    <p className="font-medium text-destructive">
                        Unable to load {title.toLowerCase()}
                    </p>
                    <p className="mt-2 text-sm text-muted-foreground">{error}</p>
                </div>
            ) : items.length > 0 ? (
                <div className="overflow-hidden rounded-2xl border border-border/80 bg-card shadow-sm">
                    <div className="max-w-full overflow-x-auto">
                        <table className="w-full text-left text-sm">
                            <caption className="sr-only">{caption}</caption>

                            <thead className="border-b bg-muted/50 text-muted-foreground">
                                <tr>
                                    {columns.map((column) => (
                                        <th
                                            key={column.key}
                                            scope="col"
                                            className={`whitespace-nowrap p-3 font-medium ${column.className ?? ''}`}
                                        >
                                            {column.header}
                                        </th>
                                    ))}
                                </tr>
                            </thead>

                            <tbody className="divide-y divide-border/80">
                                {items.map((item) => (
                                    <tr
                                        key={getRowKey(item)}
                                        className="transition-colors hover:bg-muted/40"
                                    >
                                        {columns.map((column) => (
                                            <td
                                                key={column.key}
                                                className={`p-3 align-middle ${column.className ?? ''}`}
                                            >
                                                {column.render(item)}
                                            </td>
                                        ))}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            ) : (
                <div className="rounded-2xl border border-dashed border-border bg-card px-6 py-12 text-center">
                    <p className="font-medium">{emptyTitle}</p>

                    {emptyDescription && (
                        <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
                            {emptyDescription}
                        </p>
                    )}
                </div>
            )}
            {!loading && !error && (
                <nav
                    aria-label={`${title} pagination`}
                    className="flex flex-wrap items-center justify-between gap-4 text-sm"
                >
                    <p className="text-muted-foreground">
                        {pagination.totalItems}{' '}
                        {pagination.totalItems === 1
                            ? pagination.itemLabel
                            : `${pagination.itemLabel}s`}{' '}
                        · Page {pagination.page} of {totalPages}
                    </p>

                    <div className="flex items-center gap-2">
                        {pagination.previousHref ? (
                            <Link
                                prefetch={false}
                                href={pagination.previousHref}
                                aria-label={`Previous ${pagination.itemLabel} page`}
                                className={buttonVariants({ variant: 'outline' })}
                            >
                                <ChevronLeft aria-hidden="true" />
                                Previous
                            </Link>
                        ) : (
                            <Button variant="outline" disabled>
                                <ChevronLeft aria-hidden="true" />
                                Previous
                            </Button>
                        )}

                        {pagination.nextHref ? (
                            <Link
                                prefetch={false}
                                href={pagination.nextHref}
                                aria-label={`Next ${pagination.itemLabel} page`}
                                className={buttonVariants({ variant: 'outline' })}
                            >
                                Next
                                <ChevronRight aria-hidden="true" />
                            </Link>
                        ) : (
                            <Button variant="outline" disabled>
                                Next
                                <ChevronRight aria-hidden="true" />
                            </Button>
                        )}
                    </div>
                </nav>
            )}
        </div>
    );
}
