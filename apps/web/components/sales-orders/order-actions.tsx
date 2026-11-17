'use client';

import { useActionState, useEffect, useRef, useState, type RefObject } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import type { ManagementActionState } from '@/lib/management/action-state';
import { cancelOrderAction, confirmOrderAction } from '@/app/app/orders/actions';

function useDialogKeyboard(
    open: boolean,
    setOpen: (open: boolean) => void,
    dialogRef: RefObject<HTMLDivElement | null>,
    triggerRef: RefObject<HTMLButtonElement | null>,
) {
    useEffect(() => {
        if (!open) return;
        const dialog = dialogRef.current;
        const trigger = triggerRef.current;
        dialog
            ?.querySelector<HTMLElement>(
                'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled)',
            )
            ?.focus();
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                setOpen(false);
                return;
            }
            if (event.key !== 'Tab' || !dialog) return;
            const focusable = Array.from(
                dialog.querySelectorAll<HTMLElement>(
                    'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])',
                ),
            );
            if (focusable.length === 0) {
                event.preventDefault();
                return;
            }
            const first = focusable[0]!;
            const last = focusable[focusable.length - 1]!;
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        };
        dialog?.addEventListener('keydown', onKeyDown);
        return () => {
            dialog?.removeEventListener('keydown', onKeyDown);
            trigger?.focus();
        };
    }, [dialogRef, open, setOpen, triggerRef]);
}

export function OrderActions({
    organization,
    orderId,
    version,
    canConfirm,
    canCancel,
}: {
    organization: string;
    orderId: string;
    version: number;
    canConfirm: boolean;
    canCancel: boolean;
}) {
    const router = useRouter();
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [cancelOpen, setCancelOpen] = useState(false);
    const confirmTriggerRef = useRef<HTMLButtonElement>(null);
    const cancelTriggerRef = useRef<HTMLButtonElement>(null);
    const confirmDialogRef = useRef<HTMLDivElement>(null);
    const cancelDialogRef = useRef<HTMLDivElement>(null);
    useDialogKeyboard(confirmOpen, setConfirmOpen, confirmDialogRef, confirmTriggerRef);
    useDialogKeyboard(cancelOpen, setCancelOpen, cancelDialogRef, cancelTriggerRef);
    const [confirmState, confirmSubmit, confirmPending] = useActionState<
        ManagementActionState,
        FormData
    >(async (previous, form) => {
        const result = await confirmOrderAction(previous, form);
        if (result.success) router.refresh();
        return result;
    }, {});
    const [cancelState, cancelSubmit, cancelPending] = useActionState<
        ManagementActionState,
        FormData
    >(async (previous, form) => {
        const result = await cancelOrderAction(previous, form);
        if (result.success) router.refresh();
        return result;
    }, {});

    return (
        <section aria-label="Order actions" className="flex flex-wrap gap-3">
            {canConfirm && (
                <>
                    <Button
                        type="button"
                        ref={confirmTriggerRef}
                        disabled={Boolean(confirmState.success)}
                        onClick={() => setConfirmOpen(true)}
                    >
                        Confirm order
                    </Button>
                    {confirmOpen && (
                        <div
                            ref={confirmDialogRef}
                            role="dialog"
                            aria-modal="true"
                            aria-labelledby="confirm-order-title"
                            className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4"
                        >
                            <section className="w-full max-w-lg space-y-4 rounded-xl bg-background p-6 shadow-xl">
                                <h2 id="confirm-order-title" className="text-xl font-semibold">
                                    Confirm this order?
                                </h2>
                                <p>
                                    Confirmation freezes the current customer, quantities, prices,
                                    and commercial terms.
                                </p>
                                <p className="rounded-md bg-muted p-3 text-sm">
                                    Confirmation does not reserve produce stock or live birds.
                                    Availability is checked separately when a fulfilment is posted.
                                </p>
                                {confirmState.error && (
                                    <p role="alert" className="text-sm text-destructive">
                                        {confirmState.error}
                                    </p>
                                )}
                                {confirmState.success && (
                                    <p role="status">{confirmState.success}</p>
                                )}
                                <form action={confirmSubmit} className="flex flex-wrap gap-3">
                                    <input type="hidden" name="organization" value={organization} />
                                    <input type="hidden" name="orderId" value={orderId} />
                                    <input
                                        type="hidden"
                                        name="expectedOrderVersion"
                                        value={version}
                                    />
                                    <Button
                                        type="submit"
                                        autoFocus
                                        disabled={confirmPending || Boolean(confirmState.success)}
                                    >
                                        {confirmPending ? 'Confirming…' : 'Confirm order'}
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        disabled={confirmPending}
                                        onClick={() => setConfirmOpen(false)}
                                    >
                                        Go back
                                    </Button>
                                </form>
                            </section>
                        </div>
                    )}
                </>
            )}
            {canCancel && (
                <>
                    <Button
                        type="button"
                        variant="outline"
                        ref={cancelTriggerRef}
                        disabled={Boolean(cancelState.success)}
                        onClick={() => setCancelOpen(true)}
                    >
                        Cancel order
                    </Button>
                    {cancelOpen && (
                        <div
                            ref={cancelDialogRef}
                            role="dialog"
                            aria-modal="true"
                            aria-labelledby="cancel-order-title"
                            className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4"
                        >
                            <section className="w-full max-w-lg space-y-4 rounded-xl bg-background p-6 shadow-xl">
                                <h2 id="cancel-order-title" className="text-xl font-semibold">
                                    Cancel this order?
                                </h2>
                                <p>
                                    Cancellation closes remaining demand. Any quantities already
                                    fulfilled stay in the order history and are not reversed.
                                </p>
                                {cancelState.error && (
                                    <p role="alert" className="text-sm text-destructive">
                                        {cancelState.error}
                                    </p>
                                )}
                                {cancelState.success && <p role="status">{cancelState.success}</p>}
                                <form action={cancelSubmit} className="space-y-4">
                                    <input type="hidden" name="organization" value={organization} />
                                    <input type="hidden" name="orderId" value={orderId} />
                                    <input
                                        type="hidden"
                                        name="expectedOrderVersion"
                                        value={version}
                                    />
                                    <div className="space-y-2">
                                        <label htmlFor="cancel-order-reason">Reason</label>
                                        <textarea
                                            id="cancel-order-reason"
                                            name="reason"
                                            autoFocus
                                            required
                                            maxLength={2000}
                                            className="min-h-24 w-full rounded-md border bg-background p-3"
                                        />
                                    </div>
                                    <div className="flex flex-wrap gap-3">
                                        <Button
                                            type="submit"
                                            variant="destructive"
                                            disabled={cancelPending || Boolean(cancelState.success)}
                                        >
                                            {cancelPending ? 'Cancelling…' : 'Confirm cancellation'}
                                        </Button>
                                        <Button
                                            type="button"
                                            variant="outline"
                                            disabled={cancelPending}
                                            onClick={() => setCancelOpen(false)}
                                        >
                                            Go back
                                        </Button>
                                    </div>
                                </form>
                            </section>
                        </div>
                    )}
                </>
            )}
        </section>
    );
}
