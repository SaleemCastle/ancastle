import { randomUUID } from 'node:crypto';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { Customer, SalesProduct } from '@ancastle/types';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
import { OrderEditor } from '../../components/sales-orders/order-editor';

describe('sales order editor', () => {
    it('renders customer, poultry and produce choices, agreed JMD prices, terms and no-stock notice', () => {
        const now = new Date().toISOString();
        const customer: Customer = {
            id: randomUUID(),
            code: 'CUS-000001',
            type: 'BUSINESS',
            name: 'Castle Produce',
            contactPerson: null,
            phone: null,
            email: null,
            address: null,
            notes: null,
            isActive: true,
            createdAt: now,
            updatedAt: now,
        };
        const products: SalesProduct[] = [
            {
                id: randomUUID(),
                code: 'PRD-000001',
                name: 'Market birds',
                kind: 'POULTRY',
                unit: 'EACH',
                isActive: true,
                createdAt: now,
                updatedAt: now,
            },
            {
                id: randomUUID(),
                code: 'PRD-000002',
                name: 'Pumpkin',
                kind: 'PRODUCE',
                unit: 'KG',
                inventoryItemId: randomUUID(),
                isActive: true,
                createdAt: now,
                updatedAt: now,
            },
        ];
        const html = renderToStaticMarkup(
            createElement(OrderEditor, {
                organization: randomUUID(),
                customers: [customer],
                products,
            }),
        );
        expect(html).toContain('Castle Produce');
        expect(html).toContain('Market birds');
        expect(html).toContain('Pumpkin');
        expect(html).toContain('Agreed unit price (JMD)');
        expect(html).toContain('CREDIT');
        expect(html).toContain('No stock or birds are reserved.');
        expect(html).toContain('Create draft order');
    });
});
