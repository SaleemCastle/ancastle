import { describe, expect, it } from 'vitest';
import {
  calculateInvoiceDueDate,
  invoiceGrossAmount,
  invoiceLineAmount,
} from './invoice-calculations.js';

describe('invoice calculations', () => {
  it('uses exact decimal multiplication and half-up JMD cent rounding', () => {
    expect(invoiceLineAmount('0.125', '1.00').toFixed(2)).toBe('0.13');
    expect(invoiceLineAmount('3', '0.335').toFixed(2)).toBe('1.01');
    expect(
      invoiceLineAmount('100000000000000.125', '100.0000').toFixed(2),
    ).toBe('10000000000000012.50');
  });
  it('represents the maximum M5 line and 100-line invoice exactly in DECIMAL(34,2)', () => {
    const maximumLine = invoiceLineAmount(
      '999999999999999.999',
      '999999999999999.9999',
    );
    expect(maximumLine.toFixed(2)).toBe('999999999999999998900000000000.00');
    const maximumInvoice = invoiceGrossAmount(
      Array.from({ length: 100 }, () => maximumLine),
    );
    expect(maximumInvoice.toFixed(2)).toBe(
      '99999999999999999890000000000000.00',
    );
  });
  it('adds rounded line amounts to produce invoice gross', () => {
    const total = invoiceGrossAmount([
      invoiceLineAmount('1', '0.335'),
      invoiceLineAmount('1', '0.335'),
    ]);
    expect(total.toFixed(2)).toBe('0.68');
  });
  it('calculates cash due date on issue date and credit due date from snapshotted terms', () => {
    const issued = new Date('2026-02-27T23:30:00.000Z');
    expect(calculateInvoiceDueDate(issued, 'CASH', null).toISOString()).toBe(
      '2026-02-27T00:00:00.000Z',
    );
    expect(calculateInvoiceDueDate(issued, 'CREDIT', 3).toISOString()).toBe(
      '2026-03-02T00:00:00.000Z',
    );
  });
  it('uses the Jamaica issue calendar date across the UTC midnight boundary', () => {
    const beforeJamaicaMidnight = new Date('2026-02-28T04:59:59.999Z');
    const atJamaicaMidnight = new Date('2026-02-28T05:00:00.000Z');
    expect(
      calculateInvoiceDueDate(
        beforeJamaicaMidnight,
        'CASH',
        null,
      ).toISOString(),
    ).toBe('2026-02-27T00:00:00.000Z');
    expect(
      calculateInvoiceDueDate(atJamaicaMidnight, 'CASH', null).toISOString(),
    ).toBe('2026-02-28T00:00:00.000Z');
    expect(
      calculateInvoiceDueDate(beforeJamaicaMidnight, 'CREDIT', 1).toISOString(),
    ).toBe('2026-02-28T00:00:00.000Z');
  });
  it('rejects missing and invalid credit term snapshots', () => {
    expect(() => calculateInvoiceDueDate(new Date(), 'CREDIT', null)).toThrow(
      /terms/,
    );
    expect(() => calculateInvoiceDueDate(new Date(), 'CREDIT', -1)).toThrow(
      /terms/,
    );
  });
});
