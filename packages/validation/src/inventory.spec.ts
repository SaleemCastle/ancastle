import { describe, expect, it } from 'vitest';
import {
    createInventoryItemSchema,
    inventoryQuerySchema,
    updateInventoryItemSchema,
} from './index.js';

describe('Inventory validation', () => {
    it('accepts and normalizes a valid inventory item', () => {
        expect(
            createInventoryItemSchema.parse({
                name: '   Broiler Feed   ',
                description: '   Starter ration   ',
                unit: 'KG',
                category: 'FEED',
                lowStockThreshold: '25.500',
            }),
        ).toEqual({
            name: 'Broiler Feed',
            description: 'Starter ration',
            unit: 'KG',
            category: 'FEED',
            lowStockThreshold: 25.5,
        });
    });

    it('rejects invalid enum values and client-controlled fields', () => {
        expect(
            createInventoryItemSchema.safeParse({
                name: 'Broiler Feed',
                unit: 'BAG',
                category: 'CHICKEN',
                organizationId: 'organization-id',
                farmId: 'farm-id',
                code: 'INV-000001',
                isActive: true,
                quantityOnHand: 100,
            }).success,
        ).toBe(false);
    });

    it('supports partial updates while rejecting negative thresholds', () => {
        expect(
            updateInventoryItemSchema.parse({
                description: '',
                lowStockThreshold: null,
            }),
        ).toEqual({
            description: null,
            lowStockThreshold: null,
        });

        expect(
            updateInventoryItemSchema.safeParse({
                lowStockThreshold: -1,
            }).success,
        ).toBe(false);
    });

    it('parses inventory list query parameters', () => {
        expect(
            inventoryQuerySchema.parse({
                page: '2',
                pageSize: '25',
                search: '  feed  ',
                isActive: 'false',
            }),
        ).toEqual({
            page: 2,
            pageSize: 25,
            search: 'feed',
            isActive: false,
        });
    });

    expect(
        updateInventoryItemSchema.safeParse({
            lowStockThreshold: 1.1234,
        }).success,
    ).toBe(false);
});
