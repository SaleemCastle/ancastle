'use server';

import { createSupplierSchema, resourceIdSchema, updateSupplierSchema } from '@ancastle/validation';
import { managementApi, supplierResponseSchema } from '@/lib/management/api';
import { formValue, runOrganizationMutation, validateForm } from '@/lib/management/mutation';
import type { ManagementActionState } from '@/lib/management/action-state';

function supplierInput(form: FormData) {
    return {
        name: formValue(form, 'name'),
        contactPerson: formValue(form, 'contactPerson'),
        phone: formValue(form, 'phone'),
        email: formValue(form, 'email'),
        address: formValue(form, 'address'),
        notes: formValue(form, 'notes'),
    };
}

export async function createSupplierAction(
    _previous: ManagementActionState,
    form: FormData,
): Promise<ManagementActionState> {
    return runOrganizationMutation(form, 'supplier:create', async (organization) => {
        const input = validateForm(createSupplierSchema, supplierInput(form));

        const result = await managementApi(
            'organizations/' + organization + '/suppliers',
            supplierResponseSchema,
            {
                method: 'POST',
                body: JSON.stringify(input),
            },
        );

        return {
            success: 'Supplier created.',
            resourceId: result.data.id,
        };
    });
}

export async function updateSupplierAction(
    _previous: ManagementActionState,
    form: FormData,
): Promise<ManagementActionState> {
    return runOrganizationMutation(form, 'supplier:update', async (organization) => {
        const id = validateForm(resourceIdSchema, formValue(form, 'supplierId'));

        const input = validateForm(updateSupplierSchema, supplierInput(form));

        await managementApi(
            'organizations/' + organization + '/suppliers/' + id,
            supplierResponseSchema,
            {
                method: 'PATCH',
                body: JSON.stringify(input),
            },
        );

        return {
            success: 'Supplier saved.',
        };
    });
}

export async function setSupplierStatusAction(
    _previous: ManagementActionState,
    form: FormData,
): Promise<ManagementActionState> {
    return runOrganizationMutation(form, 'supplier:deactivate', async (organization) => {
        const id = validateForm(resourceIdSchema, formValue(form, 'supplierId'));

        const isActive = formValue(form, 'isActive');

        if (isActive !== 'true' && isActive !== 'false') {
            return {
                error: 'Check the supplier status and try again.',
            };
        }

        const activate = isActive === 'true';
        const operation = activate ? 'reactivate' : 'deactivate';

        await managementApi(
            'organizations/' + organization + '/suppliers/' + id + '/' + operation,
            supplierResponseSchema,
            {
                method: 'POST',
            },
        );

        return {
            success: activate ? 'Supplier reactivated.' : 'Supplier deactivated.',
        };
    });
}
