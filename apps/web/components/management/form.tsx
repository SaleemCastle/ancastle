'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { applicationHref } from '@/lib/application/selection';
import type { ManagementActionState } from '@/lib/management/action-state';
import {
    createFarmAction,
    updateFarmAction,
    updateOrganizationAction,
    setFarmStatusAction,
} from '@/app/app/farms/actions';

const inputClass = 'h-11 w-full rounded-md border border-input bg-background px-3 text-base';

export function ManagementForm({
    kind,
    organization,
    farmId,
    name = '',
    code = '',
}: {
    kind: 'organization' | 'create-farm' | 'update-farm';
    organization: string;
    farmId?: string;
    name?: string;
    code?: string;
}) {
    const action =
        kind === 'organization'
            ? updateOrganizationAction
            : kind === 'create-farm'
              ? createFarmAction
              : updateFarmAction;
    const [state, submit, pending] = useActionState<ManagementActionState, FormData>(action, {});
    return (
        <form
            action={submit}
            aria-label={
                kind === 'organization'
                    ? 'Organization profile'
                    : kind === 'create-farm'
                      ? 'Create farm'
                      : 'Edit farm'
            }
            className="mt-6 max-w-xl space-y-4"
        >
            <input type="hidden" name="organization" value={organization} />
            {farmId && <input type="hidden" name="farmId" value={farmId} />}
            <div className="space-y-2">
                <label htmlFor={kind + '-name'} className="block text-sm font-medium">
                    {kind === 'organization' ? 'Organization name' : 'Farm name'}
                </label>
                <input
                    id={kind + '-name'}
                    name="name"
                    defaultValue={name}
                    required
                    maxLength={120}
                    className={inputClass}
                    aria-invalid={Boolean(state.fields?.name)}
                    aria-describedby={state.fields?.name ? kind + '-name-error' : undefined}
                />
                {state.fields?.name && (
                    <p id={kind + '-name-error'} className="text-sm text-destructive">
                        {state.fields.name[0]}
                    </p>
                )}
            </div>
            {kind !== 'organization' && (
                <div className="space-y-2">
                    <label htmlFor={kind + '-code'} className="block text-sm font-medium">
                        Farm code
                    </label>
                    <input
                        id={kind + '-code'}
                        name="code"
                        defaultValue={code}
                        required
                        maxLength={32}
                        className={inputClass}
                        aria-invalid={Boolean(state.fields?.code)}
                        aria-describedby={state.fields?.code ? kind + '-code-error' : undefined}
                    />
                    <p className="text-sm text-muted-foreground">
                        Use letters, digits, underscores or hyphens. Codes are saved in uppercase.
                    </p>
                    {state.fields?.code && (
                        <p id={kind + '-code-error'} className="text-sm text-destructive">
                            {state.fields.code[0]}
                        </p>
                    )}
                </div>
            )}
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
                    href={applicationHref('/app/farms/' + state.resourceId, organization)}
                    className="block text-sm underline"
                >
                    View created farm
                </Link>
            )}
            <Button type="submit" disabled={pending} className="h-10">
                {pending ? 'Saving…' : kind === 'create-farm' ? 'Create farm' : 'Save changes'}
            </Button>
        </form>
    );
}

export function FarmStatusForm({
    organization,
    farmId,
    isActive,
}: {
    organization: string;
    farmId: string;
    isActive: boolean;
}) {
    const [state, action, pending] = useActionState<ManagementActionState, FormData>(
        setFarmStatusAction,
        {},
    );
    return (
        <form action={action} aria-label="Farm lifecycle" className="mt-8 space-y-3 border-t pt-6">
            <input type="hidden" name="organization" value={organization} />
            <input type="hidden" name="farmId" value={farmId} />
            <input type="hidden" name="isActive" value={String(!isActive)} />
            <p className="text-sm text-muted-foreground">
                {isActive
                    ? 'Deactivating removes this farm from operational selection and preserves its records.'
                    : 'Reactivating makes this farm available to users with access.'}
            </p>
            <Button
                type="submit"
                variant={isActive ? 'destructive' : 'outline'}
                disabled={pending}
                className="h-10"
            >
                {pending ? 'Updating…' : isActive ? 'Deactivate farm' : 'Reactivate farm'}
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
