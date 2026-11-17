import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => ({
    api: vi.fn(),
    revalidate: vi.fn(),
    origin: 'https://farms.example.com',
    context: vi.fn(),
}));
vi.mock('next/headers', () => ({ headers: async () => new Headers({ origin: fake.origin }) }));
vi.mock('next/navigation', () => ({ unstable_rethrow: () => {} }));
vi.mock('next/cache', () => ({ revalidatePath: fake.revalidate }));
vi.mock('@/lib/application/current-context', () => ({ requireApplicationContext: fake.context }));
vi.mock('@/lib/management/api', async (original) => ({
    ...(await original<typeof import('@/lib/management/api')>()),
    managementApi: fake.api,
}));

import {
    amendOrderAction,
    cancelOrderAction,
    confirmOrderAction,
    createOrderAction,
} from '../../app/app/orders/actions';
import { ManagementApiError } from '@/lib/management/api';
import { AuthUnavailableError } from '@/lib/auth/errors';
import { AuthenticationRejectedError } from '@/lib/auth/errors';

const organization = randomUUID();
const orderId = randomUUID();
const customerId = randomUUID();
const poultryId = randomUUID();
const produceId = randomUUID();
const permissions = ['order:manage', 'order:confirm', 'order:cancel'];

function form(values: Record<string, string>) {
    const data = new FormData();
    for (const [key, value] of Object.entries({ organization, ...values })) data.set(key, value);
    return data;
}

const lines = [
    {
        productId: poultryId,
        expectedProduct: { kind: 'POULTRY', unit: 'EACH' },
        quantity: '3',
        unitPrice: '12.3456',
    },
    {
        productId: produceId,
        expectedProduct: { kind: 'PRODUCE', unit: 'KG', inventoryItemId: randomUUID() },
        quantity: '1.250',
        unitPrice: '2.0000',
    },
];

