'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import {
    INVENTORY_CATEGORIES,
    INVENTORY_UNITS,
    type InventoryCategory,
    type InventoryUnit,
} from '@ancastle/types';

import { Button } from '@/components/ui/button';
import { applicationHref } from '@/lib/application/selection';
import type { ManagementActionState } from '@/lib/management/action-state';
import {
    createInventoryItemAction,
    setInventoryItemStatusAction,
    updateInventoryItemAction,
} from '@/app/app/inventory/actions';

const inputClass = 'h-11 w-full rounded-md border border-input bg-background px-3 text-base';

const textareaClass =
    'min-h-28 w-full rounded-md border border-input bg-background px-3 py-2 text-base';

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

function label(value: string): string {
    return value
        .toLowerCase()
        .replaceAll('_', ' ')
        .replace(/\b\w/g, (character) => character.toUpperCase());
}

interface InventoryItemFormProps {
    mode: 'create' | 'update';
    organization: string;
    inventoryItemId?: string;
    code?: string;
    name?: string;
    description?: string | null;
    unit?: InventoryUnit;
    category?: InventoryCategory;
    lowStockThreshold?: string | null;
}

export function InventoryItemForm({
    mode,
    organization,
    inventoryItemId,
    code,
    name = '',
    description = '',
    unit = 'EACH',
    category = 'OTHER',
    lowStockThreshold = '',
}: InventoryItemFormProps) {
    const action = mode === 'create' ? createInventoryItemAction : updateInventoryItemAction;

    const [state, submit, pending] = useActionState<ManagementActionState, FormData>(action, {});

    const prefix = mode === 'create' ? 'create-inventory-item' : 'update-inventory-item';

    return (
        <form
            action={submit}
            aria-label={mode === 'create' ? 'Create inventory item' : 'Edit inventory item'}
            className="mt-6 max-w-2xl space-y-5"
        >
            <input type="hidden" name="organization" value={organization} />

            {inventoryItemId && (
                <input type="hidden" name="inventoryItemId" value={inventoryItemId} />
            )}

            {mode === 'update' && code && (
                <div className="space-y-2">
                    <p className="text-sm font-medium">Item code</p>
                    <p className="rounded-md border bg-muted/50 px-3 py-2.5 text-sm">{code}</p>
                    <p className="text-sm text-muted-foreground">
                        Item codes are generated automatically and cannot be edited.
                    </p>
                </div>
            )}

            <div className="space-y-2">
                <label htmlFor={`${prefix}-name`} className="block text-sm font-medium">
                    Item name
                </label>

                <input
                    id={`${prefix}-name`}
                    name="name"
                    defaultValue={name}
                    required
                    maxLength={120}
                    className={inputClass}
                    aria-invalid={Boolean(state.fields?.name)}
                    aria-describedby={state.fields?.name ? `${prefix}-name-error` : undefined}
                />

                <FieldError state={state} field="name" id={`${prefix}-name-error`} />
            </div>

            <div className="space-y-2">
                <label htmlFor={`${prefix}-description`} className="block text-sm font-medium">
                    Description
                </label>

                <textarea
                    id={`${prefix}-description`}
                    name="description"
                    defaultValue={description ?? ''}
                    maxLength={500}
                    className={textareaClass}
                    aria-invalid={Boolean(state.fields?.description)}
                    aria-describedby={
                        state.fields?.description ? `${prefix}-description-error` : undefined
                    }
                />

                <FieldError state={state} field="description" id={`${prefix}-description-error`} />
            </div>

            <div className="grid gap-5 sm:grid-cols-2">
                <div className="space-y-2">
                    <label htmlFor={`${prefix}-unit`} className="block text-sm font-medium">
                        Unit
                    </label>

                    <select
                        id={`${prefix}-unit`}
                        name="unit"
                        defaultValue={unit}
                        required
                        className={inputClass}
                        aria-invalid={Boolean(state.fields?.unit)}
                    >
                        {INVENTORY_UNITS.map((value) => (
                            <option key={value} value={value}>
                                {label(value)}
                            </option>
                        ))}
                    </select>

                    <FieldError state={state} field="unit" id={`${prefix}-unit-error`} />
                </div>

                <div className="space-y-2">
                    <label htmlFor={`${prefix}-category`} className="block text-sm font-medium">
                        Category
                    </label>

                    <select
                        id={`${prefix}-category`}
                        name="category"
                        defaultValue={category}
                        required
                        className={inputClass}
                        aria-invalid={Boolean(state.fields?.category)}
                    >
                        {INVENTORY_CATEGORIES.map((value) => (
                            <option key={value} value={value}>
                                {label(value)}
                            </option>
                        ))}
                    </select>

                    <FieldError state={state} field="category" id={`${prefix}-category-error`} />
                </div>
            </div>

            <div className="space-y-2">
                <label htmlFor={`${prefix}-threshold`} className="block text-sm font-medium">
                    Low-stock threshold
                </label>

                <input
                    id={`${prefix}-threshold`}
                    name="lowStockThreshold"
                    type="number"
                    min="0"
                    step="0.001"
                    defaultValue={lowStockThreshold ?? ''}
                    className={inputClass}
                    aria-invalid={Boolean(state.fields?.lowStockThreshold)}
                    aria-describedby={
                        state.fields?.lowStockThreshold
                            ? `${prefix}-threshold-error`
                            : `${prefix}-threshold-help`
                    }
                />

                <p id={`${prefix}-threshold-help`} className="text-sm text-muted-foreground">
                    Optional. Used to identify stock that may need restocking.
                </p>

                <FieldError
                    state={state}
                    field="lowStockThreshold"
                    id={`${prefix}-threshold-error`}
                />
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

            {state.resourceId && (
                <Link
                    prefetch={false}
                    href={applicationHref('/app/inventory/' + state.resourceId, organization)}
                    className="block text-sm underline"
                >
                    View created inventory item
                </Link>
            )}

            <Button type="submit" disabled={pending} className="h-10">
                {pending
                    ? 'Saving...'
                    : mode === 'create'
                      ? 'Create inventory item'
                      : 'Save changes'}
            </Button>
        </form>
    );
}

export function InventoryItemStatusForm({
    organization,
    inventoryItemId,
    isActive,
}: {
    organization: string;
    inventoryItemId: string;
    isActive: boolean;
}) {
    const [state, action, pending] = useActionState<ManagementActionState, FormData>(
        setInventoryItemStatusAction,
        {},
    );

    return (
        <form
            action={action}
            aria-label="Inventory item lifecycle"
            className="mt-8 space-y-3 border-t pt-6"
        >
            <input type="hidden" name="organization" value={organization} />
            <input type="hidden" name="inventoryItemId" value={inventoryItemId} />
            <input type="hidden" name="isActive" value={String(!isActive)} />

            <p className="text-sm text-muted-foreground">
                {isActive
                    ? 'Deactivating preserves this inventory item and its history while preventing it from being used as an active item.'
                    : 'Reactivating makes this inventory item available for active use again.'}
            </p>

            <Button
                type="submit"
                variant={isActive ? 'destructive' : 'outline'}
                disabled={pending}
                className="h-10"
            >
                {pending
                    ? 'Updating...'
                    : isActive
                      ? 'Deactivate inventory item'
                      : 'Reactivate inventory item'}
            </Button>

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
        </form>
    );
}
