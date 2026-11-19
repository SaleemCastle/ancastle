import { randomUUID } from 'node:crypto';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/app/app/orders/fulfilment-actions', () => ({
    postFulfilmentAction: vi.fn(),
    reverseFulfilmentAction: vi.fn(),
}));
import { FulfilmentPanel } from '../../components/sales-orders/fulfilment-panel';

describe('fulfilment panel', () => {
    it('shows authorized source availability, physical remaining units, immutable history and redacted access boundaries', () => {
        const orderLineId = randomUUID();
        const eventId = randomUUID();
        const html = renderToStaticMarkup(
            createElement(FulfilmentPanel, {
                organization: randomUUID(),
                orderId: randomUUID(),
                orderVersion: 3,
                farmId: randomUUID(),
                farmName: 'North Farm',
                canPost: true,
                canReverse: true,
                lines: [
                    {
                        id: orderLineId,
                        productName: 'Pumpkin',
                        kind: 'PRODUCE',
                        unit: 'KG',
                        remainingQuantity: '4.125',
                    },
                    {
                        id: randomUUID(),
                        productName: 'Layers',
                        kind: 'POULTRY',
                        unit: 'EACH',
                        remainingQuantity: '8',
                    },
                ],
                sources: [
                    {
                        id: randomUUID(),
                        lineId: orderLineId,
                        label: 'INV-004 · Pumpkin',
                        available: '9.375',
                        unit: 'KG',
                    },
                    {
                        id: randomUUID(),
                        lineId: 'other-line',
                        label: 'Eligible flock',
                        available: '7',
                        unit: 'EACH',
                    },
                ],
                history: [
                    {
                        id: eventId,
                        code: 'FUL-POST-1',
                        kind: 'POSTING',
                        farmId: randomUUID(),
                        occurredAt: new Date().toISOString(),
                        createdAt: new Date().toISOString(),
                        actorUserId: randomUUID(),
                        note: null,
                        reference: 'Delivery note 5',
                        reversesFulfilmentId: null,
                        lines: [
                            {
                                id: randomUUID(),
                                orderLineId,
                                quantity: '1.25',
                                unit: 'KG',
                                sourceCode: 'INV-004',
                                reversesLineId: null,
                            },
                        ],
                    },
                ],
                historyPage: 1,
                historyPages: 1,
                historyHref: '/app/orders/' + randomUUID(),
            }),
        );
        expect(html).toContain('North Farm');
        expect(html).toContain('available 9.375 KG');
        expect(html).toContain('Remaining 4.125 KG');
        expect(html).toContain('Quantity (KG)');
        expect(html).toContain('FUL-POST-1');
        expect(html).toContain('Reverse full batch');
        expect(html).toContain('point-in-time read');
        expect(html).not.toContain('invoice');
        expect(html).not.toContain('paid');
    });

    it('renders no-source, no-farm and read-only states', () => {
        const html = renderToStaticMarkup(
            createElement(FulfilmentPanel, {
                organization: randomUUID(),
                orderId: randomUUID(),
                orderVersion: 1,
                farmId: null,
                canPost: false,
                canReverse: false,
                lines: [],
                sources: [],
                history: [],
                historyPage: 1,
                historyPages: 0,
                historyHref: '/app/orders/' + randomUUID(),
            }),
        );
        expect(html).toContain('Select an authorized farm');
        expect(html).not.toContain('Post fulfilment');
    });
});
