import 'server-only';
import { headers } from 'next/headers';
import { unstable_rethrow } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { resourceIdSchema } from '@ancastle/validation';
import type { z } from 'zod';
import { authConfig } from '../auth/config';
import { requireApplicationContext } from '../application/current-context';
import { ApplicationAccessDeniedError } from '../application/selection';
import { ManagementApiError } from './api';
import type { ManagementActionState } from './action-state';

class FormValidationError extends Error {
    constructor(readonly fields: Record<string, string[]>) {
        super('Validation failed');
    }
}
export function formValue(form: FormData, name: string) {
    if (form.getAll(name).length !== 1)
        throw new FormValidationError({ [name]: ['Check this value.'] });
    return form.get(name);
}
export function validateForm<T>(schema: z.ZodType<T>, input: unknown): T {
    const parsed = schema.safeParse(input);
    if (parsed.success) return parsed.data;
    const fields: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
        const field = String(issue.path[0] ?? '_root');
        fields[field] ??= [];
        fields[field].push(issue.message);
    }
    throw new FormValidationError(fields);
}

export async function runOrganizationMutation(
    form: FormData,
    permission: string,
    operation: (organizationId: string) => Promise<ManagementActionState>,
): Promise<ManagementActionState> {
    try {
        if ((await headers()).get('origin') !== authConfig().origin)
            return { error: 'The request could not be verified. Please reload and try again.' };
        const organization = validateForm(resourceIdSchema, formValue(form, 'organization'));
        const context = await requireApplicationContext({ organization });
        if (!context.current?.permissions.includes(permission))
            throw new ManagementApiError('FORBIDDEN');
        const result = await operation(context.current.organization.id);
        revalidatePath('/app', 'layout');
        return result;
    } catch (error) {
        unstable_rethrow(error);
        if (error instanceof FormValidationError)
            return { fields: error.fields, error: 'Check the form values and try again.' };
        if (error instanceof ManagementApiError) return { error: error.message };
        if (error instanceof ApplicationAccessDeniedError)
            return { error: 'You do not have permission to perform this action.' };
        return { error: 'This service is temporarily unavailable. Please try again.' };
    }
}
