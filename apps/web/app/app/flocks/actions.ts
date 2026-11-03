'use server';

import { createFlockSchema, updateFlockSchema, resourceIdSchema } from '@ancastle/validation';
import { requireApplicationContext } from '@/lib/application/current-context';
import { ManagementApiError, managementApi } from '@/lib/management/api';
import { flockApiPath, flockResponseSchema, flockScope } from '@/lib/management/flock-api';
import { flockFields } from '@/lib/management/flocks';
import { formValue, runOrganizationMutation, validateForm } from '@/lib/management/mutation';
import type { ManagementActionState } from '@/lib/management/action-state';

function runFlockMutation(
    form: FormData,
    operation: (path: string) => Promise<ManagementActionState>,
) {
    return runOrganizationMutation(form, ['flock:read', 'flock:manage'], async (organization) => {
        const farm = validateForm(resourceIdSchema, formValue(form, 'farm'));
        const context = await requireApplicationContext({ organization, farm });
        const scope = flockScope(context, true);
        if (!scope) throw new ManagementApiError('FORBIDDEN');
        return operation(flockApiPath(scope));
    });
}

function flockInput(form: FormData, partial = false) {
    const input: Record<string, unknown> = {};
    for (const field of flockFields) {
        if (partial && !form.has(field)) continue;
        const value = formValue(form, field);
        input[field] =
            field === 'startingBirdCount' && typeof value === 'string' ? Number(value) : value;
    }
    return input;
}

export async function createFlockAction(
    _previous: ManagementActionState,
    form: FormData,
): Promise<ManagementActionState> {
    return runFlockMutation(form, async (path) => {
        const input = validateForm(createFlockSchema, flockInput(form));
        const result = await managementApi(path, flockResponseSchema, {
            method: 'POST',
            body: JSON.stringify(input),
        });
        return { success: 'Flock created.', resourceId: result.data.id };
    });
}

export async function updateFlockAction(
    _previous: ManagementActionState,
    form: FormData,
): Promise<ManagementActionState> {
    return runFlockMutation(form, async (path) => {
        const id = validateForm(resourceIdSchema, formValue(form, 'flockId'));
        const values = flockInput(form, true);
        if (!Object.keys(values).length) return { success: 'No changes to save.' };
        const input = validateForm(updateFlockSchema, values);
        await managementApi(`${path}/${id}`, flockResponseSchema, {
            method: 'PATCH',
            body: JSON.stringify(input),
        });
        return { success: 'Flock saved.' };
    });
}

export async function setFlockStatusAction(
    _previous: ManagementActionState,
    form: FormData,
): Promise<ManagementActionState> {
    return runFlockMutation(form, async (path) => {
        const id = validateForm(resourceIdSchema, formValue(form, 'flockId'));
        const operation = formValue(form, 'operation');
        if (operation !== 'close' && operation !== 'reactivate')
            throw new ManagementApiError('VALIDATION_ERROR');
        await managementApi(`${path}/${id}/${operation}`, flockResponseSchema, {
            method: 'POST',
            body: JSON.stringify({}),
        });
        return { success: operation === 'close' ? 'Flock closed.' : 'Flock reactivated.' };
    });
}
