import { Prisma } from '../../generated/prisma/client.js';

const ExactDecimal = Prisma.Decimal.clone({ precision: 40 });

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
  const result = new Date(
    Date.UTC(
      issueDate.getUTCFullYear(),
      issueDate.getUTCMonth(),
      issueDate.getUTCDate(),
    ),
  );
  result.setUTCDate(
    result.getUTCDate() + (saleType === 'CREDIT' ? creditTermDays! : 0),
  );
  return result;
}
