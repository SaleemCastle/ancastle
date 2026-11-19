'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { postFulfilmentSchema, reverseFulfilmentSchema } from '@ancastle/validation';
import type { ManagementActionState } from '@/lib/management/action-state';
import { postFulfilmentAction, reverseFulfilmentAction } from '@/app/app/orders/fulfilment-actions';

type Line = {
    id: string;
    productName: string;
    kind: 'POULTRY' | 'PRODUCE';
    unit: string;
    remainingQuantity: string;
};
type Source = { id: string; lineId: string; label: string; available: string; unit: string };
type Event = {
    id: string;
    code: string;
    kind: 'POSTING' | 'REVERSAL';
    farmId: string;
    occurredAt: string;
    createdAt: string;
    actorUserId: string;
    note: string | null;
    reference: string | null;
    reversesFulfilmentId: string | null;
    reason?: string;
    postingErrorConfirmed?: true;
    lines: Array<{
        id: string;
        orderLineId: string;
        quantity: string;
        unit: string;
        sourceCode: string;
        reversesLineId: string | null;
    }>;
};

export function FulfilmentPanel({
    organization,
    orderId,
    orderVersion,
    farmId,
    farmName,
    canPost,
    canReverse,
    lines,
    sources,
    history,
    historyPage,
    historyPages,
    historyHref,
}: {
    organization: string;
    orderId: string;
    orderVersion: number;
    farmId: string | null;
    farmName?: string;
    canPost: boolean;
    canReverse: boolean;
    lines: Line[];
    sources: Source[];
    history: Event[];
    historyPage: number;
    historyPages: number;
    historyHref: string;
}) {
    const router = useRouter();
    const [busy, startTransition] = useTransition();
    const [amounts, setAmounts] = useState<Record<string, string>>({});
    const [choices, setChoices] = useState<Record<string, string>>({});
    const [notice, setNotice] = useState<ManagementActionState | null>(null);
    const commandStarted = useRef(false);
    const [pending, setPending] = useState<{
        key: string;
        payload: unknown;
        operation: 'post' | 'reverse';
        fulfilmentId?: string;
    } | null>(null);

    function run(command: NonNullable<typeof pending>) {
        if (commandStarted.current) return;
        const parsed =
            command.operation === 'post'
                ? postFulfilmentSchema.safeParse(command.payload)
                : reverseFulfilmentSchema.safeParse(command.payload);
        if (!parsed.success) {
            setNotice({
                error: 'Correct the highlighted fulfilment values before posting.',
                fields: Object.fromEntries(
                    parsed.error.issues.map((issue) => [
                        String(issue.path[0] ?? '_root'),
                        [issue.message],
                    ]),
                ),
            });
            setPending(null);
            return;
        }
        commandStarted.current = true;
        const form = new FormData();
        form.set('organization', organization);
        form.set('farm', farmId ?? '');
        form.set('orderId', orderId);
        form.set('idempotencyKey', command.key);
        form.set('payload', JSON.stringify(command.payload));
        if (command.fulfilmentId) form.set('fulfilmentId', command.fulfilmentId);
        startTransition(async () => {
            try {
                let result: ManagementActionState;
                try {
                    result =
                        command.operation === 'post'
                            ? await postFulfilmentAction({}, form)
                            : await reverseFulfilmentAction({}, form);
                } catch {
                    result = {
                        error: 'The outcome is unknown. Retry this exact command or reload order and source availability.',
                        outcomeUnknown: true,
                    };
                }
                setNotice(result);
                if (result.refresh) router.refresh();
                if (result.success) {
                    setPending(null);
                    setAmounts({});
                    setChoices({});
                    router.refresh();
                } else if (!result.outcomeUnknown) setPending(null);
            } finally {
                commandStarted.current = false;
            }
        });
    }

    function submit() {
        if (!farmId || pending || busy) return;
        const allocations = lines.flatMap((line) => {
            const quantity = amounts[line.id]?.trim();
            const sourceId = choices[line.id];
            if (!quantity || !sourceId) return [];
            return [
                line.kind === 'POULTRY'
                    ? {
                          orderLineId: line.id,
                          kind: 'POULTRY' as const,
                          flockId: sourceId,
                          quantity,
                      }
                    : {
                          orderLineId: line.id,
                          kind: 'PRODUCE' as const,
                          inventoryItemId: sourceId,
                          quantity,
                      },
            ];
        });
        const payload = {
            expectedOrderVersion: orderVersion,
            occurredAt: new Date().toISOString(),
            allocations,
        };
        const command = { key: crypto.randomUUID(), payload, operation: 'post' as const };
        setPending(command);
        run(command);
    }

    function reverse(event: Event) {
        if (event.kind !== 'POSTING' || !canReverse || !farmId || pending || busy) return;
        const reason = window.prompt(
            `Reverse the entire batch ${event.code}. Enter the required reason:`,
        );
        if (reason === null) return;
        if (
            !window.confirm(
                `Reverse all quantities in ${event.code}? This is a full-batch correction.`,
            )
        )
            return;
        const payload = {
            expectedOrderVersion: orderVersion,
            occurredAt: new Date().toISOString(),
            reason,
            postingErrorConfirmed: true as const,
        };
        const parsed = reverseFulfilmentSchema.safeParse(payload);
        if (!parsed.success) {
            setNotice({ error: 'A valid reason is required for reversal.' });
            return;
        }
        const command = {
            key: crypto.randomUUID(),
            payload: parsed.data,
            operation: 'reverse' as const,
            fulfilmentId: event.id,
        };
        setPending(command);
        run(command);
    }

    const reversedFulfilments = new Set(
        history.flatMap((event) => event.reversesFulfilmentId ?? []),
    );

    return (
        <section
            className="space-y-4 rounded-xl border bg-card p-5"
            aria-label="Physical fulfilment"
        >
            <div>
                <h2 className="text-lg font-semibold">Physical fulfilment</h2>
                <p className="text-sm text-muted-foreground">
                    Availability is a point-in-time read. Posting rechecks source stock and live
                    flock population atomically.
                </p>
            </div>
            {!farmId ? (
                <p>Select an authorized farm to view eligible sources and posting history.</p>
            ) : (
                <>
                    <p className="font-medium">Source farm: {farmName}</p>
                    {canPost && (
                        <div className="space-y-4">
                            {lines
                                .filter((line) => Number(line.remainingQuantity) > 0)
                                .map((line) => {
                                    const options = sources.filter(
                                        (source) => source.lineId === line.id,
                                    );
                                    return (
                                        <div
                                            key={line.id}
                                            className="grid gap-3 rounded-lg border p-3 sm:grid-cols-3"
                                        >
                                            <div>
                                                <p className="font-medium">{line.productName}</p>
                                                <p className="text-sm">
                                                    Remaining {line.remainingQuantity} {line.unit}
                                                </p>
                                            </div>
                                            <label className="space-y-1 text-sm">
                                                Eligible source
                                                <select
                                                    aria-label={`${line.productName} source`}
                                                    value={choices[line.id] ?? ''}
                                                    onChange={(e) =>
                                                        setChoices({
                                                            ...choices,
                                                            [line.id]: e.target.value,
                                                        })
                                                    }
                                                    className="h-11 w-full rounded-md border px-3"
                                                >
                                                    <option value="">Select source</option>
                                                    {options.map((source) => (
                                                        <option key={source.id} value={source.id}>
                                                            {source.label} · available{' '}
                                                            {source.available} {source.unit}
                                                        </option>
                                                    ))}
                                                </select>
                                            </label>
                                            <label className="space-y-1 text-sm">
                                                Quantity ({line.unit})
                                                <input
                                                    aria-label={`${line.productName} quantity`}
                                                    type="number"
                                                    inputMode="decimal"
                                                    min="0.001"
                                                    step={line.unit === 'EACH' ? '1' : '0.001'}
                                                    max={line.remainingQuantity}
                                                    value={amounts[line.id] ?? ''}
                                                    onChange={(e) =>
                                                        setAmounts({
                                                            ...amounts,
                                                            [line.id]: e.target.value,
                                                        })
                                                    }
                                                    className="h-11 w-full rounded-md border px-3"
                                                />
                                            </label>
                                        </div>
                                    );
                                })}
                            <button
                                type="button"
                                disabled={busy || pending !== null}
                                onClick={submit}
                                className="inline-flex min-h-11 rounded-md bg-primary px-4 text-primary-foreground disabled:opacity-50"
                            >
                                {busy ? 'Posting…' : 'Post fulfilment'}
                            </button>
                            {pending && notice?.outcomeUnknown && (
                                <div className="flex gap-3">
                                    <button
                                        type="button"
                                        disabled={busy}
                                        onClick={() => run(pending)}
                                        className="min-h-11 rounded-md border px-4"
                                    >
                                        Retry exact command
                                    </button>
                                    <button
                                        type="button"
                                        disabled={busy}
                                        onClick={() => {
                                            setPending(null);
                                            router.refresh();
                                        }}
                                        className="min-h-11 underline"
                                    >
                                        Reload order and availability
                                    </button>
                                </div>
                            )}
                        </div>
                    )}
                    {!canPost && <p>Read-only: you do not have fulfilment posting permission.</p>}
                    {history.length === 0 ? (
                        <p className="rounded-lg border p-4">
                            No fulfilments are recorded for this authorized farm.
                        </p>
                    ) : (
                        <ol className="space-y-3">
                            {history.map((event) => (
                                <li key={event.id} className="rounded-lg border p-4">
                                    <div className="flex flex-wrap justify-between gap-2">
                                        <strong>
                                            {event.code} · {event.kind}
                                        </strong>
                                        <time dateTime={event.occurredAt}>
                                            {new Date(event.occurredAt).toLocaleString()}
                                        </time>
                                    </div>
                                    {event.reversesFulfilmentId && (
                                        <p>
                                            Reverses posting{' '}
                                            {history.find(
                                                (entry) => entry.id === event.reversesFulfilmentId,
                                            )?.code ?? event.reversesFulfilmentId}
                                        </p>
                                    )}
                                    {event.reason && <p>Reason: {event.reason}</p>}
                                    <ul className="mt-2 list-inside list-disc">
                                        {event.lines.map((line) => (
                                            <li key={line.id}>
                                                {line.sourceCode}: {line.quantity} {line.unit}
                                                {line.reversesLineId
                                                    ? ` · reverses line ${line.reversesLineId}`
                                                    : ''}
                                            </li>
                                        ))}
                                    </ul>
                                    <p className="text-xs text-muted-foreground">
                                        Operator {event.actorUserId} ·{' '}
                                        {event.reference ?? 'No reference'}
                                        {event.note ? ` · ${event.note}` : ''}
                                    </p>
                                    {event.kind === 'POSTING' &&
                                        canReverse &&
                                        !reversedFulfilments.has(event.id) && (
                                            <button
                                                type="button"
                                                disabled={busy || pending !== null}
                                                onClick={() => reverse(event)}
                                                className="mt-3 min-h-11 rounded-md border px-3"
                                            >
                                                Reverse full batch
                                            </button>
                                        )}
                                </li>
                            ))}
                        </ol>
                    )}
                    {historyPages > 1 && (
                        <nav
                            aria-label="Fulfilment history pagination"
                            className="flex flex-wrap items-center gap-4 text-sm"
                        >
                            {historyPage > 1 ? (
                                <Link
                                    className="underline"
                                    href={`${historyHref}&fulfilmentPage=${historyPage - 1}`}
                                >
                                    Previous fulfilments
                                </Link>
                            ) : (
                                <span className="text-muted-foreground">Previous fulfilments</span>
                            )}
                            <span>
                                Page {historyPage} of {historyPages}
                            </span>
                            {historyPage < historyPages ? (
                                <Link
                                    className="underline"
                                    href={`${historyHref}&fulfilmentPage=${historyPage + 1}`}
                                >
                                    Next fulfilments
                                </Link>
                            ) : (
                                <span className="text-muted-foreground">Next fulfilments</span>
                            )}
                        </nav>
                    )}
                </>
            )}
            {notice?.error && (
                <div role="alert" className="rounded-md bg-destructive/10 p-3">
                    <p>
                        {notice.error}
                        {notice.outcomeUnknown ? ' Do not start a new posting command.' : ''}
                    </p>
                    {notice.fields && (
                        <ul className="mt-2 list-inside list-disc">
                            {Object.entries(notice.fields).flatMap(([field, messages]) =>
                                messages.map((message) => (
                                    <li key={`${field}:${message}`}>
                                        {field === '_root' ? message : `${field}: ${message}`}
                                    </li>
                                )),
                            )}
                        </ul>
                    )}
                </div>
            )}
            {notice?.success && <p role="status">{notice.success}</p>}
        </section>
    );
}
