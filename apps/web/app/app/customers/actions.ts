'use server';

import { createCustomerSchema, resourceIdSchema, updateCustomerSchema } from '@ancastle/validation';
import { customerResponseSchema, managementApi } from '@/lib/management/api';
import { formValue, runOrganizationMutation, validateForm } from '@/lib/management/mutation';
import type { ManagementActionState } from '@/lib/management/action-state';

function customerInput(form: FormData) {
    return {
        type: formValue(form, 'type'),
        name: formValue(form, 'name'),
        contactPerson: formValue(form, 'contactPerson'),
        phone: formValue(form, 'phone'),
        email: formValue(form, 'email'),
        address: formValue(form, 'address'),
        notes: formValue(form, 'notes'),
    };
}

export async function createCustomerAction(
    _previous: ManagementActionState,
    form: FormData,
): Promise<ManagementActionState> {
    return runOrganizationMutation(form, 'customer:create', async (organization) => {
        const input = validateForm(createCustomerSchema, customerInput(form));

        const result = await managementApi(
            'organizations/' + organization + '/customers',
            customerResponseSchema,
            {
                method: 'POST',
                body: JSON.stringify(input),
            },
        );

        return {
            success: 'Customer created.',
            resourceId: result.data.id,
        };
    });
}

export async function updateCustomerAction(
    _previous: ManagementActionState,
    form: FormData,
): Promise<ManagementActionState> {
    return runOrganizationMutation(form, 'customer:update', async (organization) => {
        const id = validateForm(resourceIdSchema, formValue(form, 'customerId'));
        const input = validateForm(updateCustomerSchema, customerInput(form));

        await managementApi(
            'organizations/' + organization + '/customers/' + id,
            customerResponseSchema,
            {
                method: 'PATCH',
                body: JSON.stringify(input),
            },
        );

        return { success: 'Customer saved.' };
    });
}

export async function setCustomerStatusAction(
    _previous: ManagementActionState,
    form: FormData,
): Promise<ManagementActionState> {
    return runOrganizationMutation(form, 'customer:deactivate', async (organization) => {
        const id = validateForm(resourceIdSchema, formValue(form, 'customerId'));
        const isActive = formValue(form, 'isActive');

        if (isActive !== 'true' && isActive !== 'false') {
            return { error: 'Check the customer status and try again.' };
        }

        const activate = isActive === 'true';
        const operation = activate ? 'reactivate' : 'deactivate';

        await managementApi(
            'organizations/' + organization + '/customers/' + id + '/' + operation,
            customerResponseSchema,
            {
                method: 'POST',
            },
        );

        return {
            success: activate ? 'Customer reactivated.' : 'Customer deactivated.',
        };
    });
}
