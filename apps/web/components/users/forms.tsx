'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import { ORGANIZATION_ROLES, type OrganizationRole, type FarmDetails } from '@ancastle/types';
import { Button } from '@/components/ui/button';
import { applicationHref } from '@/lib/application/selection';
import type { ManagementActionState } from '@/lib/management/action-state';
import {
    createUserAction,
    updateMemberProfileAction,
    updateMemberRoleAction,
    setMemberStatusAction,
    replaceMemberFarmsAction,
} from '@/app/app/users/actions';

const inputClass = 'h-11 w-full rounded-md border border-input bg-background px-3 text-base';
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
function Fields({ organization, userId }: { organization: string; userId?: string }) {
    return (
        <>
            <input type="hidden" name="organization" value={organization} />
            {userId && <input type="hidden" name="userId" value={userId} />}
        </>
    );
}
function Field({
    name,
    label,
    state,
    value = '',
    required = false,
    type = 'text',
}: {
    name: string;
    label: string;
    state: ManagementActionState;
    value?: string;
    required?: boolean;
    type?: 'text' | 'email' | 'password';
}) {
    return (
        <div className="space-y-2">
            <label htmlFor={'user-' + name} className="block text-sm font-medium">
                {label}
            </label>
            <input
                id={'user-' + name}
                name={name}
                type={type}
                defaultValue={type === 'password' ? undefined : value}
                required={required}
                autoComplete={type === 'password' ? 'new-password' : 'off'}
                minLength={type === 'password' ? 12 : undefined}
                maxLength={type === 'password' ? 128 : name === 'email' ? 254 : 120}
                className={inputClass}
                aria-invalid={Boolean(state.fields?.[name])}
                aria-describedby={state.fields?.[name] ? 'user-' + name + '-error' : undefined}
            />
            {state.fields?.[name] && (
                <p id={'user-' + name + '-error'} className="text-sm text-destructive">
                    {state.fields[name][0]}
                </p>
            )}
        </div>
    );
}
function RoleField({ role, state }: { role: OrganizationRole; state: ManagementActionState }) {
    return (
        <div className="space-y-2">
            <label htmlFor="organization-role" className="block text-sm font-medium">
                Organization role
            </label>
            <select
                id="organization-role"
                name="role"
                defaultValue={role}
                className={inputClass}
                aria-invalid={Boolean(state.fields?.role)}
            >
                {ORGANIZATION_ROLES.map((value) => (
                    <option key={value} value={value}>
                        {value}
                    </option>
                ))}
            </select>
            {state.fields?.role && (
                <p className="text-sm text-destructive">{state.fields.role[0]}</p>
            )}
        </div>
    );
}
function FarmChoices({
    farms,
    assigned = [],
    state,
}: {
    farms: FarmDetails[];
    assigned?: string[];
    state: ManagementActionState;
}) {
    return (
        <fieldset className="space-y-3">
            <legend className="text-sm font-medium">Farm access</legend>
            {farms.length ? (
                <div className="max-h-72 space-y-3 overflow-y-auto rounded-md border p-3">
                    {farms.map((farm) => (
                        <label key={farm.id} className="flex items-start gap-3 text-sm">
                            <input
                                type="checkbox"
                                name="farmIds"
                                value={farm.id}
                                defaultChecked={assigned.includes(farm.id)}
                                className="mt-1 size-4 shrink-0"
                            />
                            <span className="min-w-0 break-words">
                                {farm.name} ({farm.code})
                                {!farm.isActive && (
                                    <span className="text-muted-foreground"> · Inactive</span>
                                )}
                            </span>
                        </label>
                    ))}
                </div>
            ) : (
                <p className="text-sm text-muted-foreground">
                    No farms are available for assignment.
                </p>
            )}
            {state.fields?.farmIds && (
                <p className="text-sm text-destructive">{state.fields.farmIds[0]}</p>
            )}
        </fieldset>
    );
}

