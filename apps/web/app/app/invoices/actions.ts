'use server';

import { revalidatePath } from 'next/cache';
import {
    invoiceResponseSchema,
    idempotencyKeySchema,
    resourceIdSchema,
} from '@ancastle/validation';
import { managementApi } from '@/lib/management/api';
import { formValue, runOrganizationMutation, validateForm } from '@/lib/management/mutation';
import type { ManagementActionState } from '@/lib/management/action-state';

export async function issueInvoiceAction(
    _previous: ManagementActionState,
    form: FormData,
): Promise<ManagementActionState> {
    return runOrganizationMutation(
        form,
        ['invoice:issue', 'order:read', 'fulfilment:read'],
        async (organization) => {
            const fulfilment = validateForm(resourceIdSchema, formValue(form, 'fulfilment'));
            const key = validateForm(idempotencyKeySchema, formValue(form, 'commandKey'));
            const orderId = validateForm(resourceIdSchema, formValue(form, 'orderId'));
            if (formValue(form, 'confirmed') !== 'true')
                return { error: 'Confirm invoice issuance before submitting.' };
            const issued = await managementApi(
                `organizations/${organization}/invoices/fulfilments/${fulfilment}/issue`,
                invoiceResponseSchema,
                { method: 'POST', headers: { 'Idempotency-Key': key } },
            );
            revalidatePath('/app/invoices');
            revalidatePath(`/app/orders/${orderId}`);
            return { success: 'Invoice issued successfully.', resourceId: issued.data.id };
        },
    );
}
