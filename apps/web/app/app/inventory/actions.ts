'use server';

import {
    createInventoryItemSchema,
    resourceIdSchema,
    updateInventoryItemSchema,
} from '@ancastle/validation';

import { inventoryItemResponseSchema, managementApi } from '@/lib/management/api';

import { formValue, runOrganizationMutation, validateForm } from '@/lib/management/mutation';

import type { ManagementActionState } from '@/lib/management/action-state';

function inventoryItemInput(form: FormData) {
    return {
        name: formValue(form, 'name'),
        description: formValue(form, 'description'),
        unit: formValue(form, 'unit'),
        category: formValue(form, 'category'),
        lowStockThreshold: formValue(form, 'lowStockThreshold'),
    };
}

export async function createInventoryItemAction(
    _previous: ManagementActionState,
    form: FormData,
): Promise<ManagementActionState> {
    return runOrganizationMutation(form, 'inventory:item-manage', async (organization) => {
        const input = validateForm(createInventoryItemSchema, inventoryItemInput(form));

        const result = await managementApi(
            'organizations/' + organization + '/inventory-items',
            inventoryItemResponseSchema,
            {
                method: 'POST',
                body: JSON.stringify(input),
            },
        );

        return {
            success: 'Inventory item created.',
            resourceId: result.data.id,
        };
    });
}

export async function updateInventoryItemAction(
    _previous: ManagementActionState,
    form: FormData,
): Promise<ManagementActionState> {
    return runOrganizationMutation(form, 'inventory:item-manage', async (organization) => {
        const id = validateForm(resourceIdSchema, formValue(form, 'inventoryItemId'));

        const input = validateForm(updateInventoryItemSchema, inventoryItemInput(form));

        await managementApi(
            'organizations/' + organization + '/inventory-items/' + id,
            inventoryItemResponseSchema,
            {
                method: 'PATCH',
                body: JSON.stringify(input),
            },
        );

        return {
            success: 'Inventory item saved.',
        };
    });
}

export async function setInventoryItemStatusAction(
    _previous: ManagementActionState,
    form: FormData,
): Promise<ManagementActionState> {
    return runOrganizationMutation(form, 'inventory:lifecycle-manage', async (organization) => {
        const id = validateForm(resourceIdSchema, formValue(form, 'inventoryItemId'));

        const isActive = formValue(form, 'isActive');

        if (isActive !== 'true' && isActive !== 'false') {
            return {
                error: 'Check the inventory item status and try again.',
            };
        }

        const activate = isActive === 'true';
        const operation = activate ? 'reactivate' : 'deactivate';

        await managementApi(
            'organizations/' + organization + '/inventory-items/' + id + '/' + operation,
            inventoryItemResponseSchema,
            {
                method: 'POST',
            },
        );

        return {
            success: activate ? 'Inventory item reactivated.' : 'Inventory item deactivated.',
        };
    });
}
