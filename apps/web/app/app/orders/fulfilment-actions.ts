'use server';

import {
    fulfilmentCommandResponseSchema,
    postFulfilmentSchema,
    reverseFulfilmentSchema,
    resourceIdSchema,
} from '@ancastle/validation';
import { headers } from 'next/headers';
import { unstable_rethrow } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { authConfig } from '@/lib/auth/config';
import { AuthenticationRejectedError, AuthUnavailableError } from '@/lib/auth/errors';
import { requireApplicationContext } from '@/lib/application/current-context';
import { ApplicationAccessDeniedError } from '@/lib/application/selection';
import { ManagementApiError, managementApi } from '@/lib/management/api';
import type { ManagementActionState } from '@/lib/management/action-state';

async function command(
    form: FormData,
    operation: 'post' | 'reverse',
): Promise<ManagementActionState> {
    try {
        if ((await headers()).get('origin') !== authConfig().origin)
            return { error: 'The request could not be verified. Reload and try again.' };
        const organization = resourceIdSchema.parse(form.get('organization'));
        const farm = resourceIdSchema.parse(form.get('farm'));
        const orderId = resourceIdSchema.parse(form.get('orderId'));
        const commandId = resourceIdSchema.parse(form.get('idempotencyKey'));
        const payload = JSON.parse(String(form.get('payload')));
        const input =
            operation === 'post'
                ? postFulfilmentSchema.parse(payload)
                : reverseFulfilmentSchema.parse(payload);
        const context = await requireApplicationContext({ organization, farm });
        const permissions = context.current?.permissions ?? [];
        const required =
            operation === 'post'
                ? ['order:read', 'fulfilment:post']
                : ['order:read', 'fulfilment:reverse'];
        if (!context.current || !required.every((permission) => permissions.includes(permission)))
            throw new ManagementApiError('FORBIDDEN');
        const base = `organizations/${organization}/farms/${farm}`;
        const path =
            operation === 'post'
                ? `${base}/orders/${orderId}/fulfilments`
                : `${base}/fulfilments/${resourceIdSchema.parse(form.get('fulfilmentId'))}/reverse`;
        const result = await managementApi(path, fulfilmentCommandResponseSchema, {
            method: 'POST',
            headers: { 'Idempotency-Key': commandId },
            body: JSON.stringify(input),
        });
        revalidatePath(`/app/orders/${orderId}`);
        return {
            success:
                operation === 'post' ? 'Fulfilment posted.' : 'Full fulfilment batch reversed.',
            resourceId: result.data.fulfilment.id,
        };
    } catch (error) {
        unstable_rethrow(error);
        if (error instanceof AuthUnavailableError)
            return {
                outcomeUnknown: true,
                error: 'The outcome is unknown. Retry this exact command to replay its receipt, or reload the order and source availability.',
            };
        if (error instanceof AuthenticationRejectedError)
            return { error: 'Your sign-in has expired. Sign in again before continuing.' };
        if (error instanceof ManagementApiError)
            return {
                error: error.message,
                fields: error.fields,
                refresh: error.status === 403 || error.status === 404 || error.status === 409,
            };
        if (error instanceof ApplicationAccessDeniedError)
            return {
                error: 'Farm access changed. Refresh the page and choose an authorized farm.',
                refresh: true,
            };
        return {
            fields: { _root: ['Check the command values and try again.'] },
            error: 'The command could not be validated.',
        };
    }
}

export async function postFulfilmentAction(_state: ManagementActionState, form: FormData) {
    return command(form, 'post');
}

export async function reverseFulfilmentAction(_state: ManagementActionState, form: FormData) {
    return command(form, 'reverse');
}
