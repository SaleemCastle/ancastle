import type { SalesProduct } from '@ancastle/types';

export interface EditableOrderLine {
    key: string;
    lineId?: string;
    productId: string;
    quantity: string;
    unitPrice: string;
    removed?: boolean;
}

export function expectedProduct(product: SalesProduct) {
    return product.kind === 'POULTRY'
        ? { kind: 'POULTRY' as const, unit: 'EACH' as const }
        : {
              kind: 'PRODUCE' as const,
              unit: product.unit,
              inventoryItemId: product.inventoryItemId,
          };
}

function addDigits(left: string, right: string): string {
    let carry = 0;
    let output = '';
    for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
        const a = Number(left[left.length - 1 - index] ?? 0);
        const b = Number(right[right.length - 1 - index] ?? 0);
        const sum = a + b + carry;
        output = String(sum % 10) + output;
        carry = Math.floor(sum / 10);
    }
    return (carry ? String(carry) : '') + output;
}

function multiplyDigits(left: string, right: string): string {
    const result = Array<number>(left.length + right.length).fill(0);
    for (let i = left.length - 1; i >= 0; i -= 1) {
        for (let j = right.length - 1; j >= 0; j -= 1) {
            const position = i + j + 1;
            const value = Number(left[i]) * Number(right[j]) + result[position];
            result[position] = value % 10;
            result[position - 1] += Math.floor(value / 10);
        }
    }
    return result.join('').replace(/^0+(?=\d)/, '');
}

function scaledDigits(value: string, scale: number, integerDigits: number): string | null {
    const match = new RegExp(
        `^(0|[1-9]\\d{0,${integerDigits - 1}})(?:\\.(\\d{1,${scale}}))?$`,
    ).exec(value);
    if (!match) return null;
    return (match[1]! + (match[2] ?? '').padEnd(scale, '0')).replace(/^0+(?=\d)/, '');
}

function incrementDigits(value: string): string {
    return addDigits(value, '1');
}

/** Mirrors per-line half-up rounding without floating point; saved totals come from the API. */
export function estimateOrderCents(
    lines: Array<{ quantity: string; unitPrice: string }>,
): string | null {
    let total = '0';
    for (const line of lines) {
        const quantity = scaledDigits(line.quantity, 3, 15);
        const price = scaledDigits(line.unitPrice, 4, 15);
        if (!quantity || quantity === '0' || price === null) return null;
        const product = multiplyDigits(quantity, price);
        const padded = product.padStart(6, '0');
        let cents = padded.slice(0, -5).replace(/^0+(?=\d)/, '');
        const remainder = Number(padded.slice(-5));
        if (remainder >= 50_000) cents = incrementDigits(cents);
        total = addDigits(total, cents);
    }
    return total;
}

export function formatJmdCents(cents: string): string {
    const padded = cents.padStart(3, '0');
    const whole = padded.slice(0, -2);
    const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return `${grouped}.${padded.slice(-2)}`;
}

export function formatJmdAmount(amount: string): string {
    const [whole, fraction] = amount.split('.');
    const grouped = (whole ?? '0').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return `JMD ${grouped}.${(fraction ?? '00').padEnd(2, '0')}`;
}
