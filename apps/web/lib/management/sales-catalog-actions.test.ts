import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const fake = vi.hoisted(() => ({
    context: vi.fn(),
    api: vi.fn(),
    revalidate: vi.fn(),
    origin: 'https://farms.example.com',
}));
vi.mock('next/headers', () => ({ headers: async () => new Headers({ origin: fake.origin }) }));
vi.mock('next/navigation', () => ({ unstable_rethrow: () => {} }));
vi.mock('next/cache', () => ({ revalidatePath: fake.revalidate }));
vi.mock('@/lib/application/current-context', () => ({ requireApplicationContext: fake.context }));
vi.mock('@/lib/management/api', async (original) => ({
    ...(await original<typeof import('./api')>()),
    managementApi: fake.api,
}));
import {
    saveProductAction,
    setProductStatusAction,
    mutateSourceAction,
} from '../../app/app/sales-products/actions';
import { ManagementApiError } from './api';
import { ApplicationAccessDeniedError } from '../application/selection';
const organization = randomUUID(),
    product = randomUUID(),
    farm = randomUUID(),
    item = randomUUID(),
    flock = randomUUID();
const permissions = [
    'sales-product:read',
    'sales-product:manage',
    'sales-product-source:manage',
    'inventory:read',
    'flock:read',
];
const form = (values: Record<string, string>) => {
    const data = new FormData();
    for (const [key, value] of Object.entries({ organization, ...values })) data.set(key, value);
    return data;
};
describe('Catalog server actions', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        vi.stubEnv('WEB_APP_URL', 'https://farms.example.com');
        fake.origin = 'https://farms.example.com';
        fake.context.mockResolvedValue({
            current: { organization: { id: organization }, permissions },
            farm: { id: farm },
        });
        fake.api.mockResolvedValue({ data: { id: product } });
    });
    afterEach(() => vi.unstubAllEnvs());
    it('creates from the shared definition and discards client-owned product fields', async () => {
        expect(
            await saveProductAction(
                {},
                form({
                    name: ' Birds ',
                    kind: 'POULTRY',
                    organizationId: randomUUID(),
                    code: 'FORGED',
                    isActive: 'false',
                    unit: 'KG',
                }),
            ),
        ).toMatchObject({ resourceId: product });
        expect(JSON.parse(fake.api.mock.calls[0]![2].body)).toEqual({
            name: 'Birds',
            kind: 'POULTRY',
        });
        expect(fake.api.mock.calls[0]![0]).toBe(`organizations/${organization}/sales-products`);
    });
    it('forwards the observed produce unit and rejects a missing precondition without an API call', async () => {
        const input = {
            name: 'Produce',
            kind: 'PRODUCE',
            inventoryItemId: item,
            expectedInventoryUnit: 'KG',
        };
        await saveProductAction({}, form(input));
        expect(JSON.parse(fake.api.mock.calls[0]![2].body)).toEqual(input);
        fake.api.mockClear();
        const missing = form(input);
        missing.delete('expectedInventoryUnit');
        expect((await saveProductAction({}, missing)).fields?.expectedInventoryUnit).toBeDefined();
        expect(fake.api).not.toHaveBeenCalled();
    });
    it('sends name-only edits unless the user explicitly chooses a source definition change', async () => {
        await saveProductAction({}, form({ productId: product, name: 'Rename', kind: 'PRODUCE' }));
        expect(JSON.parse(fake.api.mock.calls[0]![2].body)).toEqual({ name: 'Rename' });
        await saveProductAction(
            {},
            form({
                productId: product,
                name: 'Relink',
                changeDefinition: 'on',
                kind: 'PRODUCE',
                inventoryItemId: item,
                expectedInventoryUnit: 'KG',
            }),
        );
        expect(JSON.parse(fake.api.mock.calls[1]![2].body)).toEqual({
            name: 'Relink',
            definition: { kind: 'PRODUCE', inventoryItemId: item, expectedInventoryUnit: 'KG' },
        });
    });
    it('revalidates scoped farm access before attaching or changing eligibility', async () => {
        const input = form({ productId: product, farm, flockId: flock });
        await mutateSourceAction({}, input);
        expect(fake.context).toHaveBeenLastCalledWith({ organization, farm });
        expect(fake.api.mock.calls[0]![0]).toBe(
            `organizations/${organization}/farms/${farm}/sales-products/${product}/poultry-sources`,
        );
        expect(JSON.parse(fake.api.mock.calls[0]![2].body)).toEqual({ flockId: flock });
        fake.api.mockClear();
        fake.context
            .mockResolvedValueOnce({
                current: { organization: { id: organization }, permissions },
                farm: { id: farm },
            })
            .mockRejectedValueOnce(new ApplicationAccessDeniedError());
        expect((await mutateSourceAction({}, input)).error).toBeDefined();
        expect(fake.api).not.toHaveBeenCalled();
    });
    it('rejects lost capabilities, mismatched farms, duplicate selectors and unverified origins', async () => {
        fake.context.mockResolvedValue({
            current: { organization: { id: organization }, permissions: ['sales-product:read'] },
            farm: { id: farm },
        });
        expect(
            (await saveProductAction({}, form({ name: 'Denied', kind: 'POULTRY' }))).error,
        ).toBeDefined();
        expect(
            (await mutateSourceAction({}, form({ productId: product, farm, flockId: flock })))
                .error,
        ).toBeDefined();
        fake.context.mockResolvedValue({
            current: { organization: { id: organization }, permissions },
            farm: { id: randomUUID() },
        });
        expect(
            (await mutateSourceAction({}, form({ productId: product, farm, flockId: flock })))
                .error,
        ).toBeDefined();
        const duplicate = form({ name: 'Invalid', kind: 'POULTRY' });
        duplicate.append('organization', organization);
        expect((await saveProductAction({}, duplicate)).fields?.organization).toBeDefined();
        fake.origin = 'https://attacker.example.com';
        expect(
            (
                await setProductStatusAction(
                    {},
                    form({ productId: product, operation: 'reactivate' }),
                )
            ).error,
        ).toBeDefined();
        expect(fake.api).not.toHaveBeenCalled();
    });
    it('uses explicit lifecycle routes and surfaces conflicts without retrying', async () => {
        await setProductStatusAction({}, form({ productId: product, operation: 'deactivate' }));
        expect(fake.api.mock.calls[0]![0]).toBe(
            `organizations/${organization}/sales-products/${product}/deactivate`,
        );
        const source = randomUUID();
        await mutateSourceAction(
            {},
            form({ productId: product, farm, sourceId: source, operation: 'reactivate' }),
        );
        expect(fake.api.mock.calls[1]![0]).toContain(`poultry-sources/${source}/reactivate`);
        fake.api.mockClear();
        fake.api.mockRejectedValueOnce(new ManagementApiError('INVENTORY_DEFINITION_CHANGED'));
        expect(
            (
                await saveProductAction(
                    {},
                    form({
                        name: 'Produce',
                        kind: 'PRODUCE',
                        inventoryItemId: item,
                        expectedInventoryUnit: 'KG',
                    }),
                )
            ).error,
        ).toContain('unit changed');
        expect(fake.api).toHaveBeenCalledTimes(1);
    });
});
