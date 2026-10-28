import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => ({
    origin: 'https://farms.example.com' as string | null,
    context: vi.fn(),
    api: vi.fn(),
    revalidate: vi.fn(),
}));

vi.mock('next/headers', () => ({
    headers: async () => (fake.origin ? new Headers({ origin: fake.origin }) : new Headers()),
}));

vi.mock('next/navigation', () => ({
    unstable_rethrow: (error: unknown) => {
        if (error instanceof Error && error.message === 'redirect:/login') {
            throw error;
        }
    },
}));

vi.mock('next/cache', () => ({
    revalidatePath: fake.revalidate,
}));

vi.mock('@/lib/application/current-context', () => ({
    requireApplicationContext: fake.context,
}));

vi.mock('@/lib/management/api', async (original) => ({
    ...(await original<typeof import('./api')>()),
    managementApi: fake.api,
}));

import {
    createCustomerAction,
    setCustomerStatusAction,
    updateCustomerAction,
} from '../../app/app/customers/actions';
import { ApplicationAccessDeniedError } from '../application/selection';
import { ManagementApiError } from './api';

const organization = randomUUID();
const customer = randomUUID();

function form(values: Record<string, string> = {}) {
    const result = new FormData();

    for (const [key, value] of Object.entries({
        organization,
        customerId: customer,
        type: 'BUSINESS',
        name: ' Castle Produce Ltd ',
        contactPerson: ' Jane Castle ',
        phone: ' 876-555-0100 ',
        email: ' SALES@EXAMPLE.COM ',
        address: ' Spanish Town ',
        notes: ' Wholesale customer ',
        ...values,
    })) {
        result.set(key, value);
    }

    return result;
}

