import { Injectable } from '@nestjs/common';
import type {
  CustomerStatementResponse,
  ReceivableAgingBucket,
  ReceivableCustomerListResponse,
  ReceivableCustomerSummary,
  ReceivableInvoice,
  ReceivableInvoiceListResponse,
} from '@ancastle/types';
import type {
  ReceivableCustomerQuery,
  ReceivableInvoiceQuery,
  StatementQuery,
} from '@ancastle/validation';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { BusinessException } from '../../common/exceptions/business.exception.js';
import type { OrganizationContext } from '../authorization/organization-context.js';
import { AuthorizationService } from '../authorization/authorization.service.js';
import { Permission } from '../authorization/permissions.js';

const TIME_ZONE = 'America/Jamaica';
const fault = (code: string, message: string, status = 409) =>
  new BusinessException(code, message, status);

type InvoiceBalanceRow = {
  invoiceId: string;
  invoiceNumber: string;
  customerId: string;
  issuedAt: Date;
  dueAt: Date;
  grossAmount: string;
  allocatedAmount: string;
  outstandingAmount: string;
};

type CustomerBalanceRow = {
  customerId: string;
  customerCode: string;
  customerName: string;
  invoiceCount: number;
  overdueInvoiceCount: number;
  totalOutstanding: string;
  current: string;
  days1To30: string;
  days31To60: string;
  days61To90: string;
  over90: string;
  unappliedCash: string;
};

type LedgerTotals = { opening: string; closing: string; totalItems: number };
type LedgerRow = {
  id: string;
  type: 'INVOICE' | 'PAYMENT_ALLOCATION' | 'ALLOCATION_REVERSAL';
  invoiceId: string;
  invoiceNumber: string;
  businessDate: string;
  effectiveAt: Date;
  direction: 'DEBIT' | 'CREDIT';
  amount: string;
};

function cents(value: string): bigint {
  const [whole, fraction = '00'] = value.split('.');
  return BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, '0'));
}

function money(value: bigint): string {
  const sign = value < 0n ? '-' : '';
  const absolute = value < 0n ? -value : value;
  return `${sign}${absolute / 100n}.${(absolute % 100n).toString().padStart(2, '0')}`;
}

function jamaicaDate(value: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const part = (type: string) =>
    parts.find((item) => item.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function localMidnightUtc(date: string): Date {
  const [year, month, day] = date.split('-').map(Number);
  const target = Date.UTC(year!, month! - 1, day!);
  let guess = target;
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  for (let i = 0; i < 3; i += 1) {
    const parts = formatter.formatToParts(new Date(guess));
    const part = (type: string) =>
      Number(parts.find((item) => item.type === type)!.value);
    const localAsUtc = Date.UTC(
      part('year'),
      part('month') - 1,
      part('day'),
      part('hour'),
      part('minute'),
      part('second'),
    );
    guess = target - (localAsUtc - guess);
  }
  return new Date(guess);
}

function nextDate(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year!, month! - 1, day! + 1))
    .toISOString()
    .slice(0, 10);
}

function statementCutoff(to: string, requested?: string): Date {
  const endExclusive = localMidnightUtc(nextDate(to));
  const inclusiveEnd = new Date(endExclusive.getTime() - 1);
  if (!requested) return inclusiveEnd;
  const requestedAt = new Date(requested);
  return requestedAt < inclusiveEnd ? requestedAt : inclusiveEnd;
}

function daysBetween(from: string, to: string): number {
  return Math.floor(
    (Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) /
      86_400_000,
  );
}

function agingBucket(daysOverdue: number): ReceivableAgingBucket {
  if (daysOverdue <= 0) return 'CURRENT';
  if (daysOverdue <= 30) return '1_TO_30';
  if (daysOverdue <= 60) return '31_TO_60';
  if (daysOverdue <= 90) return '61_TO_90';
  return 'OVER_90';
}

