import type { ReactNode } from 'react';
import Link from 'next/link';
import type { PaginatedResponse } from '@ancastle/types';
import type { loadPoultryOperations } from '@/lib/management/poultry-api';
import { applicationHref } from '@/lib/application/selection';
import { buttonVariants } from '@/components/ui/button';

type Operations = Awaited<ReturnType<typeof loadPoultryOperations>>;

function HistoryTable({
    title,
    headers,
    rows,
    meta,
    pageHref,
}: {
    title: string;
    headers: string[];
    rows: { id: string; cells: ReactNode[] }[];
    meta: PaginatedResponse<unknown>['meta'];
    pageHref: (page: number) => string;
}) {
    return (
        <section aria-label={title} className="min-w-0 space-y-4">
            <h2 className="text-lg font-semibold">{title}</h2>
            {rows.length ? (
                <div className="max-w-full overflow-x-auto rounded-xl border bg-card">
                    <table className="w-full text-left text-sm">
                        <caption className="sr-only">{title}</caption>
                        <thead className="border-b bg-muted/50">
                            <tr>
                                {headers.map((header) => (
                                    <th
                                        key={header}
                                        scope="col"
                                        className="whitespace-nowrap px-4 py-3 font-medium"
                                    >
                                        {header}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((row) => (
                                <tr key={row.id} className="border-b align-top last:border-b-0">
                                    {row.cells.map((cell, index) => (
                                        <td
                                            key={headers[index]}
                                            className="max-w-xs whitespace-pre-wrap wrap-break-word px-4 py-3"
                                        >
                                            {cell}
                                        </td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            ) : (
                <p className="rounded-xl border bg-card p-5 text-sm text-muted-foreground">
                    {meta.page > 1
                        ? 'No records on this page. Return to the first page.'
                        : `No ${title.toLowerCase()} recorded.`}
                </p>
            )}
            <nav
                aria-label={`${title} pagination`}
                className="flex flex-wrap items-center justify-between gap-3 text-sm"
            >
                <p className="text-muted-foreground">
                    {meta.totalItems} records · Page {meta.page} of {Math.max(1, meta.totalPages)}
                </p>
                <div className="flex flex-wrap gap-2">
                    {meta.page > 1 && (
                        <>
                            <Link
                                prefetch={false}
                                href={pageHref(1)}
                                className={buttonVariants({ variant: 'outline' })}
                            >
                                First
                            </Link>
                            <Link
                                prefetch={false}
                                href={pageHref(meta.page - 1)}
                                className={buttonVariants({ variant: 'outline' })}
                            >
                                Previous
                            </Link>
                        </>
                    )}
                    {meta.page < meta.totalPages && (
                        <Link
                            prefetch={false}
                            href={pageHref(meta.page + 1)}
                            className={buttonVariants({ variant: 'outline' })}
                        >
                            Next
                        </Link>
                    )}
                </div>
            </nav>
        </section>
    );
}

function occurred(value: string) {
    return (
        new Intl.DateTimeFormat('en-JM', {
            dateStyle: 'medium',
            timeStyle: 'short',
            timeZone: 'UTC',
        }).format(new Date(value)) + ' UTC'
    );
}

export function PoultryHistory({
    organization,
    farm,
    flockId,
    operations,
}: {
    organization: string;
    farm: string;
    flockId: string;
    operations: Operations;
}) {
    const { mortality, feed, items } = operations;
    const pageHref = (kind: 'mortalityPage' | 'feedPage', page: number) => {
        const query = new URLSearchParams({
            mortalityPage: String(mortality.meta.page),
            feedPage: String(feed.meta.page),
            historyPageSize: String(mortality.meta.pageSize),
        });
        query.set(kind, String(page));
        return (
            applicationHref(`/app/flocks/${flockId}`, organization, farm) +
            '&' +
            query +
            '#operational-history'
        );
    };
    return (
        <div id="operational-history" className="mt-8 min-w-0 space-y-8">
            <p className="text-sm text-muted-foreground">
                Operational history is append-only. Original and reversal records remain visible. A
                reversal compensates an earlier posting; it does not erase it.
            </p>
            <HistoryTable
                title="Mortality history"
                headers={['Occurred at', 'Deaths', 'Actor', 'Cause', 'Reference', 'Note', 'Record']}
                meta={mortality.meta}
                pageHref={(page) => pageHref('mortalityPage', page)}
                rows={mortality.data.map((entry) => ({
                    id: entry.id,
                    cells: [
                        occurred(entry.occurredAt),
                        entry.deathCount,
                        entry.actorUserId,
                        entry.cause ?? '—',
                        entry.reference ?? '—',
                        entry.note ?? '—',
                        <div key="record" className="min-w-44 text-xs">
                            <p>
                                {entry.reversesEventId
                                    ? `Reversal of ${entry.reversesEventId}`
                                    : 'Mortality posting'}
                            </p>
                            <p className="mt-1 text-muted-foreground">ID: {entry.id}</p>
                        </div>,
                    ],
                }))}
            />
            <HistoryTable
                title="Feed usage history"
                headers={[
                    'Occurred at',
                    'Feed item',
                    'Quantity',
                    'Actor',
                    'Reference',
                    'Note',
                    'Record',
                ]}
                meta={feed.meta}
                pageHref={(page) => pageHref('feedPage', page)}
                rows={feed.data.map((entry) => {
                    const item = items.get(entry.inventoryItemId);
                    return {
                        id: entry.id,
                        cells: [
                            occurred(entry.occurredAt),
                            item
                                ? `${item.code} · ${item.name}`
                                : `Feed item ${entry.inventoryItemId}`,
                            `${entry.quantity}${item ? ' ' + item.unit : ''}`,
                            entry.actorUserId,
                            entry.reference ?? '—',
                            entry.note ?? '—',
                            <div key="record" className="min-w-44 text-xs">
                                <p>
                                    {entry.reversesUsageId
                                        ? `Reversal of ${entry.reversesUsageId}`
                                        : 'Feed consumption'}
                                </p>
                                <p className="mt-1 text-muted-foreground">ID: {entry.id}</p>
                            </div>,
                        ],
                    };
                })}
            />
        </div>
    );
}
