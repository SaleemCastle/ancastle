'use server';

import { createInventoryMovementSchema } from '@ancastle/validation';
import { revalidatePath } from 'next/cache';

import { inventoryMovementResponseSchema, managementApi } from '@/lib/management/api';

import { formValue, runOrganizationMutation, validateForm } from '@/lib/management/mutation';

import type { ManagementActionState } from '@/lib/management/action-state';

function movementInput(form: FormData) {
    return {
        inventoryItemId: formValue(form, 'inventoryItemId'),
        quantity: formValue(form, 'quantity'),
        reason: formValue(form, 'reason'),
        occurredAt: formValue(form, 'occurredAt'),
        note: formValue(form, 'note'),
        reference: formValue(form, 'reference'),
    };
}

export async function postInventoryMovementAction(
    _previous: ManagementActionState,
    form: FormData,
): Promise<ManagementActionState> {
    return runOrganizationMutation(form, 'inventory:movement-post', async (organization) => {
        const farmId = formValue(form, 'farm');

        if (!farmId) {
            return {
                error: 'Select a farm before posting an inventory movement.',
            };
        }

        const input = validateForm(createInventoryMovementSchema, movementInput(form));

        await managementApi(
            'organizations/' + organization + '/farms/' + farmId + '/inventory/movements',
            inventoryMovementResponseSchema,
            {
                method: 'POST',
                body: JSON.stringify(input),
            },
        );

        revalidatePath('/app/inventory/stock');

        return {
            success: 'Inventory movement posted.',
        };
    });
}