@Injectable()
export class ReceivablesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorization: AuthorizationService,
  ) {}

  async listInvoices(
    context: OrganizationContext,
    query: ReceivableInvoiceQuery,
  ): Promise<ReceivableInvoiceListResponse> {
    await this.authorize(context, Permission.RECEIVABLE_READ);
    const asOfDate = query.asOfDate ?? jamaicaDate(new Date());
    const filterStatus = query.status ?? null;
    const filterOverdue = query.overdue ?? null;
    const filterBucket = query.agingBucket ?? null;
    const customerId = query.customerId?.toLowerCase() ?? null;
    return this.prisma.$transaction(
      async (tx) => {
        const records = await tx.$queryRaw<InvoiceBalanceRow[]>`
        WITH active_allocations AS (
          SELECT pa."organizationId", pa."invoiceId", SUM(pa."amount") AS amount
          FROM "payment_allocations" pa
          WHERE pa."organizationId" = ${context.organizationId}::uuid
            AND NOT EXISTS (
              SELECT 1 FROM "payment_allocation_reversals" reversal
              WHERE reversal."organizationId" = pa."organizationId"
                AND reversal."paymentId" = pa."paymentId"
                AND reversal."allocationId" = pa."id"
            )
          GROUP BY pa."organizationId", pa."invoiceId"
        ), invoice_balances AS (
          SELECT i."id" AS "invoiceId", i."invoiceNumber", i."customerId", i."issuedAt", i."dueAt",
            i."grossAmount"::text AS "grossAmount",
            COALESCE(a.amount, 0)::text AS "allocatedAmount",
            (i."grossAmount" - COALESCE(a.amount, 0))::text AS "outstandingAmount"
          FROM "invoices" i
          LEFT JOIN active_allocations a ON a."organizationId" = i."organizationId" AND a."invoiceId" = i."id"
          WHERE i."organizationId" = ${context.organizationId}::uuid
            AND i."status" = 'ISSUED'
            AND (${customerId}::uuid IS NULL OR i."customerId" = ${customerId}::uuid)
        ), classified AS (
          SELECT b.*,
            GREATEST(0, (${asOfDate}::date - b."dueAt"))::int AS "daysOverdue",
            CASE WHEN b."outstandingAmount"::numeric = 0 THEN 'PAID'
              WHEN b."outstandingAmount"::numeric = b."grossAmount"::numeric THEN 'UNPAID'
              ELSE 'PARTIALLY_PAID' END AS status
          FROM invoice_balances b
        )
        SELECT "invoiceId", "invoiceNumber", "customerId", "issuedAt", "dueAt", "grossAmount", "allocatedAmount", "outstandingAmount"
        FROM classified
        WHERE (${filterStatus}::text IS NULL OR status = ${filterStatus}::text)
          AND (${filterOverdue}::boolean IS NULL OR (("outstandingAmount"::numeric > 0 AND "daysOverdue" > 0) = ${filterOverdue}::boolean))
          AND (${filterBucket}::text IS NULL OR
            ("outstandingAmount"::numeric > 0 AND CASE
              WHEN "daysOverdue" = 0 THEN 'CURRENT'
              WHEN "daysOverdue" <= 30 THEN '1_TO_30'
              WHEN "daysOverdue" <= 60 THEN '31_TO_60'
              WHEN "daysOverdue" <= 90 THEN '61_TO_90'
              ELSE 'OVER_90' END = ${filterBucket}::text))
        ORDER BY "issuedAt" DESC, "invoiceId" DESC
        LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}
      `;
        const countRows = await tx.$queryRaw<{ total: bigint }[]>`
        WITH active_allocations AS (
          SELECT pa."organizationId", pa."invoiceId", SUM(pa."amount") AS amount
          FROM "payment_allocations" pa
          WHERE pa."organizationId" = ${context.organizationId}::uuid
            AND NOT EXISTS (SELECT 1 FROM "payment_allocation_reversals" r WHERE r."organizationId" = pa."organizationId" AND r."paymentId" = pa."paymentId" AND r."allocationId" = pa."id")
          GROUP BY pa."organizationId", pa."invoiceId"
        ), classified AS (
          SELECT i."id", i."customerId", i."dueAt", i."grossAmount", i."grossAmount" - COALESCE(a.amount, 0) AS outstanding,
            GREATEST(0, (${asOfDate}::date - i."dueAt"))::int AS days
          FROM "invoices" i LEFT JOIN active_allocations a ON a."organizationId" = i."organizationId" AND a."invoiceId" = i."id"
          WHERE i."organizationId" = ${context.organizationId}::uuid AND i."status" = 'ISSUED'
            AND (${customerId}::uuid IS NULL OR i."customerId" = ${customerId}::uuid)
        ) SELECT COUNT(*)::bigint AS total FROM classified
        WHERE (${filterStatus}::text IS NULL OR CASE WHEN outstanding = 0 THEN 'PAID' WHEN outstanding = "grossAmount" THEN 'UNPAID' ELSE 'PARTIALLY_PAID' END = ${filterStatus}::text)
          AND (${filterOverdue}::boolean IS NULL OR ((outstanding > 0 AND days > 0) = ${filterOverdue}::boolean))
          AND (${filterBucket}::text IS NULL OR (outstanding > 0 AND CASE WHEN days=0 THEN 'CURRENT' WHEN days<=30 THEN '1_TO_30' WHEN days<=60 THEN '31_TO_60' WHEN days<=90 THEN '61_TO_90' ELSE 'OVER_90' END = ${filterBucket}::text))
      `;
        const totalItems = Number(countRows[0]?.total ?? 0n);
        return {
          data: records.map((record) => this.projectInvoice(record, asOfDate)),
          meta: {
            page: query.page,
            pageSize: query.pageSize,
            totalItems,
            totalPages: Math.ceil(totalItems / query.pageSize),
            asOfDate,
          },
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }

  async listCustomers(
    context: OrganizationContext,
    query: ReceivableCustomerQuery,
  ): Promise<ReceivableCustomerListResponse> {
    await this.authorize(context, Permission.RECEIVABLE_READ);
    const asOfDate = query.asOfDate ?? jamaicaDate(new Date());
    const search = query.search?.trim() || null;
    return this.prisma.$transaction(
      async (tx) => {
        const rows = await tx.$queryRaw<CustomerBalanceRow[]>`
        WITH active_allocations AS (
          SELECT pa."organizationId", pa."invoiceId", SUM(pa."amount") AS amount
          FROM "payment_allocations" pa
          WHERE pa."organizationId" = ${context.organizationId}::uuid
            AND NOT EXISTS (SELECT 1 FROM "payment_allocation_reversals" r WHERE r."organizationId" = pa."organizationId" AND r."paymentId" = pa."paymentId" AND r."allocationId" = pa."id")
          GROUP BY pa."organizationId", pa."invoiceId"
        ), invoices AS (
          SELECT i."customerId", i."dueAt", i."grossAmount" - COALESCE(a.amount, 0) AS outstanding,
            GREATEST(0, (${asOfDate}::date - i."dueAt"))::int AS days
          FROM "invoices" i LEFT JOIN active_allocations a ON a."organizationId" = i."organizationId" AND a."invoiceId" = i."id"
          WHERE i."organizationId" = ${context.organizationId}::uuid AND i."status" = 'ISSUED'
        ), cash AS (
          SELECT p."customerId", SUM(p."amount" - COALESCE(a.amount, 0)) AS amount
          FROM "payments" p
          JOIN "payment_lifecycle_events" verified ON verified."organizationId" = p."organizationId" AND verified."paymentId" = p."id" AND verified.type = 'VERIFIED'
          LEFT JOIN "payment_lifecycle_events" reversed ON reversed."organizationId" = p."organizationId" AND reversed."paymentId" = p."id" AND reversed.type = 'REVERSED'
          LEFT JOIN LATERAL (
            SELECT SUM(pa."amount") - COALESCE(SUM(pr."amount"), 0) AS amount
            FROM "payment_allocations" pa LEFT JOIN "payment_allocation_reversals" pr
              ON pr."organizationId" = pa."organizationId" AND pr."paymentId" = pa."paymentId" AND pr."allocationId" = pa."id"
            WHERE pa."organizationId" = p."organizationId" AND pa."paymentId" = p."id"
          ) a ON TRUE
          WHERE p."organizationId" = ${context.organizationId}::uuid AND reversed.id IS NULL
          GROUP BY p."customerId"
        )
        SELECT c.id AS "customerId", c.code AS "customerCode", c.name AS "customerName",
          COUNT(i."customerId")::int AS "invoiceCount",
          COUNT(i."customerId") FILTER (WHERE i.outstanding > 0 AND i.days > 0)::int AS "overdueInvoiceCount",
          COALESCE(SUM(i.outstanding), 0)::text AS "totalOutstanding",
          COALESCE(SUM(i.outstanding) FILTER (WHERE i.days = 0), 0)::text AS current,
          COALESCE(SUM(i.outstanding) FILTER (WHERE i.days BETWEEN 1 AND 30), 0)::text AS "days1To30",
          COALESCE(SUM(i.outstanding) FILTER (WHERE i.days BETWEEN 31 AND 60), 0)::text AS "days31To60",
          COALESCE(SUM(i.outstanding) FILTER (WHERE i.days BETWEEN 61 AND 90), 0)::text AS "days61To90",
          COALESCE(SUM(i.outstanding) FILTER (WHERE i.days > 90), 0)::text AS over90,
          COALESCE(cash.amount, 0)::text AS "unappliedCash"
        FROM "customers" c
        LEFT JOIN invoices i ON i."customerId" = c.id
        LEFT JOIN cash ON cash."customerId" = c.id
        WHERE c."organizationId" = ${context.organizationId}::uuid
          AND (${search}::text IS NULL OR c.code ILIKE '%' || ${search}::text || '%' OR c.name ILIKE '%' || ${search}::text || '%')
        GROUP BY c.id, c.code, c.name, cash.amount
        ORDER BY c.name ASC, c.id ASC
        LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}
      `;
        const count = await tx.customer.count({
          where: {
            organizationId: context.organizationId,
            ...(search
              ? {
                  OR: [
                    {
                      code: { contains: search, mode: 'insensitive' as const },
                    },
                    {
                      name: { contains: search, mode: 'insensitive' as const },
                    },
                  ],
                }
              : {}),
          },
        });
        return {
          data: rows.map((row) => this.projectCustomer(row)),
          meta: {
            page: query.page,
            pageSize: query.pageSize,
            totalItems: count,
            totalPages: Math.ceil(count / query.pageSize),
            asOfDate,
          },
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }

  async getCustomer(
    context: OrganizationContext,
    rawCustomerId: string,
    asOfDate?: string,
  ) {
    await this.authorize(context, Permission.RECEIVABLE_READ);
    const customerId = rawCustomerId.toLowerCase();
    const date = asOfDate ?? jamaicaDate(new Date());
    return this.prisma.$transaction(
      async (tx) => {
        const rows = await tx.$queryRaw<CustomerBalanceRow[]>`
        WITH active_allocations AS (
          SELECT pa."organizationId", pa."invoiceId", SUM(pa."amount") AS amount
          FROM "payment_allocations" pa WHERE pa."organizationId" = ${context.organizationId}::uuid
            AND NOT EXISTS (SELECT 1 FROM "payment_allocation_reversals" r WHERE r."organizationId" = pa."organizationId" AND r."paymentId" = pa."paymentId" AND r."allocationId" = pa."id")
          GROUP BY pa."organizationId", pa."invoiceId"
        ), invoices AS (
          SELECT i."customerId", i."dueAt", i."grossAmount" - COALESCE(a.amount, 0) AS outstanding,
            GREATEST(0, (${date}::date - i."dueAt"))::int AS days
          FROM "invoices" i LEFT JOIN active_allocations a ON a."organizationId" = i."organizationId" AND a."invoiceId" = i."id"
          WHERE i."organizationId" = ${context.organizationId}::uuid AND i."customerId" = ${customerId}::uuid AND i."status" = 'ISSUED'
        ), cash AS (
          SELECT p."customerId", SUM(p."amount" - COALESCE(a.amount, 0)) AS amount
          FROM "payments" p JOIN "payment_lifecycle_events" v ON v."organizationId" = p."organizationId" AND v."paymentId" = p.id AND v.type = 'VERIFIED'
          LEFT JOIN "payment_lifecycle_events" r ON r."organizationId" = p."organizationId" AND r."paymentId" = p.id AND r.type = 'REVERSED'
          LEFT JOIN LATERAL (SELECT SUM(pa.amount) - COALESCE(SUM(pr.amount),0) AS amount FROM "payment_allocations" pa
            LEFT JOIN "payment_allocation_reversals" pr ON pr."organizationId"=pa."organizationId" AND pr."paymentId"=pa."paymentId" AND pr."allocationId"=pa.id
            WHERE pa."organizationId"=p."organizationId" AND pa."paymentId"=p.id) a ON TRUE
          WHERE p."organizationId"=${context.organizationId}::uuid AND p."customerId"=${customerId}::uuid AND r.id IS NULL GROUP BY p."customerId"
        )
        SELECT c.id AS "customerId", c.code AS "customerCode", c.name AS "customerName", COUNT(i."customerId")::int AS "invoiceCount",
          COUNT(i."customerId") FILTER(WHERE i.outstanding>0 AND i.days>0)::int AS "overdueInvoiceCount", COALESCE(SUM(i.outstanding),0)::text AS "totalOutstanding",
          COALESCE(SUM(i.outstanding) FILTER(WHERE i.days=0),0)::text AS current,
          COALESCE(SUM(i.outstanding) FILTER(WHERE i.days BETWEEN 1 AND 30),0)::text AS "days1To30",
          COALESCE(SUM(i.outstanding) FILTER(WHERE i.days BETWEEN 31 AND 60),0)::text AS "days31To60",
          COALESCE(SUM(i.outstanding) FILTER(WHERE i.days BETWEEN 61 AND 90),0)::text AS "days61To90",
          COALESCE(SUM(i.outstanding) FILTER(WHERE i.days>90),0)::text AS over90, COALESCE(cash.amount,0)::text AS "unappliedCash"
        FROM "customers" c LEFT JOIN invoices i ON i."customerId"=c.id LEFT JOIN cash ON cash."customerId"=c.id
        WHERE c."organizationId"=${context.organizationId}::uuid AND c.id=${customerId}::uuid GROUP BY c.id,c.code,c.name,cash.amount
      `;
        if (!rows.length)
          throw fault('CUSTOMER_NOT_FOUND', 'Customer was not found', 404);
        return { data: { ...this.projectCustomer(rows[0]!), asOfDate: date } };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }

  async statement(
    context: OrganizationContext,
    rawCustomerId: string,
    query: StatementQuery,
  ): Promise<CustomerStatementResponse> {
    await this.authorize(context, Permission.STATEMENT_READ);
    const customerId = rawCustomerId.toLowerCase();
    const asOfAt = statementCutoff(query.to, query.asOf);
    return this.prisma.$transaction(
      async (tx) => {
        const customer = await tx.customer.findFirst({
          where: { organizationId: context.organizationId, id: customerId },
          select: { id: true, code: true, name: true },
        });
        if (!customer)
          throw fault('CUSTOMER_NOT_FOUND', 'Customer was not found', 404);
        const ledger = Prisma.sql`
        WITH ledger AS (
          SELECT i.id, 'INVOICE'::text AS type, i.id AS "invoiceId", i."invoiceNumber", i."issuedAt" AS "effectiveAt", i."grossAmount" AS amount, 0 AS order_key
          FROM "invoices" i WHERE i."organizationId"=${context.organizationId}::uuid AND i."customerId"=${customerId}::uuid AND i."status"='ISSUED'
          UNION ALL
          SELECT pa.id, 'PAYMENT_ALLOCATION'::text, pa."invoiceId", i."invoiceNumber", pa."createdAt", pa.amount, 1
          FROM "payment_allocations" pa JOIN "invoices" i ON i."organizationId"=pa."organizationId" AND i.id=pa."invoiceId"
          WHERE pa."organizationId"=${context.organizationId}::uuid AND pa."customerId"=${customerId}::uuid
          UNION ALL
          SELECT reversal.id, 'ALLOCATION_REVERSAL'::text, pa."invoiceId", i."invoiceNumber", reversal."createdAt", reversal.amount, 2
          FROM "payment_allocation_reversals" reversal
          JOIN "payment_allocations" pa ON pa."organizationId"=reversal."organizationId" AND pa."paymentId"=reversal."paymentId" AND pa.id=reversal."allocationId"
          JOIN "invoices" i ON i."organizationId"=pa."organizationId" AND i.id=pa."invoiceId"
          WHERE reversal."organizationId"=${context.organizationId}::uuid AND pa."customerId"=${customerId}::uuid
        ), dated AS (
          SELECT ledger.*, ("effectiveAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Jamaica')::date AS "businessDate",
            CASE WHEN type='PAYMENT_ALLOCATION' THEN 'CREDIT' ELSE 'DEBIT' END AS direction,
            CASE WHEN type='PAYMENT_ALLOCATION' THEN -amount ELSE amount END AS signed_amount
          FROM ledger WHERE "effectiveAt" <= ${asOfAt}
        )`;
        const totals = await tx.$queryRaw<LedgerTotals[]>(Prisma.sql`
        ${ledger}
        SELECT COALESCE(SUM(signed_amount) FILTER (WHERE "businessDate" < ${query.from}::date),0)::text AS opening,
          COALESCE(SUM(signed_amount) FILTER (WHERE "businessDate" <= ${query.to}::date),0)::text AS closing,
          COUNT(*) FILTER (WHERE "businessDate" BETWEEN ${query.from}::date AND ${query.to}::date)::int AS "totalItems"
        FROM dated`);
        const entries = await tx.$queryRaw<LedgerRow[]>(Prisma.sql`
        ${ledger}
        SELECT id, type, "invoiceId", "invoiceNumber", "businessDate"::text AS "businessDate", "effectiveAt", direction,
          amount::text AS amount
        FROM dated WHERE "businessDate" BETWEEN ${query.from}::date AND ${query.to}::date
        ORDER BY "businessDate" ASC, "effectiveAt" ASC, order_key ASC, id ASC
        LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}`);
        const unappliedRows = await tx.$queryRaw<{ amount: string }[]>`
        SELECT COALESCE(SUM(p.amount - COALESCE(a.amount, 0)), 0)::text AS amount
        FROM payments p
        LEFT JOIN LATERAL (
          SELECT COALESCE(SUM(pa.amount), 0) - COALESCE((
            SELECT SUM(pr.amount) FROM payment_allocation_reversals pr
            JOIN payment_allocations reversed_allocation ON reversed_allocation."organizationId"=pr."organizationId"
              AND reversed_allocation."paymentId"=pr."paymentId" AND reversed_allocation.id=pr."allocationId"
            WHERE pr."organizationId"=p."organizationId" AND pr."paymentId"=p.id AND pr."createdAt" <= ${asOfAt}
          ), 0) AS amount
          FROM payment_allocations pa WHERE pa."organizationId"=p."organizationId" AND pa."paymentId"=p.id AND pa."createdAt" <= ${asOfAt}
        ) a ON TRUE
        WHERE p."organizationId"=${context.organizationId}::uuid AND p."customerId"=${customerId}::uuid
          AND EXISTS (SELECT 1 FROM payment_lifecycle_events v WHERE v."organizationId"=p."organizationId" AND v."paymentId"=p.id AND v.type='VERIFIED' AND v."createdAt" <= ${asOfAt})
          AND NOT EXISTS (SELECT 1 FROM payment_lifecycle_events r WHERE r."organizationId"=p."organizationId" AND r."paymentId"=p.id AND r.type='REVERSED' AND r."createdAt" <= ${asOfAt})
      `;
        const totalItems = Number(totals[0]?.totalItems ?? 0);
        const opening = cents(totals[0]?.opening ?? '0.00');
        const closing = cents(totals[0]?.closing ?? '0.00');
        return {
          data: {
            organizationId: context.organizationId,
            customerId: customer.id,
            customerCode: customer.code,
            customerName: customer.name,
            currency: 'JMD',
            from: query.from,
            to: query.to,
            asOfAt: asOfAt.toISOString(),
            openingBalance: money(opening),
            closingBalance: money(closing),
            unappliedCash: money(cents(unappliedRows[0]?.amount ?? '0.00')),
            entries: entries.map((entry) => ({
              ...entry,
              effectiveAt: entry.effectiveAt.toISOString(),
            })),
            meta: {
              page: query.page,
              pageSize: query.pageSize,
              totalItems,
              totalPages: Math.ceil(totalItems / query.pageSize),
            },
          },
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }

  private projectInvoice(
    record: InvoiceBalanceRow,
    asOfDate: string,
  ): ReceivableInvoice {
    const outstanding = cents(record.outstandingAmount);
    const gross = cents(record.grossAmount);
    const daysOverdue = Math.max(
      0,
      daysBetween(record.dueAt.toISOString().slice(0, 10), asOfDate),
    );
    return {
      invoiceId: record.invoiceId,
      invoiceNumber: record.invoiceNumber,
      customerId: record.customerId,
      currency: 'JMD',
      issuedAt: record.issuedAt.toISOString(),
      dueAt: record.dueAt.toISOString().slice(0, 10),
      grossAmount: money(gross),
      allocatedAmount: money(cents(record.allocatedAmount)),
      outstandingAmount: money(outstanding),
      status:
        outstanding === 0n
          ? 'PAID'
          : outstanding === gross
            ? 'UNPAID'
            : 'PARTIALLY_PAID',
      overdue: outstanding > 0n && daysOverdue > 0,
      daysOverdue,
      agingBucket: agingBucket(daysOverdue),
    };
  }

  private projectCustomer(row: CustomerBalanceRow): ReceivableCustomerSummary {
    return {
      customerId: row.customerId,
      customerCode: row.customerCode,
      customerName: row.customerName,
      currency: 'JMD',
      invoiceCount: row.invoiceCount,
      overdueInvoiceCount: row.overdueInvoiceCount,
      totalOutstanding: money(cents(row.totalOutstanding)),
      unappliedCash: money(cents(row.unappliedCash)),
      aging: {
        current: money(cents(row.current)),
        days1To30: money(cents(row.days1To30)),
        days31To60: money(cents(row.days31To60)),
        days61To90: money(cents(row.days61To90)),
        over90: money(cents(row.over90)),
      },
    };
  }

  private async authorize(
    context: OrganizationContext,
    permission: Permission,
  ) {
    const membership = await this.prisma.organizationMembership.findFirst({
      where: {
        id: context.membershipId,
        organizationId: context.organizationId,
        userId: context.userId,
        isActive: true,
        organization: { isActive: true },
        user: { isActive: true },
      },
      select: { role: true },
    });
    if (
      !membership ||
      membership.role !== context.role ||
      !this.authorization.hasAllPermissions(membership.role, [permission])
    ) {
      throw fault(
        'FORBIDDEN',
        'You do not have permission to access receivables',
        403,
      );
    }
  }
}
