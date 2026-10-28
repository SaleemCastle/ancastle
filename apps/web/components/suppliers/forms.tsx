'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { applicationHref } from '@/lib/application/selection';
import type { ManagementActionState } from '@/lib/management/action-state';
import {
    createSupplierAction,
    setSupplierStatusAction,
    updateSupplierAction,
} from '@/app/app/suppliers/actions';

const inputClass = 'h-11 w-full rounded-md border border-input bg-background px-3 text-base';

const textareaClass =
    'min-h-28 w-full rounded-md border border-input bg-background px-3 py-2 text-base';

interface SupplierFormProps {
    mode: 'create' | 'update';
    organization: string;
    supplierId?: string;
    name?: string;
    contactPerson?: string | null;
    phone?: string | null;
    email?: string | null;
    address?: string | null;
    notes?: string | null;
}

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

export function SupplierForm({
    mode,
    organization,
    supplierId,
    name = '',
    contactPerson = '',
    phone = '',
    email = '',
    address = '',
    notes = '',
}: SupplierFormProps) {
    const action = mode === 'create' ? createSupplierAction : updateSupplierAction;

    const [state, submit, pending] = useActionState<ManagementActionState, FormData>(action, {});

    const prefix = mode === 'create' ? 'create-supplier' : 'update-supplier';

    return (
        <form
            action={submit}
            aria-label={mode === 'create' ? 'Create supplier' : 'Edit supplier'}
            className="mt-6 max-w-2xl space-y-5"
        >
            <input type="hidden" name="organization" value={organization} />

            {supplierId && <input type="hidden" name="supplierId" value={supplierId} />}

            <div className="space-y-2">
                <label htmlFor={`${prefix}-name`} className="block text-sm font-medium">
                    Supplier name
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
                <label htmlFor={`${prefix}-contact-person`} className="block text-sm font-medium">
                    Contact person
                </label>

                <input
                    id={`${prefix}-contact-person`}
                    name="contactPerson"
                    defaultValue={contactPerson ?? ''}
                    maxLength={120}
                    className={inputClass}
                    aria-invalid={Boolean(state.fields?.contactPerson)}
                    aria-describedby={
                        state.fields?.contactPerson ? `${prefix}-contact-person-error` : undefined
                    }
                />

                <FieldError
                    state={state}
                    field="contactPerson"
                    id={`${prefix}-contact-person-error`}
                />
            </div>

            <div className="grid gap-5 sm:grid-cols-2">
                <div className="space-y-2">
                    <label htmlFor={`${prefix}-phone`} className="block text-sm font-medium">
                        Phone
                    </label>

                    <input
                        id={`${prefix}-phone`}
                        name="phone"
                        type="tel"
                        defaultValue={phone ?? ''}
                        maxLength={30}
                        className={inputClass}
                        aria-invalid={Boolean(state.fields?.phone)}
                        aria-describedby={state.fields?.phone ? `${prefix}-phone-error` : undefined}
                    />

                    <FieldError state={state} field="phone" id={`${prefix}-phone-error`} />
                </div>

                <div className="space-y-2">
                    <label htmlFor={`${prefix}-email`} className="block text-sm font-medium">
                        Email
                    </label>

                    <input
                        id={`${prefix}-email`}
                        name="email"
                        type="email"
                        defaultValue={email ?? ''}
                        maxLength={254}
                        className={inputClass}
                        aria-invalid={Boolean(state.fields?.email)}
                        aria-describedby={state.fields?.email ? `${prefix}-email-error` : undefined}
                    />

                    <FieldError state={state} field="email" id={`${prefix}-email-error`} />
                </div>
            </div>

            <div className="space-y-2">
                <label htmlFor={`${prefix}-address`} className="block text-sm font-medium">
                    Address
                </label>

                <textarea
                    id={`${prefix}-address`}
                    name="address"
                    defaultValue={address ?? ''}
                    maxLength={500}
                    className={textareaClass}
                    aria-invalid={Boolean(state.fields?.address)}
                    aria-describedby={state.fields?.address ? `${prefix}-address-error` : undefined}
                />

                <FieldError state={state} field="address" id={`${prefix}-address-error`} />
            </div>

            <div className="space-y-2">
                <label htmlFor={`${prefix}-notes`} className="block text-sm font-medium">
                    Notes
                </label>

                <textarea
                    id={`${prefix}-notes`}
                    name="notes"
                    defaultValue={notes ?? ''}
                    maxLength={2000}
                    className={textareaClass}
                    aria-invalid={Boolean(state.fields?.notes)}
                    aria-describedby={state.fields?.notes ? `${prefix}-notes-error` : undefined}
                />

                <FieldError state={state} field="notes" id={`${prefix}-notes-error`} />
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
                    href={applicationHref('/app/suppliers/' + state.resourceId, organization)}
                    className="block text-sm underline"
                >
                    View created supplier
                </Link>
            )}

            <Button type="submit" disabled={pending} className="h-10">
                {pending ? 'Saving...' : mode === 'create' ? 'Create supplier' : 'Save changes'}
            </Button>
        </form>
    );
}

export function SupplierStatusForm({
    organization,
    supplierId,
    isActive,
}: {
    organization: string;
    supplierId: string;
    isActive: boolean;
}) {
    const [state, action, pending] = useActionState<ManagementActionState, FormData>(
        setSupplierStatusAction,
        {},
    );

    return (
        <form
            action={action}
            aria-label="Supplier lifecycle"
            className="mt-8 space-y-3 border-t pt-6"
        >
            <input type="hidden" name="organization" value={organization} />

            <input type="hidden" name="supplierId" value={supplierId} />

            <input type="hidden" name="isActive" value={String(!isActive)} />

            <p className="text-sm text-muted-foreground">
                {isActive
                    ? 'Deactivating prevents this supplier from being used for new activity while preserving the supplier record.'
                    : 'Reactivating makes this supplier available for active use again.'}
            </p>

            <Button
                type="submit"
                variant={isActive ? 'destructive' : 'outline'}
                disabled={pending}
                className="h-10"
            >
                {pending ? 'Updating...' : isActive ? 'Deactivate supplier' : 'Reactivate supplier'}
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