export function NewUserForm({
    organization,
    farms,
}: {
    organization: string;
    farms: FarmDetails[];
}) {
    const [state, action, pending] = useActionState<ManagementActionState, FormData>(
        createUserAction,
        {},
    );
    return (
        <form action={action} aria-label="Create user" className="mt-6 max-w-xl space-y-5">
            <Fields organization={organization} />
            <Field name="email" label="Email" type="email" required state={state} />
            <Field name="displayName" label="Organization display name" state={state} />
            <Field
                name="password"
                label="Initial password"
                type="password"
                required
                state={state}
            />
            <p className="text-sm text-muted-foreground">
                Use 12–128 characters for the initial password.
            </p>
            <RoleField role="STAFF" state={state} />
            <FarmChoices farms={farms} state={state} />
            <Feedback state={state} />
            {state.resourceId && (
                <Link
                    prefetch={false}
                    href={applicationHref('/app/users/' + state.resourceId, organization)}
                    className="block text-sm underline"
                >
                    View created user
                </Link>
            )}
            <Button type="submit" disabled={pending} className="h-10">
                {pending ? 'Creating…' : 'Create user'}
            </Button>
        </form>
    );
}

export function MemberProfileForm({
    organization,
    userId,
    displayName,
}: {
    organization: string;
    userId: string;
    displayName: string | null;
}) {
    const [state, action, pending] = useActionState<ManagementActionState, FormData>(
        updateMemberProfileAction,
        {},
    );
    return (
        <form
            action={action}
            aria-label="Organization member profile"
            className="max-w-xl space-y-4"
        >
            <Fields organization={organization} userId={userId} />
            <Field
                name="displayName"
                label="Organization display name"
                value={displayName ?? ''}
                state={state}
            />
            <p className="text-sm text-muted-foreground">
                Leave blank to clear this organization-specific name.
            </p>
            <Feedback state={state} />
            <Button type="submit" disabled={pending} className="h-10">
                {pending ? 'Saving…' : 'Save profile'}
            </Button>
        </form>
    );
}
export function MemberRoleForm({
    organization,
    userId,
    role,
}: {
    organization: string;
    userId: string;
    role: OrganizationRole;
}) {
    const [state, action, pending] = useActionState<ManagementActionState, FormData>(
        updateMemberRoleAction,
        {},
    );
    return (
        <form action={action} aria-label="Organization role" className="max-w-xl space-y-4">
            <Fields organization={organization} userId={userId} />
            <RoleField role={role} state={state} />
            <p className="text-sm text-muted-foreground">
                At least one active administrator must remain in the organization.
            </p>
            <Feedback state={state} />
            <Button type="submit" disabled={pending} className="h-10">
                {pending ? 'Saving…' : 'Save role'}
            </Button>
        </form>
    );
}
export function MemberFarmForm({
    organization,
    userId,
    farms,
    assigned,
    allFarms,
}: {
    organization: string;
    userId: string;
    farms: FarmDetails[];
    assigned: string[];
    allFarms: boolean;
}) {
    const [state, action, pending] = useActionState<ManagementActionState, FormData>(
        replaceMemberFarmsAction,
        {},
    );
    return (
        <form action={action} aria-label="Member farm access" className="max-w-xl space-y-4">
            <Fields organization={organization} userId={userId} />
            {allFarms && (
                <p className="text-sm text-muted-foreground">
                    This membership currently has access to all farms. Assignments below apply when
                    a role requires explicit farm access.
                </p>
            )}
            <FarmChoices farms={farms} assigned={assigned} state={state} />
            <Feedback state={state} />
            <Button type="submit" disabled={pending} className="h-10">
                {pending ? 'Saving…' : 'Save farm access'}
            </Button>
        </form>
    );
}
export function MemberStatusForm({
    organization,
    userId,
    isActive,
}: {
    organization: string;
    userId: string;
    isActive: boolean;
}) {
    const [state, action, pending] = useActionState<ManagementActionState, FormData>(
        setMemberStatusAction,
        {},
    );
    return (
        <form action={action} aria-label="Membership lifecycle" className="space-y-4">
            <Fields organization={organization} userId={userId} />
            <input type="hidden" name="isActive" value={String(!isActive)} />
            <p className="text-sm text-muted-foreground">
                Membership status controls access to this organization. Other organization
                memberships are managed separately.
            </p>
            <Feedback state={state} />
            <Button
                type="submit"
                variant={isActive ? 'destructive' : 'outline'}
                disabled={pending}
                className="h-10"
            >
                {pending
                    ? 'Updating…'
                    : isActive
                      ? 'Deactivate membership'
                      : 'Reactivate membership'}
            </Button>
        </form>
    );
}
