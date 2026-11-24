import { Prisma } from '../../generated/prisma/client.js';

const ExactDecimal = Prisma.Decimal.clone({ precision: 40 });
const BUSINESS_TIME_ZONE = 'America/Jamaica';

export function businessCalendarDate(at: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(at);
  const part = (type: string) =>
    parts.find((item) => item.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function dateOnlyAsUtc(date: string): Date {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year!, month! - 1, day!));
}

export function invoiceLineAmount(
  quantity: string,
  unitPrice: string,
): Prisma.Decimal {
  return new ExactDecimal(quantity)
    .mul(new ExactDecimal(unitPrice))
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

export function invoiceGrossAmount(
  amounts: readonly Prisma.Decimal[],
): Prisma.Decimal {
  return amounts.reduce((sum, amount) => sum.plus(amount), new ExactDecimal(0));
}

export function calculateInvoiceDueDate(
  issueDate: Date,
  saleType: 'CASH' | 'CREDIT',
  creditTermDays: number | null,
): Date {
  if (
    saleType === 'CREDIT' &&
    (creditTermDays === null ||
      !Number.isInteger(creditTermDays) ||
      creditTermDays < 0)
  ) {
    throw new Error('Valid credit payment terms are required');
  }
  const result = dateOnlyAsUtc(businessCalendarDate(issueDate));
  result.setUTCDate(
    result.getUTCDate() + (saleType === 'CREDIT' ? creditTermDays! : 0),
  );
  return result;
}
