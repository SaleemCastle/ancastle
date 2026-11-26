'use client';

import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { submitPaymentCommand } from '@/app/app/payments/actions';
import { Button } from '@/components/ui/button';
import { applicationHref } from '@/lib/application/selection';

type Command = 'record' | 'verify' | 'allocate' | 'reverse';
type Payload = { data: object } | { error: string };
type Attempt = { fingerprint: string; key: string };

async function fingerprint(value: string) {
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function PaymentCommandDialog({
    organization,
    actor,
    payment,
    command,
    label,
    description,
    confirmation,
    children,
    payload,
    onSuccess,
    onError,
}: {
    organization: string;
    actor: string;
    payment?: string;
    command: Command;
    label: string;
    description: string;
    confirmation: string;
    children?: ReactNode | ((clearError: () => void) => ReactNode);
    payload: (form: FormData) => Payload;
    onSuccess?: (message: string) => void;
    onError?: (command: Command, message: string) => void;
}) {
    const id = useId();
    const dialog = useRef<HTMLDialogElement>(null);
    const trigger = useRef<HTMLButtonElement>(null);
    const busy = useRef(false);
    const memoryAttempt = useRef<Attempt | null>(null);
    const router = useRouter();
    const [open, setOpen] = useState(false);
    const [pending, setPending] = useState(false);
    const [error, setError] = useState('');
    const [retryPayload, setRetryPayload] = useState('');
    const [recovery, setRecovery] = useState(false);
    const [success, setSuccess] = useState<{ text: string; resourceId?: string } | null>(null);
    const scope = ['payment-command', actor, organization, command, payment ?? 'new'].join(':');

    useEffect(() => {
        if (open && !dialog.current?.open) dialog.current?.showModal();
    }, [open]);

    function readAttempt(): Attempt | null {
        try {
            const stored = sessionStorage.getItem(scope);
            return stored ? JSON.parse(stored) : memoryAttempt.current;
        } catch {
            return memoryAttempt.current;
        }
    }

    function saveAttempt(attempt: Attempt | null) {
        memoryAttempt.current = attempt;
        try {
            if (attempt) sessionStorage.setItem(scope, JSON.stringify(attempt));
            else sessionStorage.removeItem(scope);
        } catch {
            // Retain the key in memory if browser storage is unavailable.
        }
    }

    async function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (busy.current) return;
        const source = new FormData(event.currentTarget);
        let serialized = retryPayload;
        if (!serialized) {
            if (source.get('confirmed') !== 'true') {
                setError('Confirm the payment action before submitting.');
                return;
            }
            const result = payload(source);
            if ('error' in result) {
                setError(result.error);
                return;
            }
            serialized = JSON.stringify(result.data);
        }
        busy.current = true;
        setPending(true);
        setError('');
        let sent = false;
        try {
            const digest = await fingerprint(serialized);
            const previous = readAttempt();
            if (previous && previous.fingerprint !== digest) {
                setError(
                    'An earlier submission is unresolved. Re-enter its original values to retry safely.',
                );
                return;
            }
            const attempt = previous ?? { fingerprint: digest, key: crypto.randomUUID() };
            saveAttempt(attempt);
            const data = new FormData();
            data.set('organization', organization);
            data.set('command', command);
            data.set('confirmed', 'true');
            data.set('commandKey', attempt.key);
            data.set('payload', serialized);
            if (payment) data.set('payment', payment);
            sent = true;
            const result = await submitPaymentCommand(data);
            if (result.success) {
                saveAttempt(null);
                if (onSuccess) onSuccess(result.success);
                else setSuccess({ text: result.success, resourceId: result.resourceId });
                setRetryPayload('');
                dialog.current?.close();
                router.refresh();
                return;
            }
            if (result.retry || previous) setRetryPayload(serialized);
            else {
                saveAttempt(null);
                if (result.error) onError?.(command, result.error);
                router.refresh();
            }
            setError(result.error ?? 'Could not complete this payment action.');
        } catch {
            if (sent) {
                setRetryPayload(serialized);
                setError('The outcome could not be confirmed. Retry the same submission.');
            } else {
                setError(
                    'Could not prepare a secure submission. Reload this workspace and try again.',
                );
            }
        } finally {
            busy.current = false;
            setPending(false);
        }
    }

    return (
        <div className="space-y-2">
            <Button
                type="button"
                ref={trigger}
                id={command + '-payment'}
                onClick={() => {
                    setSuccess(null);
                    setError('');
                    setRetryPayload('');
                    setRecovery(Boolean(readAttempt()));
                    setOpen(true);
                }}
            >
                {label}
            </Button>
            {success && (
                <p role="status" className="text-sm">
                    {success.text}{' '}
                    {command === 'record' && success.resourceId && (
                        <Link
                            prefetch={false}
                            className="underline"
                            href={applicationHref(
                                '/app/payments/' + success.resourceId,
                                organization,
                            )}
                        >
                            View recorded payment
                        </Link>
                    )}
                </p>
            )}
            <dialog
                ref={dialog}
                aria-labelledby={id}
                aria-describedby={id + '-description'}
                onClose={() => {
                    setOpen(false);
                    trigger.current?.focus();
                }}
                onCancel={(event) => {
                    if (busy.current) event.preventDefault();
                }}
                className="m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-xl overflow-y-auto rounded-2xl border border-border bg-background p-0 text-foreground shadow-xl backdrop:bg-black/40"
            >
                {open && (
                    <form
                        onSubmit={submit}
                        onChange={() => setError('')}
                        className="space-y-4 p-5 sm:p-6"
                        aria-busy={pending}
                    >
                        <h2 id={id} className="text-lg font-semibold">
                            {label}
                        </h2>
                        <p id={id + '-description'} className="text-sm text-muted-foreground">
                            {description}
                        </p>
                        {recovery && (
                            <div className="space-y-2 rounded-md bg-muted p-3 text-sm">
                                <p role="status">
                                    An earlier attempt is unresolved. Use the original values to
                                    retry it, or review the payment history before clearing the
                                    attempt.
                                </p>
                                <Button
                                    type="button"
                                    variant="outline"
                                    disabled={pending}
                                    onClick={() => {
                                        if (
                                            !window.confirm(
                                                'Have you reviewed the payment history and resolved the earlier attempt?',
                                            )
                                        )
                                            return;
                                        saveAttempt(null);
                                        setRecovery(false);
                                        setRetryPayload('');
                                        setError('');
                                    }}
                                >
                                    Clear reviewed attempt
                                </Button>
                            </div>
                        )}
                        <fieldset className="space-y-4" disabled={pending || Boolean(retryPayload)}>
                            {typeof children === 'function'
                                ? children(() => setError(''))
                                : children}
                            <label className="flex items-start gap-2 text-sm">
                                <input
                                    type="checkbox"
                                    name="confirmed"
                                    value="true"
                                    required
                                    className="mt-1 size-4 accent-primary"
                                />
                                {confirmation}
                            </label>
                        </fieldset>
                        {error && (
                            <p
                                role="alert"
                                className="rounded-md bg-muted p-3 text-sm text-destructive"
                            >
                                {error}
                            </p>
                        )}
                        <div className="flex flex-wrap justify-end gap-2">
                            <Button
                                type="button"
                                variant="outline"
                                disabled={pending}
                                onClick={() => dialog.current?.close()}
                            >
                                Close
                            </Button>
                            <Button type="submit" disabled={pending}>
                                {pending
                                    ? 'Submitting...'
                                    : retryPayload
                                      ? 'Retry same submission'
                                      : label}
                            </Button>
                        </div>
                    </form>
                )}
            </dialog>
        </div>
    );
}
