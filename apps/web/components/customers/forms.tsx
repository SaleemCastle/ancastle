'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import type { CustomerType } from '@ancastle/types';
import { Button } from '@/components/ui/button';
import { applicationHref } from '@/lib/application/selection';
import type { ManagementActionState } from '@/lib/management/action-state';
import {
    createCustomerAction,
    setCustomerStatusAction,
    updateCustomerAction,
} from '@/app/app/customers/actions';

const inputClass = 'h-11 w-full rounded-md border border-input bg-background px-3 text-base';

const textareaClass =
    'min-h-28 w-full rounded-md border border-input bg-background px-3 py-2 text-base';

interface CustomerFormProps {
    mode: 'create' | 'update';
    organization: string;
    customerId?: string;
    type?: CustomerType;
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

export function CustomerForm({
    mode,
    organization,
    customerId,
    type = 'INDIVIDUAL',
    name = '',
    contactPerson = '',
    phone = '',
    email = '',
    address = '',
    notes = '',
}: CustomerFormProps) {
    const action = mode === 'create' ? createCustomerAction : updateCustomerAction;

    const [state, submit, pending] = useActionState<ManagementActionState, FormData>(action, {});

    const prefix = mode === 'create' ? 'create-customer' : 'update-customer';

    return (
        <form
            action={submit}
            aria-label={mode === 'create' ? 'Create customer' : 'Edit customer'}
            className="mt-6 max-w-2xl space-y-5"
        >
            <input type="hidden" name="organization" value={organization} />

            {customerId && <input type="hidden" name="customerId" value={customerId} />}

            <div className="space-y-2">
                <label htmlFor={`${prefix}-type`} className="block text-sm font-medium">
                    Customer type
                </label>

                <select
                    id={`${prefix}-type`}
                    name="type"
                    defaultValue={type}
                    required
                    className={inputClass}
                    aria-invalid={Boolean(state.fields?.type)}
                    aria-describedby={state.fields?.type ? `${prefix}-type-error` : undefined}
                >
                    <option value="INDIVIDUAL">Individual</option>
                    <option value="BUSINESS">Business</option>
                </select>

                <p className="text-sm text-muted-foreground">
                    Choose Individual for a person or Business for an organization.
                </p>

                <FieldError state={state} field="type" id={`${prefix}-type-error`} />
            </div>

            <div className="space-y-2">
                <label htmlFor={`${prefix}-name`} className="block text-sm font-medium">
                    Customer name
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
                        state.fields?.contactPerson
                            ? `${prefix}-contact-person-error`
                            : `${prefix}-contact-person-help`
                    }
                />

                <p id={`${prefix}-contact-person-help`} className="text-sm text-muted-foreground">
                    Most useful for business customers. Leave blank when it does not apply.
                </p>

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
                    href={applicationHref('/app/customers/' + state.resourceId, organization)}
                    className="block text-sm underline"
                >
                    View created customer
                </Link>
            )}

            <Button type="submit" disabled={pending} className="h-10">
                {pending ? 'Saving...' : mode === 'create' ? 'Create customer' : 'Save changes'}
            </Button>
        </form>
    );
}

export function CustomerStatusForm({
    organization,
    customerId,
    isActive,
}: {
    organization: string;
    customerId: string;
    isActive: boolean;
}) {
    const [state, action, pending] = useActionState<ManagementActionState, FormData>(
        setCustomerStatusAction,
        {},
    );

    return (
        <form
            action={action}
            aria-label="Customer lifecycle"
            className="mt-8 space-y-3 border-t pt-6"
        >
            <input type="hidden" name="organization" value={organization} />
            <input type="hidden" name="customerId" value={customerId} />
            <input type="hidden" name="isActive" value={String(!isActive)} />

            <p className="text-sm text-muted-foreground">
                {isActive
                    ? 'Deactivating prevents this customer from being used for new activity while preserving the customer record.'
                    : 'Reactivating makes this customer available for active use again.'}
            </p>

            <Button
                type="submit"
                variant={isActive ? 'destructive' : 'outline'}
                disabled={pending}
                className="h-10"
            >
                {pending ? 'Updating...' : isActive ? 'Deactivate customer' : 'Reactivate customer'}
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
