'use server';

import {
    amendOrderSchema,
    cancelOrderSchema,
    confirmOrderSchema,
    createOrderSchema,
    orderResponseSchema,
    resourceIdSchema,
} from '@ancastle/validation';
import { managementApi } from '@/lib/management/api';
import { AuthUnavailableError } from '@/lib/auth/errors';
import { formValue, runOrganizationMutation, validateForm } from '@/lib/management/mutation';
import type { ManagementActionState } from '@/lib/management/action-state';

function parsedJson(value: FormDataEntryValue | null): unknown {
    if (typeof value !== 'string') return undefined;
    try {
        return JSON.parse(value) as unknown;
    } catch {
        return undefined;
    }
}

function terms(form: FormData) {
    const saleType = formValue(form, 'saleType');
    return saleType === 'CASH'
        ? { saleType, creditTermDays: null }
        : { saleType, creditTermDays: Number(formValue(form, 'creditTermDays')) };
}

export async function createOrderAction(
    _previous: ManagementActionState,
    form: FormData,
): Promise<ManagementActionState> {
    return runOrganizationMutation(form, 'order:manage', async (organization) => {
        const input = validateForm(createOrderSchema, {
            customerId: formValue(form, 'customerId'),
            currency: 'JMD',
            terms: terms(form),
            lines: parsedJson(form.get('lines')),
        });
        let result;
        try {
            result = await managementApi(
                `organizations/${organization}/orders`,
                orderResponseSchema,
                { method: 'POST', body: JSON.stringify(input) },
            );
        } catch (error) {
            if (error instanceof AuthUnavailableError)
                return {
                    outcomeUnknown: true,
                    error: 'We could not confirm whether the draft was created. Check the sales order list before trying again.',
                };
            throw error;
        }
        return { success: 'Draft order created.', resourceId: result.data.id };
    });
}

export async function amendOrderAction(
    _previous: ManagementActionState,
    form: FormData,
): Promise<ManagementActionState> {
    return runOrganizationMutation(form, 'order:manage', async (organization) => {
        const orderId = validateForm(resourceIdSchema, formValue(form, 'orderId'));
        const input = validateForm(amendOrderSchema, {
            expectedOrderVersion: Number(formValue(form, 'expectedOrderVersion')),
            customerId: formValue(form, 'customerId'),
            currency: 'JMD',
            terms: terms(form),
            lines: parsedJson(form.get('lines')),
        });
        await managementApi(
            `organizations/${organization}/orders/${orderId}`,
            orderResponseSchema,
            { method: 'PATCH', body: JSON.stringify(input) },
        );
        return { success: 'Draft order saved.', resourceId: orderId };
    });
}

export async function confirmOrderAction(
    _previous: ManagementActionState,
    form: FormData,
): Promise<ManagementActionState> {
    return runOrganizationMutation(form, 'order:confirm', async (organization) => {
        const orderId = validateForm(resourceIdSchema, formValue(form, 'orderId'));
        const input = validateForm(confirmOrderSchema, {
            expectedOrderVersion: Number(formValue(form, 'expectedOrderVersion')),
        });
        await managementApi(
            `organizations/${organization}/orders/${orderId}/confirm`,
            orderResponseSchema,
            { method: 'POST', body: JSON.stringify(input) },
        );
        return { success: 'Order confirmed.', resourceId: orderId };
    });
}

export async function cancelOrderAction(
    _previous: ManagementActionState,
    form: FormData,
): Promise<ManagementActionState> {
    return runOrganizationMutation(form, 'order:cancel', async (organization) => {
        const orderId = validateForm(resourceIdSchema, formValue(form, 'orderId'));
        const input = validateForm(cancelOrderSchema, {
            expectedOrderVersion: Number(formValue(form, 'expectedOrderVersion')),
            reason: formValue(form, 'reason'),
        });
        await managementApi(
            `organizations/${organization}/orders/${orderId}/cancel`,
            orderResponseSchema,
            { method: 'POST', body: JSON.stringify(input) },
        );
        return {
            success: 'Order cancelled. Previously fulfilled quantities remain in history.',
            resourceId: orderId,
        };
    });
}
