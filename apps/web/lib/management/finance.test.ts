import { describe, expect, it } from 'vitest';
import { formatJamaicaDate, formatJamaicaInstant, formatJmdAmount } from './finance';

describe('invoice finance formatters', () => {
    it('formats exact JMD strings including the maximum supported invoice amount', () => {
        expect(formatJmdAmount('12345678901234567890123456789012.34')).toBe(
            'JMD 12,345,678,901,234,567,890,123,456,789,012.34',
        );
        expect(formatJmdAmount('0.05')).toBe('JMD 0.05');
    });

    it('rejects malformed decimal strings instead of coercing through Number', () => {
        expect(() => formatJmdAmount('01.00')).toThrow();
        expect(() => formatJmdAmount('1.001')).toThrow();
    });

    it('formats stored dates as calendar dates and instants in Jamaica time', () => {
        expect(formatJamaicaDate('2026-01-01')).toBe('1 Jan 2026');
        expect(formatJamaicaInstant('2026-01-01T02:00:00.000Z')).toBe('31 Dec 2025');
    });
});
