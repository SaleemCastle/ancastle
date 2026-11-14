'use client';

import { useActionState, useState, type ChangeEvent } from 'react';
import { INVENTORY_MOVEMENT_REASONS, type InventoryItem } from '@ancastle/types';

import { postInventoryMovementAction } from '@/app/app/inventory/stock/actions';
import type { ManagementActionState } from '@/lib/management/action-state';
import { Button } from '@/components/ui/button';

const inputClass = 'h-11 w-full rounded-md border border-input bg-background px-3 text-base';

const textareaClass =
    'min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-base';

function FieldError({
    state,
    field,
    id,
}: {
    state: ManagementActionState;
    field: string;
    id: string;
}) {
    const message = state.fields?.[field]?.[0];

    if (!message) return null;

    return (
        <p id={id} className="text-sm text-destructive">
            {message}
        </p>
    );
}

function reasonLabel(reason: string) {
    switch (reason) {
        case 'RECEIPT':
            return 'Receipt';
        case 'ISSUE':
            return 'Issue / usage';
        case 'ADJUSTMENT':
            return 'Adjustment / correction';
        default:
            return reason;
    }
}

export function InventoryMovementForm({
    organization,
    farm,
    items,
}: {
    organization: string;
    farm: string;
    items: InventoryItem[];
}) {
    const [values, setValues] = useState<Record<string, string>>({});
    const [state, action, pending] = useActionState<ManagementActionState, FormData>(
        async (previous, form) => {
            const result = await postInventoryMovementAction(previous, form);
            if (result.success) setValues({});
            return result;
        },
        {},
    );
    const control = (name: string) => ({
        value: values[name] ?? '',
        onChange: (
            event: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>,
        ) => {
            const value = event.target.value;
            setValues((current) => ({
                ...current,
                [name]: value,
                // Keep the unit attached to the selection when refreshed props arrive.
                ...(name === 'inventoryItemId'
                    ? { expectedInventoryUnit: items.find((item) => item.id === value)?.unit ?? '' }
                    : {}),
            }));
        },
    });

    return (
        <form
            action={action}
            aria-label="Post inventory movement"
            className="space-y-5 rounded-xl border bg-card p-5"
        >
            <input type="hidden" name="organization" value={organization} />

            <input type="hidden" name="farm" value={farm} />
            <input
                type="hidden"
                name="expectedInventoryUnit"
                value={values.expectedInventoryUnit ?? ''}
            />

            <div>
                <h2 className="text-lg font-semibold">Post movement</h2>

                <p className="mt-1 text-sm text-muted-foreground">
                    Movements are permanent ledger entries. If a previous entry was incorrect, post
                    an adjustment rather than editing or deleting history.
                </p>
            </div>

            <div className="space-y-2">
                <label htmlFor="movement-item" className="block text-sm font-medium">
                    Inventory item
                </label>

                <select
                    id="movement-item"
                    name="inventoryItemId"
                    required
                    {...control('inventoryItemId')}
                    className={inputClass}
                    aria-invalid={Boolean(state.fields?.inventoryItemId)}
                >
                    <option value="" disabled>
                        Select an item
                    </option>

                    {items
                        .filter((item) => item.isActive)
                        .map((item) => (
                            <option key={item.id} value={item.id}>
                                {item.code} · {item.name} ({item.unit})
                            </option>
                        ))}
                </select>

                <FieldError state={state} field="inventoryItemId" id="movement-item-error" />
                <FieldError state={state} field="expectedInventoryUnit" id="movement-unit-error" />
            </div>

            <div className="grid gap-5 sm:grid-cols-2">
                <div className="space-y-2">
                    <label htmlFor="movement-reason" className="block text-sm font-medium">
                        Reason
                    </label>

                    <select
                        id="movement-reason"
                        name="reason"
                        required
                        {...control('reason')}
                        className={inputClass}
                    >
                        <option value="" disabled>
                            Select a reason
                        </option>

                        {INVENTORY_MOVEMENT_REASONS.map((reason) => (
                            <option key={reason} value={reason}>
                                {reasonLabel(reason)}
                            </option>
                        ))}
                    </select>

                    <FieldError state={state} field="reason" id="movement-reason-error" />
                </div>

                <div className="space-y-2">
                    <label htmlFor="movement-quantity" className="block text-sm font-medium">
                        Quantity
                    </label>

                    <input
                        id="movement-quantity"
                        name="quantity"
                        {...control('quantity')}
                        type="number"
                        required
                        step="0.001"
                        className={inputClass}
                        aria-describedby="movement-quantity-help"
                    />

                    <p id="movement-quantity-help" className="text-xs text-muted-foreground">
                        Use a positive quantity to add stock and a negative quantity to remove
                        stock.
                    </p>

                    <FieldError state={state} field="quantity" id="movement-quantity-error" />
                </div>
            </div>

            <div className="space-y-2">
                <label htmlFor="movement-occurred-at" className="block text-sm font-medium">
                    Occurred at
                </label>

                <input
                    id="movement-occurred-at"
                    name="occurredAt"
                    {...control('occurredAt')}
                    type="datetime-local"
                    required
                    className={inputClass}
                />

                <FieldError state={state} field="occurredAt" id="movement-occurred-at-error" />
            </div>

            <div className="grid gap-5 sm:grid-cols-2">
                <div className="space-y-2">
                    <label htmlFor="movement-reference" className="block text-sm font-medium">
                        Reference
                    </label>

                    <input
                        id="movement-reference"
                        name="reference"
                        {...control('reference')}
                        maxLength={120}
                        className={inputClass}
                        placeholder="Optional reference"
                    />

                    <FieldError state={state} field="reference" id="movement-reference-error" />
                </div>

                <div className="space-y-2">
                    <label htmlFor="movement-note" className="block text-sm font-medium">
                        Note
                    </label>

                    <textarea
                        id="movement-note"
                        name="note"
                        {...control('note')}
                        maxLength={2000}
                        className={textareaClass}
                        placeholder="Optional note"
                    />

                    <FieldError state={state} field="note" id="movement-note-error" />
                </div>
            </div>

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
                {pending ? 'Posting movement...' : 'Post movement'}
            </Button>
        </form>
    );
}
