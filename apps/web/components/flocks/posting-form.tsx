'use client';

import { useActionState, useState, type ChangeEvent } from 'react';
import { postMortalityAction, postFeedUsageAction } from '@/app/app/flocks/actions';
import type { FeedChoice } from '@/lib/management/poultry-api';
import type { ManagementActionState } from '@/lib/management/action-state';
import { poultryPostingForm } from '@/lib/management/poultry-form';
import { Button } from '@/components/ui/button';

const inputClass =
    'h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 text-base';

export function FlockPostingForm({
    kind,
    organization,
    farm,
    flockId,
    choices = [],
}: {
    kind: 'mortality' | 'feed';
    organization: string;
    farm: string;
    flockId: string;
    choices?: FeedChoice[];
}) {
    const mortality = kind === 'mortality';
    const title = mortality ? 'Record mortality' : 'Record feed usage';
    const [values, setValues] = useState<Record<string, string>>({});
    const [state, submit, pending] = useActionState<ManagementActionState, FormData>(
        async (previous, form) => {
            const action = mortality ? postMortalityAction : postFeedUsageAction;
            const result = await action(previous, poultryPostingForm(form));
            // Clear only after confirmed success, including consecutive successful postings.
            if (result.success) setValues({});
            return result;
        },
        {},
    );
    const control = (name: string) => ({
        value: values[name] ?? '',
        onChange: (
            event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>,
        ) => {
            const value = event.target.value;
            setValues((current) => ({
                ...current,
                [name]: value,
                // Keep the unit attached to the selection when refreshed props arrive.
                ...(name === 'inventoryItemId'
                    ? {
                          expectedInventoryUnit:
                              choices.find((item) => item.id === value)?.unit ?? '',
                      }
                    : {}),
            }));
        },
        'aria-invalid': Boolean(state.fields?.[name]),
        'aria-describedby': state.fields?.[name] ? `${kind}-${name}-error` : undefined,
    });
    const fieldError = (name: string) =>
        state.fields?.[name] && (
            <p id={`${kind}-${name}-error`} className="text-sm text-destructive">
                {state.fields[name][0]}
            </p>
        );
    return (
        <form
            action={submit}
            aria-label={title}
            className="min-w-0 space-y-5 rounded-xl border bg-card p-5"
        >
            <input type="hidden" name="organization" value={organization} />
            <input type="hidden" name="farm" value={farm} />
            <input type="hidden" name="flockId" value={flockId} />
            {!mortality && (
                <input
                    type="hidden"
                    name="expectedInventoryUnit"
                    value={values.expectedInventoryUnit ?? ''}
                />
            )}
            <div>
                <h2 className="text-lg font-semibold">{title}</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                    Posted records are permanent. History cannot be edited or deleted. Check these
                    values before posting.
                </p>
            </div>
            <fieldset disabled={pending} className="min-w-0 space-y-5">
                {mortality ? (
                    <div className="space-y-2">
                        <label htmlFor="mortality-deathCount" className="block text-sm font-medium">
                            Death count
                        </label>
                        <input
                            id="mortality-deathCount"
                            name="deathCount"
                            type="number"
                            min={1}
                            max={2147483647}
                            step={1}
                            required
                            className={inputClass}
                            {...control('deathCount')}
                        />
                        {fieldError('deathCount')}
                    </div>
                ) : (
                    <>
                        <div className="space-y-2">
                            <label
                                htmlFor="feed-inventoryItemId"
                                className="block text-sm font-medium"
                            >
                                Feed item
                            </label>
                            <select
                                id="feed-inventoryItemId"
                                name="inventoryItemId"
                                required
                                className={inputClass}
                                {...control('inventoryItemId')}
                            >
                                <option value="" disabled>
                                    Select feed
                                </option>
                                {choices.map((item) => (
                                    <option
                                        key={item.id}
                                        value={item.id}
                                        disabled={item.outOfStock}
                                    >
                                        {item.code} · {item.name} ({item.unit}) — {item.stockOnHand}{' '}
                                        available{item.outOfStock ? ' (out of stock)' : ''}
                                    </option>
                                ))}
                            </select>
                            {fieldError('inventoryItemId')}
                            {fieldError('expectedInventoryUnit')}
                        </div>
                        <div className="space-y-2">
                            <label htmlFor="feed-quantity" className="block text-sm font-medium">
                                Consumption quantity
                            </label>
                            <input
                                id="feed-quantity"
                                name="quantity"
                                type="text"
                                inputMode="decimal"
                                required
                                maxLength={19}
                                pattern="(?:0|[1-9][0-9]{0,14})(?:\.[0-9]{1,3})?"
                                className={inputClass}
                                {...control('quantity')}
                            />
                            <p className="text-xs text-muted-foreground">
                                Enter a positive quantity in the selected item&apos;s unit, with at
                                most three decimal places. Recording usage consumes stock at this
                                farm.
                            </p>
                            {fieldError('quantity')}
                        </div>
                    </>
                )}
                <div className="space-y-2">
                    <label htmlFor={`${kind}-occurredAt`} className="block text-sm font-medium">
                        Occurred at (local time)
                    </label>
                    <input
                        id={`${kind}-occurredAt`}
                        name="occurredAt"
                        type="datetime-local"
                        required
                        className={inputClass}
                        {...control('occurredAt')}
                    />
                    {fieldError('occurredAt')}
                </div>
                {mortality && (
                    <div className="space-y-2">
                        <label htmlFor="mortality-cause" className="block text-sm font-medium">
                            Cause
                        </label>
                        <input
                            id="mortality-cause"
                            name="cause"
                            maxLength={120}
                            className={inputClass}
                            {...control('cause')}
                        />
                        {fieldError('cause')}
                    </div>
                )}
                <div className="space-y-2">
                    <label htmlFor={`${kind}-reference`} className="block text-sm font-medium">
                        Reference
                    </label>
                    <input
                        id={`${kind}-reference`}
                        name="reference"
                        maxLength={120}
                        className={inputClass}
                        {...control('reference')}
                    />
                    {fieldError('reference')}
                </div>
                <div className="space-y-2">
                    <label htmlFor={`${kind}-note`} className="block text-sm font-medium">
                        Note
                    </label>
                    <textarea
                        id={`${kind}-note`}
                        name="note"
                        maxLength={2000}
                        className="min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-base"
                        {...control('note')}
                    />
                    {fieldError('note')}
                </div>
            </fieldset>
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
            <Button type="submit" disabled={pending}>
                {pending ? 'Posting...' : title}
            </Button>
        </form>
    );
}
