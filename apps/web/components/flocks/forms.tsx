'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import type { Flock } from '@ancastle/types';
import {
    createFlockAction,
    updateFlockAction,
    setFlockStatusAction,
} from '@/app/app/flocks/actions';
import { applicationHref } from '@/lib/application/selection';
import { changedFlockForm } from '@/lib/management/flocks';
import type { ManagementActionState } from '@/lib/management/action-state';
import { Button } from '@/components/ui/button';

const inputClass =
    'h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 text-base';
const fields = [
    { name: 'name', label: 'Flock name', type: 'text', required: true, maxLength: 120 },
    { name: 'birdType', label: 'Bird type', type: 'text', maxLength: 120 },
    { name: 'placementDate', label: 'Placement date', type: 'date', required: true },
    {
        name: 'startingBirdCount',
        label: 'Starting population',
        type: 'number',
        required: true,
        min: 1,
        max: 2147483647,
        step: 1,
    },
    { name: 'expectedMaturityDate', label: 'Expected maturity date', type: 'date' },
] as const;

function Feedback({ state }: { state: ManagementActionState }) {
    return (
        <>
            {state.error && (
                <p role="alert" className="text-sm text-destructive">
                    {state.error}
                </p>
            )}
            {state.success && (
                <p role="status" className="text-sm">
                    {state.success}
                </p>
            )}
        </>
    );
}

export function FlockForm({
    organization,
    farm,
    flock,
}: {
    organization: string;
    farm: string;
    flock?: Flock;
}) {
    const [state, submit, pending] = useActionState<ManagementActionState, FormData>(
        async (previous, form) =>
            flock
                ? updateFlockAction(previous, changedFlockForm(form, flock))
                : createFlockAction(previous, form),
        {},
    );
    return (
        <form
            action={submit}
            aria-label={flock ? 'Edit flock' : 'Create flock'}
            className="mt-6 max-w-2xl space-y-5"
        >
            <input type="hidden" name="organization" value={organization} />
            <input type="hidden" name="farm" value={farm} />
            {flock && <input type="hidden" name="flockId" value={flock.id} />}
            <p className="text-sm text-muted-foreground">
                {flock ? `Code: ${flock.code}.` : 'A flock code is generated automatically.'}{' '}
                Starting population is the placement count. Live population reflects recorded
                activity.
            </p>
            <div className="grid gap-5 sm:grid-cols-2">
                {fields.map(({ name, label, ...props }) => (
                    <div key={name} className="min-w-0 space-y-2">
                        <label htmlFor={`flock-${name}`} className="block text-sm font-medium">
                            {label}
                        </label>
                        <input
                            {...props}
                            id={`flock-${name}`}
                            name={name}
                            defaultValue={flock?.[name] ?? ''}
                            className={inputClass}
                            aria-invalid={Boolean(state.fields?.[name])}
                            aria-describedby={
                                state.fields?.[name] ? `flock-${name}-error` : undefined
                            }
                        />
                        {state.fields?.[name] && (
                            <p id={`flock-${name}-error`} className="text-sm text-destructive">
                                {state.fields[name][0]}
                            </p>
                        )}
                    </div>
                ))}
            </div>
            <div className="space-y-2">
                <label htmlFor="flock-notes" className="block text-sm font-medium">
                    Notes
                </label>
                <textarea
                    id="flock-notes"
                    name="notes"
                    defaultValue={flock?.notes ?? ''}
                    maxLength={2000}
                    className="min-h-28 w-full rounded-md border border-input bg-background px-3 py-2 text-base"
                    aria-invalid={Boolean(state.fields?.notes)}
                    aria-describedby={state.fields?.notes ? 'flock-notes-error' : undefined}
                />
                {state.fields?.notes && (
                    <p id="flock-notes-error" className="text-sm text-destructive">
                        {state.fields.notes[0]}
                    </p>
                )}
            </div>
            {flock && (
                <p className="text-sm text-muted-foreground">
                    Only changed fields are saved. Dates are checked against the latest flock
                    definition. Definition changes preserve operational history.
                </p>
            )}
            <Feedback state={state} />
            {state.resourceId && (
                <Link
                    prefetch={false}
                    href={applicationHref('/app/flocks/' + state.resourceId, organization, farm)}
                    className="block text-sm underline"
                >
                    View created flock
                </Link>
            )}
            <Button type="submit" disabled={pending || Boolean(state.resourceId)}>
                {pending ? 'Saving...' : flock ? 'Save changes' : 'Create flock'}
            </Button>
        </form>
    );
}

export function FlockStatusForm({
    organization,
    farm,
    flock,
}: {
    organization: string;
    farm: string;
    flock: Flock;
}) {
    const [state, submit, pending] = useActionState<ManagementActionState, FormData>(
        setFlockStatusAction,
        {},
    );
    return (
        <form action={submit} aria-label="Flock lifecycle" className="mt-8 space-y-3 border-t pt-6">
            <input type="hidden" name="organization" value={organization} />
            <input type="hidden" name="farm" value={farm} />
            <input type="hidden" name="flockId" value={flock.id} />
            <input type="hidden" name="operation" value={flock.isActive ? 'close' : 'reactivate'} />
            <p className="text-sm text-muted-foreground">
                {flock.isActive
                    ? 'Closing stops new operational postings and preserves this flock and its history.'
                    : 'Reactivating makes this flock available for operational use again.'}
            </p>
            <Button
                type="submit"
                variant={flock.isActive ? 'destructive' : 'outline'}
                disabled={pending}
            >
                {pending ? 'Updating...' : flock.isActive ? 'Close flock' : 'Reactivate flock'}
            </Button>
            <Feedback state={state} />
        </form>
    );
}
