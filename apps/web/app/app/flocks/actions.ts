'use server';

import {
    createFlockSchema,
    updateFlockSchema,
    resourceIdSchema,
    postMortalitySchema,
    postFeedUsageSchema,
} from '@ancastle/validation';
import { requireApplicationContext } from '@/lib/application/current-context';
import { ManagementApiError, managementApi } from '@/lib/management/api';
import { flockApiPath, flockResponseSchema, flockScope } from '@/lib/management/flock-api';
import { flockFields } from '@/lib/management/flocks';
import { formValue, runOrganizationMutation, validateForm } from '@/lib/management/mutation';
import type { ManagementActionState } from '@/lib/management/action-state';
import { mortalityResponseSchema, feedUsageResponseSchema } from '@/lib/management/poultry-api';

function runFlockMutation(
    form: FormData,
    operation: (path: string) => Promise<ManagementActionState>,
    permission = 'flock:manage',
) {
    return runOrganizationMutation(form, ['flock:read', permission], async (organization) => {
        const farm = validateForm(resourceIdSchema, formValue(form, 'farm'));
        const context = await requireApplicationContext({ organization, farm });
        const scope = flockScope(context);
        if (!scope || !context.current!.permissions.includes(permission))
            throw new ManagementApiError('FORBIDDEN');
        return operation(flockApiPath(scope));
    });
}

function postingInput(form: FormData) {
    return {
        occurredAt: formValue(form, 'occurredAt'),
        note: formValue(form, 'note'),
        reference: formValue(form, 'reference'),
    };
}

export async function postMortalityAction(
    _previous: ManagementActionState,
    form: FormData,
): Promise<ManagementActionState> {
    return runFlockMutation(
        form,
        async (path) => {
            const id = validateForm(resourceIdSchema, formValue(form, 'flockId'));
            const count = formValue(form, 'deathCount');
            const input = validateForm(postMortalitySchema, {
                ...postingInput(form),
                deathCount: typeof count === 'string' ? Number(count) : count,
                cause: formValue(form, 'cause'),
            });
            try {
                const result = await managementApi(
                    `${path}/${id}/mortality`,
                    mortalityResponseSchema,
                    { method: 'POST', body: JSON.stringify(input) },
                );
                return { success: 'Mortality recorded.', resourceId: result.data.id };
            } catch (error) {
                if (error instanceof ManagementApiError && error.code === 'FLOCK_OVER_MORTALITY')
                    return {
                        error: 'Death count exceeds the remaining live population. Check the count and try again.',
                    };
                throw error;
            }
        },
        'flock:mortality-post',
    );
}

export async function postFeedUsageAction(
    _previous: ManagementActionState,
    form: FormData,
): Promise<ManagementActionState> {
    return runFlockMutation(
        form,
        async (path) => {
            const id = validateForm(resourceIdSchema, formValue(form, 'flockId'));
            const input = validateForm(postFeedUsageSchema, {
                ...postingInput(form),
                inventoryItemId: formValue(form, 'inventoryItemId'),
                quantity: formValue(form, 'quantity'),
            });
            try {
                const result = await managementApi(
                    `${path}/${id}/feed-usage`,
                    feedUsageResponseSchema,
                    { method: 'POST', body: JSON.stringify(input) },
                );
                return { success: 'Feed usage recorded.', resourceId: result.data.id };
            } catch (error) {
                if (
                    error instanceof ManagementApiError &&
                    error.code === 'INSUFFICIENT_INVENTORY_STOCK'
                )
                    return {
                        error: 'There is not enough feed stock at this farm for that quantity.',
                    };
                throw error;
            }
        },
        'flock:feed-usage-post',
    );
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
