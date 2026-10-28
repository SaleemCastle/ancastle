import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { authConfig } from '../auth/config';
import { AuthenticationRejectedError, AuthUnavailableError } from '../auth/errors';
import { webSessions } from '../auth/sessions';
import { z } from 'zod';
import { CUSTOMER_TYPES } from '@ancastle/types';

const messages: Record<string, string> = {
    ORGANIZATION_USER_NOT_FOUND: 'This resource is unavailable.',
    USER_CREATION_CONFLICT: 'User creation could not be completed.',
    INVALID_FARM_ACCESS: 'Selected farms are unavailable in this organization.',
    LAST_ADMINISTRATOR: 'At least one active administrator must remain in the organization.',
    CONCURRENT_UPDATE: 'The data changed during this request; please reload and try again.',
    FORBIDDEN: 'You do not have permission to perform this action.',
    FARM_NOT_FOUND: 'This resource is unavailable.',
    ORGANIZATION_NOT_FOUND: 'This resource is unavailable.',
    FARM_CODE_EXISTS: 'A farm with this code already exists in this organization.',
    VALIDATION_ERROR: 'Check the form values and try again.',
    CUSTOMER_NOT_FOUND: 'This resource is unavailable.',
    CUSTOMER_CODE_EXISTS: 'A customer with this code already exists in this organization.',
    SUPPLIER_NOT_FOUND: 'This resource is unavailable.',
    SUPPLIER_CODE_EXISTS: 'A supplier with this code already exists.',
};
export class ManagementApiError extends Error {
    constructor(readonly code: string) {
        super(messages[code] ?? 'This request could not be completed.');
    }
}

const customerSchema = z.object({
    id: z.uuid(),
    code: z.string(),
    type: z.enum(CUSTOMER_TYPES),
    name: z.string(),
    contactPerson: z.string().nullable(),
    phone: z.string().nullable(),
    email: z.string().nullable(),
    address: z.string().nullable(),
    notes: z.string().nullable(),
    isActive: z.boolean(),
    createdAt: z.string(),
    updatedAt: z.string(),
});

export const customerResponseSchema = z.object({
    data: customerSchema,
});

export const customerListResponseSchema = z.object({
    data: z.array(customerSchema),
    meta: z.object({
        page: z.number().int().min(1),
        pageSize: z.number().int().min(1),
        totalItems: z.number().int().min(0),
        totalPages: z.number().int().min(0),
    }),
});

export const supplierResponseSchema = z.object({
    data: z.object({
        id: z.string(),
        code: z.string(),
        name: z.string(),
        contactPerson: z.string().nullable(),
        phone: z.string().nullable(),
        email: z.string().nullable(),
        address: z.string().nullable(),
        notes: z.string().nullable(),
        isActive: z.boolean(),
        createdAt: z.string(),
        updatedAt: z.string(),
    }),
});

export const supplierListResponseSchema = z.object({
    data: z.array(supplierResponseSchema.shape.data),
    meta: z.object({
        page: z.number(),
        pageSize: z.number(),
        totalItems: z.number(),
        totalPages: z.number(),
    }),
});

export async function fetchManagement<T>(
    path: string,
    schema: z.ZodType<T>,
    token: string,
    init: RequestInit = {},
    fetcher: typeof fetch = fetch,
): Promise<T> {
    let response;
    try {
        response = await fetcher(new URL(path, authConfig().apiUrl), {
            ...init,
            cache: 'no-store',
            redirect: 'error',
            signal: AbortSignal.timeout(5000),
            headers: {
                Authorization: 'Bearer ' + token,
                Accept: 'application/json',
                'Content-Type': 'application/json',
            },
        });
    } catch {
        throw new AuthUnavailableError();
    }
    if (response.status === 401) throw new AuthenticationRejectedError();
    let body: unknown;
    try {
        body = await response.json();
    } catch {
        throw new AuthUnavailableError();
    }
    if (!response.ok) {
        const code =
            typeof body === 'object' &&
            body !== null &&
            'error' in body &&
            typeof body.error === 'object' &&
            body.error !== null &&
            'code' in body.error
                ? body.error.code
                : undefined;
        if (typeof code === 'string' && Object.hasOwn(messages, code))
            throw new ManagementApiError(code);
        throw new AuthUnavailableError();
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success) throw new AuthUnavailableError();
    return parsed.data;
}

export async function managementApi<T>(
    path: string,
    schema: z.ZodType<T>,
    init: RequestInit = {},
): Promise<T> {
    const id = (await cookies()).get(authConfig().cookie.name)?.value;
    if (!id) redirect('/login');
    const result = await webSessions().withAccessToken(id, (token) =>
        fetchManagement(path, schema, token, init),
    );
    if (result === null) redirect('/login');
    return result;
}