describe('Customer management actions', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        vi.stubEnv('WEB_APP_URL', 'https://farms.example.com');

        fake.origin = 'https://farms.example.com';

        fake.context.mockResolvedValue({
            current: {
                organization: { id: organization },
                permissions: ['customer:create', 'customer:update', 'customer:deactivate'],
            },
        });

        fake.api.mockResolvedValue({
            data: {
                id: customer,
            },
        });
    });

    afterEach(() => vi.unstubAllEnvs());

    it('creates a customer using normalized shared input and verified organization context', async () => {
        const result = await createCustomerAction(
            {},
            form({
                organizationId: randomUUID(),
                code: 'INJECTED',
                isActive: 'false',
            }),
        );

        expect(result).toEqual({
            success: 'Customer created.',
            resourceId: customer,
        });

        expect(fake.context).toHaveBeenCalledWith({
            organization,
        });

        expect(fake.api).toHaveBeenCalledWith(
            'organizations/' + organization + '/customers',
            expect.anything(),
            {
                method: 'POST',
                body: JSON.stringify({
                    type: 'BUSINESS',
                    name: 'Castle Produce Ltd',
                    contactPerson: 'Jane Castle',
                    phone: '876-555-0100',
                    email: 'sales@example.com',
                    address: 'Spanish Town',
                    notes: 'Wholesale customer',
                }),
            },
        );

        expect(fake.revalidate).toHaveBeenCalledWith('/app', 'layout');
    });

    it('supports individual customers and omits blank optional create fields', async () => {
        await createCustomerAction(
            {},
            form({
                type: 'INDIVIDUAL',
                name: ' Jane Customer ',
                contactPerson: '',
                phone: '',
                email: '',
                address: '',
                notes: '',
            }),
        );

        expect(fake.api.mock.calls[0][2]).toEqual({
            method: 'POST',
            body: JSON.stringify({
                type: 'INDIVIDUAL',
                name: 'Jane Customer',
            }),
        });
    });

    it('updates supported fields and converts blank optional values to null', async () => {
        await updateCustomerAction(
            {},
            form({
                name: ' Updated Customer ',
                contactPerson: '',
                phone: '',
                email: '',
                address: '',
                notes: '',
                code: 'INJECTED',
                isActive: 'false',
            }),
        );

        expect(fake.api).toHaveBeenCalledWith(
            'organizations/' + organization + '/customers/' + customer,
            expect.anything(),
            {
                method: 'PATCH',
                body: JSON.stringify({
                    type: 'BUSINESS',
                    name: 'Updated Customer',
                    contactPerson: null,
                    phone: null,
                    email: null,
                    address: null,
                    notes: null,
                }),
            },
        );
    });

    it('uses dedicated lifecycle endpoints and the deactivate permission', async () => {
        expect(await setCustomerStatusAction({}, form({ isActive: 'false' }))).toEqual({
            success: 'Customer deactivated.',
        });

        expect(fake.api).toHaveBeenLastCalledWith(
            'organizations/' + organization + '/customers/' + customer + '/deactivate',
            expect.anything(),
            { method: 'POST' },
        );

        expect(await setCustomerStatusAction({}, form({ isActive: 'true' }))).toEqual({
            success: 'Customer reactivated.',
        });

        expect(fake.api).toHaveBeenLastCalledWith(
            'organizations/' + organization + '/customers/' + customer + '/reactivate',
            expect.anything(),
            { method: 'POST' },
        );
    });

    it('rejects invalid customer input before issuing API mutations', async () => {
        const result = await createCustomerAction(
            {},
            form({
                type: 'UNKNOWN',
                name: ' ',
                email: 'not-an-email',
            }),
        );

        expect(result.error).toContain('Check the form');
        expect(result.fields).toHaveProperty('type');
        expect(result.fields).toHaveProperty('name');
        expect(result.fields).toHaveProperty('email');

        expect(fake.api).not.toHaveBeenCalled();
    });

    it('rejects malformed customer IDs and lifecycle state', async () => {
        expect(
            (await updateCustomerAction({}, form({ customerId: '../foreign' }))).error,
        ).toContain('Check the form');

        expect(await setCustomerStatusAction({}, form({ isActive: 'invalid' }))).toEqual({
            error: 'Check the customer status and try again.',
        });

        expect(fake.api).not.toHaveBeenCalled();
    });

    it.each([null, 'https://attacker.invalid'])(
        'rejects missing or foreign origins before reading context or writing',
        async (origin) => {
            fake.origin = origin;

            expect((await createCustomerAction({}, form())).error).toContain(
                'could not be verified',
            );

            expect(fake.context).not.toHaveBeenCalled();
            expect(fake.api).not.toHaveBeenCalled();
        },
    );

    it('rechecks permissions against the selected organization', async () => {
        const otherOrganization = randomUUID();

        fake.context.mockImplementation(async (selection: { organization: string }) => ({
            current: {
                organization: {
                    id: selection.organization,
                },
                permissions: selection.organization === organization ? ['customer:create'] : [],
            },
        }));

        expect(
            (
                await createCustomerAction(
                    {},
                    form({
                        organization: otherOrganization,
                        role: 'OWNER',
                    }),
                )
            ).error,
        ).toContain('do not have permission');

        expect(fake.api).not.toHaveBeenCalled();
    });

    it('keeps update and lifecycle permissions independent', async () => {
        fake.context.mockResolvedValueOnce({
            current: {
                organization: { id: organization },
                permissions: ['customer:update'],
            },
        });

        expect((await setCustomerStatusAction({}, form({ isActive: 'false' }))).error).toContain(
            'do not have permission',
        );

        expect(fake.api).not.toHaveBeenCalled();

        fake.context.mockResolvedValueOnce({
            current: {
                organization: { id: organization },
                permissions: ['customer:deactivate'],
            },
        });

        expect((await updateCustomerAction({}, form())).error).toContain('do not have permission');

        expect(fake.api).not.toHaveBeenCalled();
    });

    it('preserves login redirects and handles revoked organization access', async () => {
        fake.context.mockRejectedValueOnce(new Error('redirect:/login'));

        await expect(createCustomerAction({}, form())).rejects.toThrow('redirect:/login');

        fake.context.mockRejectedValueOnce(new ApplicationAccessDeniedError());

        expect((await updateCustomerAction({}, form())).error).toContain('do not have permission');

        expect(fake.api).not.toHaveBeenCalled();
    });

    it('returns safe Customer business errors and sanitizes unexpected failures', async () => {
        fake.api.mockRejectedValueOnce(new ManagementApiError('CUSTOMER_NOT_FOUND'));

        expect((await updateCustomerAction({}, form())).error).toBe(
            'This resource is unavailable.',
        );

        fake.api.mockRejectedValueOnce(new Error('private database details'));

        expect(await createCustomerAction({}, form())).toEqual({
            error: 'This service is temporarily unavailable. Please try again.',
        });

        expect(fake.revalidate).not.toHaveBeenCalled();
    });
});
