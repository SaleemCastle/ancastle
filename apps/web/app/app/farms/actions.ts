'use server';

import {
    createFarmSchema,
    updateFarmSchema,
    organizationProfileUpdateSchema,
    resourceIdSchema,
    farmResponseSchema,
    organizationResponseSchema,
} from '@ancastle/validation';
import { managementApi } from '@/lib/management/api';
import { formValue, runOrganizationMutation, validateForm } from '@/lib/management/mutation';
import type { ManagementActionState } from '@/lib/management/action-state';

export async function updateOrganizationAction(
    _previous: ManagementActionState,
    form: FormData,
): Promise<ManagementActionState> {
    return runOrganizationMutation(form, 'organization:update', async (organization) => {
        const input = validateForm(organizationProfileUpdateSchema, {
            name: formValue(form, 'name'),
        });
        await managementApi('organizations/' + organization, organizationResponseSchema, {
            method: 'PATCH',
            body: JSON.stringify(input),
        });
        return { success: 'Organization saved.' };
    });
}
export async function createFarmAction(
    _previous: ManagementActionState,
    form: FormData,
): Promise<ManagementActionState> {
    return runOrganizationMutation(form, 'farm:create', async (organization) => {
        const input = validateForm(createFarmSchema, {
            name: formValue(form, 'name'),
            code: formValue(form, 'code'),
        });
        const result = await managementApi(
            'organizations/' + organization + '/farms',
            farmResponseSchema,
            { method: 'POST', body: JSON.stringify(input) },
        );
        return { success: 'Farm created.', resourceId: result.data.id };
    });
}
export async function updateFarmAction(
    _previous: ManagementActionState,
    form: FormData,
): Promise<ManagementActionState> {
    return runOrganizationMutation(form, 'farm:update', async (organization) => {
        const id = validateForm(resourceIdSchema, formValue(form, 'farmId'));
        const input = validateForm(updateFarmSchema, {
            name: formValue(form, 'name'),
            code: formValue(form, 'code'),
        });
        await managementApi('organizations/' + organization + '/farms/' + id, farmResponseSchema, {
            method: 'PATCH',
            body: JSON.stringify(input),
        });
        return { success: 'Farm saved.' };
    });
}
export async function setFarmStatusAction(
    _previous: ManagementActionState,
    form: FormData,
): Promise<ManagementActionState> {
    return runOrganizationMutation(form, 'farm:update', async (organization) => {
        const id = validateForm(resourceIdSchema, formValue(form, 'farmId'));
        const status = formValue(form, 'isActive');
        const input = validateForm(updateFarmSchema, {
            isActive: status === 'true' ? true : status === 'false' ? false : status,
        });
        await managementApi('organizations/' + organization + '/farms/' + id, farmResponseSchema, {
            method: 'PATCH',
            body: JSON.stringify(input),
        });
        return { success: input.isActive ? 'Farm reactivated.' : 'Farm deactivated.' };
    });
}
