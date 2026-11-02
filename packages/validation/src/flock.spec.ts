import { describe, expect, it } from 'vitest';
import { createFlockSchema, flockQuerySchema, updateFlockSchema } from './index.js';

const placement = {
    name: 'November placement',
    placementDate: '2026-11-01',
    startingBirdCount: 100,
};

describe('Flock contracts', () => {
    it('normalizes placement text while preserving open bird-type labels and calendar dates', () => {
        expect(
            createFlockSchema.parse({
                ...placement,
                name: ' November placement ',
                birdType: ' Heritage turkey ',
                expectedMaturityDate: '2027-03-01',
                notes: ' First placement ',
            }),
        ).toEqual({
            ...placement,
            birdType: 'Heritage turkey',
            expectedMaturityDate: '2027-03-01',
            notes: 'First placement',
        });
    });

    it('uses undefined for blank optional create fields and null to clear update fields', () => {
        expect(
            createFlockSchema.parse({
                ...placement,
                birdType: ' ',
                notes: '',
                expectedMaturityDate: ' ',
            }),
        ).toEqual({
            ...placement,
            birdType: undefined,
            notes: undefined,
            expectedMaturityDate: undefined,
        });
        for (const clear of [null, ' ']) {
            expect(
                updateFlockSchema.parse({
                    birdType: clear,
                    notes: clear,
                    expectedMaturityDate: clear,
                }),
            ).toEqual({ birdType: null, notes: null, expectedMaturityDate: null });
        }
        expect(
            createFlockSchema.safeParse({ ...placement, expectedMaturityDate: null }).success,
        ).toBe(false);
    });

    it('requires placement fields and rejects empty updates without requiring full replacements', () => {
        for (const field of ['name', 'placementDate', 'startingBirdCount']) {
            const input: Record<string, unknown> = { ...placement };
            delete input[field];
            expect(createFlockSchema.safeParse(input).success).toBe(false);
            expect(updateFlockSchema.safeParse({ [field]: null }).success).toBe(false);
        }
        expect(updateFlockSchema.safeParse({}).success).toBe(false);
        expect(updateFlockSchema.parse({ name: ' Renamed ' })).toEqual({ name: 'Renamed' });
    });

    it('requires positive integer JSON counts within the persistence integer range', () => {
        for (const count of [0, -1, 1.5, 2_147_483_648, '100', '', null, true]) {
            expect(
                createFlockSchema.safeParse({ ...placement, startingBirdCount: count }).success,
            ).toBe(false);
            expect(updateFlockSchema.safeParse({ startingBirdCount: count }).success).toBe(false);
        }
        for (const startingBirdCount of [1, 2_147_483_647]) {
            expect(
                createFlockSchema.parse({ ...placement, startingBirdCount }).startingBirdCount,
            ).toBe(startingBirdCount);
            expect(updateFlockSchema.parse({ startingBirdCount })).toEqual({ startingBirdCount });
        }
    });

    it('bounds descriptive fields on create and update', () => {
        for (const input of [
            { name: ' ' },
            { name: 'x'.repeat(121) },
            { birdType: 'x'.repeat(121) },
            { notes: 'x'.repeat(2001) },
        ]) {
            expect(createFlockSchema.safeParse({ ...placement, ...input }).success).toBe(false);
            expect(updateFlockSchema.safeParse(input).success).toBe(false);
        }
    });

    it('rejects impossible calendar dates and timestamp/timezone coercion in either date field', () => {
        for (const field of ['placementDate', 'expectedMaturityDate']) {
            for (const value of [
                '2026-02-29',
                '2026-04-31',
                '2026-13-01',
                '11/01/2026',
                '2026-11-01T00:00:00Z',
                '2026-11-01T23:00:00-05:00',
                new Date('2026-11-01'),
            ]) {
                expect(createFlockSchema.safeParse({ ...placement, [field]: value }).success).toBe(
                    false,
                );
                expect(updateFlockSchema.safeParse({ [field]: value }).success).toBe(false);
            }
        }
        expect(
            createFlockSchema.parse({ ...placement, placementDate: '2028-02-29' }).placementDate,
        ).toBe('2028-02-29');
    });

    it('allows same-day maturity and reports earlier maturity on the maturity field', () => {
        expect(
            createFlockSchema.parse({ ...placement, expectedMaturityDate: placement.placementDate })
                .expectedMaturityDate,
        ).toBe(placement.placementDate);
        expect(
            updateFlockSchema.parse({
                placementDate: placement.placementDate,
                expectedMaturityDate: placement.placementDate,
            }),
        ).toEqual({
            placementDate: placement.placementDate,
            expectedMaturityDate: placement.placementDate,
        });
        for (const schema of [createFlockSchema, updateFlockSchema]) {
            const result = schema.safeParse({ ...placement, expectedMaturityDate: '2026-10-31' });
            expect(result.success).toBe(false);
            if (!result.success) {
                expect(result.error.issues).toContainEqual(
                    expect.objectContaining({ path: ['expectedMaturityDate'] }),
                );
            }
        }
    });

    it('permits one-date updates for subsequent validation against persisted dates', () => {
        expect(updateFlockSchema.parse({ placementDate: '2026-12-01' })).toEqual({
            placementDate: '2026-12-01',
        });
        expect(updateFlockSchema.parse({ expectedMaturityDate: '2026-12-01' })).toEqual({
            expectedMaturityDate: '2026-12-01',
        });
    });

    it('rejects ownership, generated identity, lifecycle and derived fields independently on both writes', () => {
        const forbidden = {
            id: 'client-id',
            organizationId: 'tenant-id',
            farmId: 'farm-id',
            code: 'FLK-000001',
            isActive: false,
            status: 'CLOSED',
            createdAt: '2026-11-01T00:00:00Z',
            updatedAt: '2026-11-01T00:00:00Z',
            currentBirdCount: 99,
            livePopulation: 99,
            totalMortality: 1,
            mortalityRate: 0.01,
            totalFeedUsage: 10,
            unknown: true,
        };
        for (const [field, value] of Object.entries(forbidden)) {
            for (const schema of [createFlockSchema, updateFlockSchema]) {
                const result = schema.safeParse({ ...placement, [field]: value });
                expect(result.success).toBe(false);
                if (!result.success) {
                    expect(result.error.issues).toContainEqual(
                        expect.objectContaining({
                            code: 'unrecognized_keys',
                            keys: [field],
                        }),
                    );
                }
            }
        }
    });

    it('uses bounded pagination, normalized search and bird labels, and an optional closed filter', () => {
        expect(flockQuerySchema.parse({})).toEqual({ page: 1, pageSize: 20 });
        expect(
            flockQuerySchema.parse({
                page: '2',
                pageSize: '100',
                search: ' November ',
                birdType: ' Broiler chicken ',
                isActive: 'false',
            }),
        ).toEqual({
            page: 2,
            pageSize: 100,
            search: 'November',
            birdType: 'Broiler chicken',
            isActive: false,
        });
        expect(flockQuerySchema.parse({ search: ' ', birdType: ' ', isActive: 'true' })).toEqual({
            page: 1,
            pageSize: 20,
            search: undefined,
            birdType: undefined,
            isActive: true,
        });
    });

    it('rejects unbounded or unsupported flock query input including tenant/farm claims', () => {
        for (const query of [
            { page: '1000001' },
            { pageSize: '101' },
            { page: '0' },
            { pageSize: '1.5' },
            { search: 'x'.repeat(121) },
            { birdType: 'x'.repeat(121) },
            { isActive: 'closed' },
            { organizationId: 'tenant-id' },
            { farmId: 'farm-id' },
        ]) {
            expect(flockQuerySchema.safeParse(query).success).toBe(false);
        }
    });
});