describe('sales order server actions', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        vi.stubEnv('WEB_APP_URL', 'https://farms.example.com');
        fake.origin = 'https://farms.example.com';
        fake.context.mockResolvedValue({
            current: { organization: { id: organization }, permissions },
        });
        fake.api.mockResolvedValue({ data: { id: orderId } });
    });
    afterEach(() => vi.unstubAllEnvs());

    it('creates one mixed poultry/produce draft with JMD terms and no retry header', async () => {
        expect(
            await createOrderAction(
                {},
                form({ customerId, saleType: 'CASH', lines: JSON.stringify(lines) }),
            ),
        ).toMatchObject({ resourceId: orderId });
        expect(fake.api).toHaveBeenCalledTimes(1);
        expect(fake.api.mock.calls[0]![0]).toBe(`organizations/${organization}/orders`);
        expect(fake.api.mock.calls[0]![2]).toMatchObject({ method: 'POST' });
        expect(fake.api.mock.calls[0]![2].headers).toBeUndefined();
        expect(JSON.parse(fake.api.mock.calls[0]![2].body)).toEqual({
            customerId,
            currency: 'JMD',
            terms: { saleType: 'CASH', creditTermDays: null },
            lines: [lines[0], { ...lines[1], quantity: '1.25' }],
        });
    });

    it('marks a create transport timeout as outcome-unknown and never advises an immediate retry', async () => {
        fake.api.mockRejectedValueOnce(new AuthUnavailableError());
        const result = await createOrderAction(
            {},
            form({ customerId, saleType: 'CASH', lines: JSON.stringify(lines) }),
        );
        expect(fake.api).toHaveBeenCalledTimes(1);
        expect(result).toMatchObject({
            outcomeUnknown: true,
            error: expect.stringContaining('could not confirm whether the draft was created'),
        });
        expect(result.error).toContain('Check the sales order list before trying again');
    });

    it('returns a safe reauthentication message for a backend 401', async () => {
        fake.api.mockRejectedValueOnce(new AuthenticationRejectedError());
        expect(
            (
                await createOrderAction(
                    {},
                    form({ customerId, saleType: 'CASH', lines: JSON.stringify(lines) }),
                )
            ).error,
        ).toBe('Your sign-in has expired. Sign in again before continuing.');
    });

    it('sends credit term days and rejects invalid poultry/decimal input before a request', async () => {
        await createOrderAction(
            {},
            form({
                customerId,
                saleType: 'CREDIT',
                creditTermDays: '45',
                lines: JSON.stringify(lines),
            }),
        );
        expect(JSON.parse(fake.api.mock.calls[0]![2].body).terms).toEqual({
            saleType: 'CREDIT',
            creditTermDays: 45,
        });
        fake.api.mockClear();
        const invalid = [{ ...lines[0], quantity: '1.5' }];
        expect(
            (
                await createOrderAction(
                    {},
                    form({ customerId, saleType: 'CASH', lines: JSON.stringify(invalid) }),
                )
            ).error,
        ).toBeDefined();
        expect(fake.api).not.toHaveBeenCalled();
    });

    it('amends a versioned draft with shared line operations', async () => {
        const lineId = randomUUID();
        const amendment = [
            { operation: 'UPDATE', lineId, line: lines[0] },
            { operation: 'ADD', line: lines[1] },
        ];
        await amendOrderAction(
            {},
            form({
                orderId,
                expectedOrderVersion: '4',
                customerId,
                saleType: 'CREDIT',
                creditTermDays: '30',
                lines: JSON.stringify(amendment),
            }),
        );
        expect(fake.api.mock.calls[0]![0]).toBe(`organizations/${organization}/orders/${orderId}`);
        expect(fake.api.mock.calls[0]![2].method).toBe('PATCH');
        expect(JSON.parse(fake.api.mock.calls[0]![2].body).expectedOrderVersion).toBe(4);
    });

    it('confirms and cancels through explicit lifecycle APIs with version checks', async () => {
        await confirmOrderAction({}, form({ orderId, expectedOrderVersion: '3' }));
        await cancelOrderAction(
            {},
            form({ orderId, expectedOrderVersion: '4', reason: 'Customer requested cancellation' }),
        );
        expect(fake.api.mock.calls.map((call) => [call[0], call[2].method])).toEqual([
            [`organizations/${organization}/orders/${orderId}/confirm`, 'POST'],
            [`organizations/${organization}/orders/${orderId}/cancel`, 'POST'],
        ]);
        expect(JSON.parse(fake.api.mock.calls[1]![2].body)).toMatchObject({
            expectedOrderVersion: 4,
            reason: 'Customer requested cancellation',
        });
    });

    it('surfaces version conflicts safely, respects permissions/origin, and never retries creation', async () => {
        fake.api.mockRejectedValueOnce(new ManagementApiError('ORDER_VERSION_CONFLICT'));
        expect(
            (
                await createOrderAction(
                    {},
                    form({ customerId, saleType: 'CASH', lines: JSON.stringify(lines) }),
                )
            ).error,
        ).toContain('changed since');
        expect(fake.api).toHaveBeenCalledTimes(1);
        fake.api.mockClear();
        fake.context.mockResolvedValue({
            current: { organization: { id: organization }, permissions: ['order:read'] },
        });
        expect(
            (
                await createOrderAction(
                    {},
                    form({ customerId, saleType: 'CASH', lines: JSON.stringify(lines) }),
                )
            ).error,
        ).toContain('permission');
        expect(fake.api).not.toHaveBeenCalled();
        fake.context.mockResolvedValue({
            current: { organization: { id: organization }, permissions },
        });
        fake.origin = 'https://attacker.invalid';
        expect(
            (
                await cancelOrderAction(
                    {},
                    form({ orderId, expectedOrderVersion: '4', reason: 'No longer required' }),
                )
            ).error,
        ).toContain('verified');
        expect(fake.api).not.toHaveBeenCalled();
    });
});
