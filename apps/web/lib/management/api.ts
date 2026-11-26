import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { authConfig } from '../auth/config';
import { AuthenticationRejectedError, AuthUnavailableError } from '../auth/errors';
import { webSessions } from '../auth/sessions';
import { z } from 'zod';
import {
    CUSTOMER_TYPES,
    INVENTORY_CATEGORIES,
    INVENTORY_UNITS,
    INVENTORY_MOVEMENT_REASONS,
    INVENTORY_STOCK_STATUSES,
} from '@ancastle/types';

const messages: Record<string, string> = {
    SALES_PRODUCT_NOT_FOUND: 'This product is unavailable.',
    SALES_PRODUCT_DEFINITION_FROZEN:
        'Referenced product identity is protected. Create a new product for a different source.',
    SALES_PRODUCT_KIND_MISMATCH: 'Poultry eligibility requires a poultry product.',
    SALES_PRODUCE_SOURCE_INELIGIBLE:
        'Select an active produce inventory item in this organization.',
    SALES_PRODUCT_CODE_LIMIT_REACHED: 'No additional product codes are available.',
    POULTRY_SOURCE_NOT_FOUND: 'This source eligibility is unavailable.',
    POULTRY_SOURCE_INACTIVE: 'Use the existing source eligibility and reactivate it explicitly.',
    POULTRY_SOURCE_INELIGIBLE: 'An active product and active flock are required.',
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
    INVENTORY_ITEM_NOT_FOUND: 'This resource is unavailable.',
    INVENTORY_ITEM_CODE_EXISTS: 'An inventory item with this code already exists.',
    INVENTORY_ITEM_CODE_LIMIT_REACHED: 'No additional inventory item codes are available.',
    INVENTORY_SCOPE_NOT_FOUND: 'This inventory resource is unavailable.',
    INVENTORY_DEFINITION_CHANGED:
        'The inventory unit changed. Your entry was not posted. Reload and review the item and quantity before trying again.',
    INVENTORY_DEFINITION_FROZEN:
        'History or catalog references protect this unit or category. Create a new inventory item for a different definition.',
    INSUFFICIENT_INVENTORY_STOCK: 'This movement would reduce stock below zero.',
    FLOCK_NOT_FOUND: 'This flock is unavailable in the selected farm.',
    FLOCK_OVER_MORTALITY:
        'Starting population cannot be less than net mortality plus fulfilled sales.',
    FLOCK_CLOSED: 'This flock is closed.',
    FLOCK_CODE_LIMIT_REACHED: 'No additional flock codes are available.',
    FLOCK_CODE_GENERATION_FAILED: 'The flock could not be created. Please try again.',
    FEED_USAGE_SCOPE_NOT_FOUND: 'The active flock or feed item is unavailable in this farm.',
    FEED_USAGE_INVALID_QUANTITY: 'Enter a positive quantity with at most three decimal places.',
    MORTALITY_INVALID_COUNT: 'Enter a positive whole number of deaths.',
    ORDER_NOT_FOUND: 'This order is unavailable.',
    ORDER_STATE_CONFLICT:
        'This order can no longer be changed in its current state. Reload the order.',
    ORDER_VERSION_CONFLICT:
        'This order changed since you opened it. Reload and review the latest version.',
    ORDER_HISTORY_INVALID: 'Order history could not be verified. Contact an administrator.',
    FULFILMENT_DISABLED: 'Fulfilment posting is currently disabled by the server deployment.',
    FULFILMENT_NOT_FOUND: 'This fulfilment is unavailable.',
    FULFILMENT_SOURCE_UNAVAILABLE:
        'The selected source is no longer eligible or available. Refresh the order and source data.',
    FULFILMENT_DUPLICATE_SOURCE:
        'Each order line and source can appear only once in a fulfilment command.',
    FULFILMENT_QUANTITY_INVALID: 'Enter a valid quantity using the product unit.',
    ORDER_OVER_FULFILMENT:
        'The order changed or the quantity exceeds what remains. Refresh before posting.',
    INSUFFICIENT_FLOCK_POPULATION:
        'Live flock availability changed. Refresh source data and review the quantity.',
    IDEMPOTENCY_CONFLICT:
        'This command key is already attached to a different request. Reload before creating a new command.',
    FULFILMENT_ALREADY_REVERSED:
        'This posting has already been reversed. Refresh the order history.',
    FULFILMENT_REVERSAL_INVALID: 'Only a complete original posting can be reversed.',
    INVOICE_ISSUANCE_DISABLED:
        'Invoice issuance is disabled by this deployment. No invoice was created.',
    INVOICE_TAX_POLICY_PENDING: 'An approved tax policy is required before invoice issuance.',
    FULFILMENT_ALREADY_INVOICED:
        'This fulfilment has already been invoiced. Refresh the list to see the invoice.',
    FULFILMENT_REVERSED: 'This fulfilment was reversed and cannot be invoiced.',
    PAYMENT_TERMS_REQUIRED:
        'The source order does not have valid payment terms for invoice issuance.',
    PAYMENT_EVIDENCE_DUPLICATE:
        'This payment evidence is already recorded. Review the existing payment before trying again.',
    PAYMENT_NOT_FOUND: 'This payment is unavailable in the selected organization.',
    PAYMENT_REVERSED: 'This payment was reversed. Review its updated history.',
    PAYMENT_ALREADY_VERIFIED: 'This payment was already verified. Review its updated history.',
    PAYMENT_ALREADY_REVERSED: 'This payment was already reversed. Review its updated history.',
    PAYMENT_NOT_VERIFIED: 'Verify receipt before allocating these funds.',
    PAYMENT_SELF_VERIFICATION_DENIED: 'Ask another authorized member to verify this payment.',
    PAYMENT_ALLOCATION_SCOPE_MISMATCH:
        'An invoice is no longer eligible. Reload balances and choose again.',
    PAYMENT_FUNDS_EXCEEDED:
        'The verified funds available changed. Reload balances and review the amounts.',
    INVOICE_AMOUNT_EXCEEDED:
        'The outstanding invoice balance changed. Reload balances and review the amounts.',
    INVOICE_NOT_FOUND: 'An invoice is unavailable. Reload balances and choose again.',
    ORDER_LINE_LIMIT_REACHED: 'This order has reached its line limit.',
    CUSTOMER_INACTIVE: 'Choose an active customer before saving this draft.',
    SALES_PRODUCT_INACTIVE:
        'One or more selected products are no longer active. Reload the catalog and review this draft.',
};
export class ManagementApiError extends Error {
    constructor(
        readonly code: string,
        readonly fields?: Record<string, string[]>,
        readonly status?: number,
    ) {
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

export const inventoryItemSchema = z.object({
    id: z.uuid(),
    code: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    unit: z.enum(INVENTORY_UNITS),
    category: z.enum(INVENTORY_CATEGORIES),
    lowStockThreshold: z.string().nullable(),
    isActive: z.boolean(),
    createdAt: z.string(),
    updatedAt: z.string(),
});

export const inventoryItemResponseSchema = z.object({
    data: inventoryItemSchema,
});

export const farmInventoryResponseSchema = z.object({
    data: z.array(
        z.object({
            item: inventoryItemSchema,
            stockOnHand: z.string(),
            stockStatus: z.enum(INVENTORY_STOCK_STATUSES),
        }),
    ),
});

export const inventoryMovementSchema = z.object({
    id: z.uuid(),
    farmId: z.uuid(),
    inventoryItemId: z.uuid(),
    actorUserId: z.uuid(),
    quantity: z.string(),
    reason: z.enum(INVENTORY_MOVEMENT_REASONS),
    occurredAt: z.string(),
    note: z.string().nullable(),
    reference: z.string().nullable(),
    createdAt: z.string(),
});

export const inventoryMovementResponseSchema = z.object({
    data: inventoryMovementSchema,
});

export const inventoryMovementListResponseSchema = z.object({
    data: z.array(inventoryMovementSchema),
    meta: z.object({
        page: z.number().int().min(1),
        pageSize: z.number().int().min(1),
        totalItems: z.number().int().min(0),
        totalPages: z.number().int().min(0),
    }),
});

export const inventoryItemListResponseSchema = z.object({
    data: z.array(inventoryItemSchema),
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
                ...Object.fromEntries(new Headers(init.headers).entries()),
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
        if (typeof code === 'string' && Object.hasOwn(messages, code)) {
            const errorFields =
                typeof body === 'object' &&
                body !== null &&
                'error' in body &&
                typeof body.error === 'object' &&
                body.error !== null &&
                'fields' in body.error &&
                typeof body.error.fields === 'object' &&
                body.error.fields !== null
                    ? Object.fromEntries(
                          Object.entries(body.error.fields).flatMap(([field, values]) =>
                              Array.isArray(values) &&
                              values.every((value) => typeof value === 'string')
                                  ? [[field, values as string[]]]
                                  : [],
                          ),
                      )
                    : undefined;
            throw new ManagementApiError(code, errorFields, response.status);
        }
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
