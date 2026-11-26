'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import type { ManagementActionState } from '@/lib/management/action-state';
import { formatJamaicaInstant, formatJmdAmount } from '@/lib/management/finance';
import { issueInvoiceAction } from '@/app/app/invoices/actions';

export interface EligibleFulfilment {
    id: string;
    code: string;
    orderId: string;
    customerName: string;
    occurredAt: string;
    grossAmount: string;
}

export function IssueInvoicePanel({
    organizationId,
    farmId,
    candidates,
    enabled,
    disabledMessage,
}: {
    organizationId: string;
    farmId: string;
    candidates: EligibleFulfilment[];
    enabled: boolean;
    disabledMessage: string | null;
}) {
    const [state, action, pending] = useActionState<ManagementActionState, FormData>(
        issueInvoiceAction,
        {},
    );
    const [selectedId, setSelectedId] = useState('');
    const [commandKey, setCommandKey] = useState('');
    const dialog = useRef<HTMLDialogElement>(null);
    const completedInvoiceId = useRef<string | null>(null);
    const router = useRouter();
    const selected = candidates.find((candidate) => candidate.id === selectedId);

    useEffect(() => {
        if (state.success && state.resourceId && completedInvoiceId.current !== state.resourceId) {
            completedInvoiceId.current = state.resourceId;
            dialog.current?.close();
            if (selectedId)
                sessionStorage.removeItem(
                    `invoice-issue:${organizationId}:${farmId}:${selectedId}`,
                );
            setSelectedId('');
            setCommandKey('');
            router.refresh();
        }
    }, [state.success, state.resourceId, selectedId, organizationId, farmId, router]);

    function chooseFulfilment(value: string) {
        setSelectedId(value);
        const storageKey = `invoice-issue:${organizationId}:${farmId}:${value}`;
        if (value) {
            const existing = sessionStorage.getItem(storageKey);
            const key = existing ?? crypto.randomUUID();
            if (!existing) sessionStorage.setItem(storageKey, key);
            setCommandKey(key);
        } else setCommandKey('');
    }

    return (
        <section
            aria-labelledby="issue-invoice-heading"
            className="space-y-3 rounded-2xl border border-border bg-card p-5"
        >
            <div>
                <h2 id="issue-invoice-heading" className="text-lg font-semibold">
                    Issue from a posted fulfilment
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                    Issuance is a financial action. Review the source and confirm before submitting.
                </p>
            </div>
            {!enabled ? (
                <p role="status" className="rounded-xl bg-muted p-3 text-sm">
                    {disabledMessage ?? 'Invoice issuance is disabled by this deployment.'}
                </p>
            ) : candidates.length === 0 ? (
                <p className="rounded-xl bg-muted p-3 text-sm">
                    No posted, uninvoiced fulfilments are available for this farm.
                </p>
            ) : (
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                    <label
                        className="min-w-0 flex-1 space-y-2 text-sm font-medium"
                        htmlFor="eligible-fulfilment"
                    >
                        Eligible fulfilment
                        <select
                            id="eligible-fulfilment"
                            value={selectedId}
                            onChange={(event) => chooseFulfilment(event.target.value)}
                            className="h-10 w-full rounded-md border border-input bg-background px-3 font-normal"
                        >
                            <option value="">Choose a fulfilment</option>
                            {candidates.map((candidate) => (
                                <option key={candidate.id} value={candidate.id}>
                                    {candidate.code} · {candidate.customerName}
                                </option>
                            ))}
                        </select>
                    </label>
                    <Button
                        type="button"
                        variant="outline"
                        disabled={!selected}
                        onClick={() => dialog.current?.showModal()}
                    >
                        Review issuance
                    </Button>
                </div>
            )}
            {state.error && (
                <p role="alert" className="text-sm text-destructive">
                    {state.error}
                </p>
            )}
            {state.success && (
                <p role="status" className="text-sm text-emerald-800">
                    {state.success}
                </p>
            )}
            <dialog
                ref={dialog}
                aria-labelledby="confirm-issue-title"
                className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-2xl border border-border bg-background p-0 text-foreground shadow-xl backdrop:bg-black/40"
            >
                {selected && (
                    <form action={action} className="space-y-5 p-6">
                        <input type="hidden" name="organization" value={organizationId} />
                        <input type="hidden" name="fulfilment" value={selected.id} />
                        <input type="hidden" name="orderId" value={selected.orderId} />
                        <input type="hidden" name="commandKey" value={commandKey} />
                        <div>
                            <h3 id="confirm-issue-title" className="text-lg font-semibold">
                                Confirm invoice issuance
                            </h3>
                            <p className="mt-2 text-sm text-muted-foreground">
                                This will issue an invoice from the posted fulfilment. The server
                                will validate current eligibility and the approved tax policy.
                            </p>
                        </div>
                        <dl className="grid grid-cols-2 gap-3 rounded-xl bg-muted p-4 text-sm">
                            <dt>Fulfilment</dt>
                            <dd className="text-right font-medium">{selected.code}</dd>
                            <dt>Customer snapshot</dt>
                            <dd className="text-right font-medium">{selected.customerName}</dd>
                            <dt>Source order</dt>
                            <dd className="text-right font-medium">{selected.orderId}</dd>
                            <dt>Server preview total</dt>
                            <dd className="text-right font-medium">
                                {formatJmdAmount(selected.grossAmount)}
                            </dd>
                            <dt>Fulfilled date</dt>
                            <dd className="text-right font-medium">
                                {formatJamaicaInstant(selected.occurredAt)}
                            </dd>
                        </dl>
                        <label className="flex items-start gap-3 text-sm">
                            <input
                                required
                                name="confirmed"
                                value="true"
                                type="checkbox"
                                className="mt-1 size-4 accent-primary"
                            />
                            <span>
                                I have reviewed this fulfilment and authorize issuing its invoice.
                            </span>
                        </label>
                        <div className="flex flex-col-reverse justify-end gap-2 sm:flex-row">
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() => dialog.current?.close()}
                            >
                                Cancel
                            </Button>
                            <Button type="submit" disabled={pending}>
                                {pending ? 'Issuing…' : 'Issue invoice'}
                            </Button>
                        </div>
                    </form>
                )}
            </dialog>
        </section>
    );
}
