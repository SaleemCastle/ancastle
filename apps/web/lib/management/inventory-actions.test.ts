import { randomUUID } from 'node:crypto';
import { postInventoryMovementAction } from '../../app/app/inventory/stock/actions';
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
    createInventoryItemAction,
    setInventoryItemStatusAction,
    updateInventoryItemAction,
} from '../../app/app/inventory/actions';

const organization = randomUUID();
const inventoryItem = randomUUID();
const farm = randomUUID();

function form(values: Record<string, string> = {}) {
    const result = new FormData();

    for (const [key, value] of Object.entries({
        organization,
        inventoryItemId: inventoryItem,
        name: ' Layer Feed ',
        description: ' Starter feed ',
        unit: 'KG',
        category: 'FEED',
        lowStockThreshold: '25.125',
        ...values,
    })) {
        result.set(key, value);
    }

    return result;
}

function movementForm(values: Record<string, string> = {}) {
    const result = new FormData();

    for (const [key, value] of Object.entries({
        organization,
        farm,
        inventoryItemId: inventoryItem,
        quantity: '-7.375',
        reason: 'ISSUE',
        occurredAt: '2026-10-30T09:30',
        note: ' Morning feed usage ',
        reference: ' FEED-001 ',
        ...values,
    })) {
        result.set(key, value);
    }

    return result;
}

describe('Inventory item management actions', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        vi.stubEnv('WEB_APP_URL', 'https://farms.example.com');

        fake.origin = 'https://farms.example.com';

        fake.context.mockResolvedValue({
            current: {
                organization: { id: organization },
                permissions: [
                    'inventory:item-manage',
                    'inventory:lifecycle-manage',
                    'inventory:movement-post',
                ],
            },
        });

        fake.api.mockResolvedValue({
            data: {
                id: inventoryItem,
            },
        });
    });

    afterEach(() => vi.unstubAllEnvs());

    it('creates an organization inventory item without accepting generated or ownership fields', async () => {
        const result = await createInventoryItemAction(
            {},
            form({
                code: 'INJECTED',
                organizationId: randomUUID(),
                isActive: 'false',
            }),
        );

        expect(result).toEqual({
            success: 'Inventory item created.',
            resourceId: inventoryItem,
        });

        expect(fake.context).toHaveBeenCalledWith({
            organization,
        });

        expect(fake.api).toHaveBeenCalledWith(
            'organizations/' + organization + '/inventory-items',
            expect.anything(),
            {
                method: 'POST',
                body: JSON.stringify({
                    name: 'Layer Feed',
                    description: 'Starter feed',
                    unit: 'KG',
                    category: 'FEED',
                    lowStockThreshold: 25.125,
                }),
            },
        );
    });

    it('updates only supported inventory item fields while keeping the generated code immutable', async () => {
        await updateInventoryItemAction(
            {},
            form({
                name: ' Updated Layer Feed ',
                description: '',
                lowStockThreshold: '',
                code: 'INV-999999',
                organizationId: randomUUID(),
            }),
        );

        expect(fake.api).toHaveBeenCalledWith(
            'organizations/' + organization + '/inventory-items/' + inventoryItem,
            expect.anything(),
            {
                method: 'PATCH',
                body: JSON.stringify({
                    name: 'Updated Layer Feed',
                    description: null,
                    unit: 'KG',
                    category: 'FEED',
                    lowStockThreshold: null,
                }),
            },
        );
    });

    it('keeps lifecycle management separate and uses dedicated endpoints', async () => {
        expect(await setInventoryItemStatusAction({}, form({ isActive: 'false' }))).toEqual({
            success: 'Inventory item deactivated.',
        });

        expect(fake.api).toHaveBeenLastCalledWith(
            'organizations/' + organization + '/inventory-items/' + inventoryItem + '/deactivate',
            expect.anything(),
            {
                method: 'POST',
            },
        );

        expect(await setInventoryItemStatusAction({}, form({ isActive: 'true' }))).toEqual({
            success: 'Inventory item reactivated.',
        });

        expect(fake.api).toHaveBeenLastCalledWith(
            'organizations/' + organization + '/inventory-items/' + inventoryItem + '/reactivate',
            expect.anything(),
            {
                method: 'POST',
            },
        );
    });

    it('posts a signed farm inventory movement and refreshes farm stock', async () => {
        fake.api.mockResolvedValueOnce({
            data: {
                id: randomUUID(),
                farmId: farm,
                inventoryItemId: inventoryItem,
                actorUserId: randomUUID(),
                quantity: '-7.375',
                reason: 'ISSUE',
                occurredAt: '2026-10-30T14:30:00.000Z',
                note: 'Morning feed usage',
                reference: 'FEED-001',
                createdAt: '2026-10-30T14:31:00.000Z',
            },
        });

        const result = await postInventoryMovementAction({}, movementForm());

        expect(result).toEqual({
            success: 'Inventory movement posted.',
        });

        expect(fake.context).toHaveBeenCalledWith({
            organization,
        });

        expect(fake.api).toHaveBeenCalledWith(
            'organizations/' + organization + '/farms/' + farm + '/inventory/movements',
            expect.anything(),
            {
                method: 'POST',
                body: JSON.stringify({
                    inventoryItemId: inventoryItem,
                    quantity: -7.375,
                    reason: 'ISSUE',
                    occurredAt: '2026-10-30T14:30:00.000Z',
                    note: 'Morning feed usage',
                    reference: 'FEED-001',
                }),
            },
        );

        expect(fake.revalidate).toHaveBeenCalledWith('/app/inventory/stock');
    });

    it('rejects a zero movement before calling the inventory API', async () => {
        const result = await postInventoryMovementAction(
            {},
            movementForm({
                quantity: '0',
            }),
        );

        expect(result.success).toBeUndefined();
        expect(result.error).toBeDefined();

        expect(fake.api).not.toHaveBeenCalled();
        expect(fake.revalidate).not.toHaveBeenCalled();
    });
});
