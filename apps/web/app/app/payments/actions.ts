'use server';

import { unstable_rethrow } from 'next/navigation';
import { z } from 'zod';
import {
    allocatePaymentSchema,
    idempotencyKeySchema,
    paymentResponseSchema,
    receivableInvoiceListResponseSchema,
    recordPaymentSchema,
    resourceIdSchema,
    reversePaymentSchema,
    verifyPaymentSchema,
} from '@ancastle/validation';
import { requireApplicationContext } from '@/lib/application/current-context';
import {
    customerListResponseSchema,
    managementApi,
    ManagementApiError,
} from '@/lib/management/api';
import { formValue, runOrganizationMutation, validateForm } from '@/lib/management/mutation';
import type { ManagementActionState } from '@/lib/management/action-state';

const schemas = {
    record: recordPaymentSchema,
    verify: verifyPaymentSchema,
    allocate: allocatePaymentSchema,
    reverse: reversePaymentSchema,
};
const commandSchema = z.enum(['record', 'verify', 'allocate', 'reverse']);
const payloadSchema = z
    .string()
    .max(16_000)
    .transform((value, context): unknown => {
        try {
            return JSON.parse(value);
        } catch {
            context.addIssue({ code: 'custom', message: 'Invalid command.' });
            return z.NEVER;
        }
    });

export async function submitPaymentCommand(
    form: FormData,
): Promise<ManagementActionState & { retry?: boolean }> {
    const command = commandSchema.safeParse(form.get('command'));
    if (!command.success) return { error: 'Invalid payment action.' };
    const kind = command.data;
    const permissions = ['payment:read', 'payment:' + kind];
    if (kind === 'allocate') permissions.push('receivable:read');
    return runOrganizationMutation(form, permissions, async (org) => {
        if (formValue(form, 'confirmed') !== 'true')
            return { error: 'Confirm the payment action before submitting.' };

        const key = validateForm(idempotencyKeySchema, formValue(form, 'commandKey'));
        const input = validateForm(payloadSchema, formValue(form, 'payload'));
        const base = `organizations/${org}/payments`;
        const paymentId =
            kind === 'record' ? null : validateForm(resourceIdSchema, formValue(form, 'payment'));
        const suffix = kind === 'allocate' ? 'allocations' : kind;
        const path = paymentId ? `${base}/${paymentId}/${suffix}` : base;
        const body = validateForm<unknown>(schemas[kind], input);
        const success = {
            record: 'Payment recorded and awaiting verification.',
            verify: 'Receipt of funds verified.',
            allocate: 'Payment allocations saved.',
            reverse: 'Payment reversed. Active invoice allocations were unwound.',
        };
        try {
            const result = await managementApi(path, paymentResponseSchema, {
                method: 'POST',
                headers: { 'Idempotency-Key': key },
                body: JSON.stringify(body),
            });
            return { success: success[kind], resourceId: result.data.id };
        } catch (error) {
            unstable_rethrow(error);
            if (error instanceof ManagementApiError && error.status && error.status < 500)
                return { error: error.message, retry: error.code === 'IDEMPOTENCY_CONFLICT' };
            return {
                retry: true,
                error: 'The outcome could not be confirmed. Retry the same submission with its original key.',
            };
        }
    });
}

const choicePage = z.number().int().min(1).max(100_000);

export async function searchPaymentCustomers(organization: string, search: string, page: number) {
    const input = z
        .object({
            organization: resourceIdSchema,
            search: z.string().trim().max(120),
            page: choicePage,
        })
        .safeParse({ organization, search, page });
    if (!input.success) return { error: 'Enter a valid customer search.' };
    try {
        const { current } = await requireApplicationContext({
            organization: input.data.organization,
        });
        if (
            !current?.permissions.includes('payment:read') ||
            !current.permissions.includes('customer:read')
        )
            return { error: 'Customer search is unavailable in this organization.' };
        const query = new URLSearchParams({ page: String(input.data.page), pageSize: '20' });
        if (input.data.search) query.set('search', input.data.search);
        const result = await managementApi(
            `organizations/${current.organization.id}/customers?${query}`,
            customerListResponseSchema,
        );
        return {
            data: result.data.map(({ id, name, code }) => ({ id, name, code })),
            totalPages: result.meta.totalPages,
        };
    } catch (error) {
        unstable_rethrow(error);
        return { error: 'Could not load customers. Check your access and try again.' };
    }
}

export async function loadAllocationInvoices(
    organization: string,
    paymentId: string,
    status: 'UNPAID' | 'PARTIALLY_PAID',
    page: number,
) {
    const input = z
        .object({
            organization: resourceIdSchema,
            paymentId: resourceIdSchema,
            status: z.enum(['UNPAID', 'PARTIALLY_PAID']),
            page: choicePage,
        })
        .safeParse({ organization, paymentId, status, page });
    if (!input.success) return { error: 'The invoice selection is invalid.' };
    try {
        const { current } = await requireApplicationContext({
            organization: input.data.organization,
        });
        if (
            !current ||
            !['payment:read', 'payment:allocate', 'receivable:read'].every((permission) =>
                current.permissions.includes(permission),
            )
        )
            return { error: 'Allocation access is unavailable in this organization.' };
        const base = `organizations/${current.organization.id}`;
        const { data: payment } = await managementApi(
            `${base}/payments/${input.data.paymentId}`,
            paymentResponseSchema,
        );
        if (payment.status !== 'VERIFIED' || payment.unallocatedAmount === '0.00')
            return {
                error: 'This payment has no verified funds available. Close and refresh the payment.',
            };
        const query = new URLSearchParams({
            customerId: payment.customerId,
            status: input.data.status,
            page: String(input.data.page),
            pageSize: '20',
        });
        const result = await managementApi(
            `${base}/receivables/invoices?${query}`,
            receivableInvoiceListResponseSchema,
        );
        return {
            data: result.data
                .filter(
                    (invoice) =>
                        invoice.customerId === payment.customerId &&
                        invoice.currency === payment.currency &&
                        invoice.outstandingAmount !== '0.00',
                )
                .map(({ invoiceId, invoiceNumber, outstandingAmount }) => ({
                    invoiceId,
                    invoiceNumber,
                    outstandingAmount,
                })),
            totalPages: result.meta.totalPages,
            available: payment.unallocatedAmount,
        };
    } catch (error) {
        unstable_rethrow(error);
        return { error: 'Could not load outstanding invoices. Check your access and try again.' };
    }
}
