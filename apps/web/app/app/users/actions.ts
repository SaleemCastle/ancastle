'use server';

import {
    bootstrapOrganizationUserSchema,
    memberProfileUpdateSchema,
    membershipUpdateSchema,
    memberFarmAccessSchema,
    organizationMemberResponseSchema,
    resourceIdSchema,
} from '@ancastle/validation';
import { managementApi } from '@/lib/management/api';
import { formValue, runOrganizationMutation, validateForm } from '@/lib/management/mutation';
import type { ManagementActionState } from '@/lib/management/action-state';

export async function createUserAction(
    _previous: ManagementActionState,
    form: FormData,
): Promise<ManagementActionState> {
    return runOrganizationMutation(
        form,
        ['user:create', 'membership:manage'],
        async (organization) => {
            const name = formValue(form, 'displayName');
            const input = validateForm(bootstrapOrganizationUserSchema, {
                email: formValue(form, 'email'),
                password: formValue(form, 'password'),
                displayName: typeof name === 'string' && !name.trim() ? null : name,
                role: formValue(form, 'role'),
                farmIds: form.getAll('farmIds'),
            });
            const result = await managementApi(
                'organizations/' + organization + '/users',
                organizationMemberResponseSchema,
                { method: 'POST', body: JSON.stringify(input) },
            );
            return { success: 'User created.', resourceId: result.data.userId };
        },
    );
}
export async function updateMemberProfileAction(
    _previous: ManagementActionState,
    form: FormData,
): Promise<ManagementActionState> {
    return runOrganizationMutation(form, 'user:update', async (organization) => {
        const userId = validateForm(resourceIdSchema, formValue(form, 'userId'));
        const name = formValue(form, 'displayName');
        const input = validateForm(memberProfileUpdateSchema, {
            displayName: typeof name === 'string' && !name.trim() ? null : name,
        });
        await managementApi(
            'organizations/' + organization + '/users/' + userId + '/profile',
            organizationMemberResponseSchema,
            { method: 'PATCH', body: JSON.stringify(input) },
        );
        return { success: 'Organization profile saved.' };
    });
}
export async function updateMemberRoleAction(
    _previous: ManagementActionState,
    form: FormData,
): Promise<ManagementActionState> {
    return runOrganizationMutation(form, 'membership:manage', async (organization) => {
        const userId = validateForm(resourceIdSchema, formValue(form, 'userId'));
        const input = validateForm(membershipUpdateSchema, { role: formValue(form, 'role') });
        await managementApi(
            'organizations/' + organization + '/users/' + userId + '/membership',
            organizationMemberResponseSchema,
            { method: 'PATCH', body: JSON.stringify(input) },
        );
        return { success: 'Organization role saved.' };
    });
}
export async function setMemberStatusAction(
    _previous: ManagementActionState,
    form: FormData,
): Promise<ManagementActionState> {
    return runOrganizationMutation(
        form,
        ['membership:manage', 'user:deactivate'],
        async (organization) => {
            const userId = validateForm(resourceIdSchema, formValue(form, 'userId'));
            const status = formValue(form, 'isActive');
            const input = validateForm(membershipUpdateSchema, {
                isActive: status === 'true' ? true : status === 'false' ? false : status,
            });
            await managementApi(
                'organizations/' + organization + '/users/' + userId + '/membership',
                organizationMemberResponseSchema,
                { method: 'PATCH', body: JSON.stringify(input) },
            );
            return {
                success: input.isActive ? 'Membership reactivated.' : 'Membership deactivated.',
            };
        },
    );
}
export async function replaceMemberFarmsAction(
    _previous: ManagementActionState,
    form: FormData,
): Promise<ManagementActionState> {
    return runOrganizationMutation(form, 'membership:manage', async (organization) => {
        const userId = validateForm(resourceIdSchema, formValue(form, 'userId'));
        const input = validateForm(memberFarmAccessSchema, { farmIds: form.getAll('farmIds') });
        await managementApi(
            'organizations/' + organization + '/users/' + userId + '/farm-access',
            organizationMemberResponseSchema,
            { method: 'PUT', body: JSON.stringify(input) },
        );
        return { success: 'Farm access saved.' };
    });
}
