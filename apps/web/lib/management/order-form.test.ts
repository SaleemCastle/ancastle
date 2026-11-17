import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { SalesProduct } from '@ancastle/types';
import { estimateOrderCents, expectedProduct, formatJmdAmount, formatJmdCents } from './order-form';

describe('sales order presentation helpers', () => {
    it('keeps poultry as whole-bird EACH and produce linked to its catalog unit', () => {
        const poultry: SalesProduct = {
            id: randomUUID(),
            code: 'PRD-1',
            name: 'Birds',
            kind: 'POULTRY',
            unit: 'EACH',
            isActive: true,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
        const produce: SalesProduct = {
            id: randomUUID(),
            code: 'PRD-2',
            name: 'Pumpkin',
            kind: 'PRODUCE',
            unit: 'KG',
            inventoryItemId: randomUUID(),
            isActive: true,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
        expect(expectedProduct(poultry)).toEqual({ kind: 'POULTRY', unit: 'EACH' });
        expect(expectedProduct(produce)).toEqual({
            kind: 'PRODUCE',
            unit: 'KG',
            inventoryItemId: produce.inventoryItemId,
        });
    });

    it('previews line-rounded JMD amounts without floating point and groups exact server amounts', () => {
        expect(
            estimateOrderCents([
                { quantity: '1.250', unitPrice: '12.3456' },
                { quantity: '1', unitPrice: '1.0050' },
            ]),
        ).toBe('1644');
        expect(formatJmdCents('1644')).toBe('16.44');
        expect(formatJmdAmount('123456789.00')).toBe('JMD 123,456,789.00');
        expect(estimateOrderCents([{ quantity: '0.000', unitPrice: '2.0000' }])).toBeNull();
        expect(estimateOrderCents([{ quantity: '1.000', unitPrice: 'bad' }])).toBeNull();
    });
});
