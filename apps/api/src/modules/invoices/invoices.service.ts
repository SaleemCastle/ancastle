import { createHash, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { Invoice, InvoiceListResponse } from '@ancastle/types';
import { idempotencyKeySchema, type InvoiceQuery } from '@ancastle/validation';
import { PrismaService } from '../../database/prisma.service.js';
import { lockMutation } from '../../database/mutation-locks.js';
import { Prisma } from '../../generated/prisma/client.js';
import { BusinessException } from '../../common/exceptions/business.exception.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import type { OrganizationContext } from '../authorization/organization-context.js';
import type { FarmContext } from '../authorization/farm-context.js';
import { FarmAccessService } from '../authorization/farm-access.service.js';
import { AuthorizationService } from '../authorization/authorization.service.js';
import { Permission } from '../authorization/permissions.js';
import { InvoiceActivationService } from './invoice-activation.service.js';
import {
  calculateInvoiceDueDate,
  invoiceGrossAmount,
  invoiceLineAmount,
} from './invoice-calculations.js';

const fault = (code: string, message: string, status = 409) =>
  new BusinessException(code, message, status);
const issueHash = (fulfilmentId: string) =>
  createHash('sha256')
    .update(`m6-invoice-issue:v1\0${fulfilmentId}`)
    .digest('hex');
const includeInvoice = {
  lines: { orderBy: { id: 'asc' as const } },
} satisfies Prisma.InvoiceInclude;
type InvoiceRecord = Prisma.InvoiceGetPayload<{
  include: typeof includeInvoice;
}>;

function dateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function projectInvoice(record: InvoiceRecord): Invoice {
  const billing =
    record.customerBillingSnapshot as Invoice['customerBillingSnapshot'];
  const terms = record.paymentTermsSnapshot as Invoice['paymentTermsSnapshot'];
  return {
    id: record.id,
    customerId: record.customerId,
    orderId: record.orderId,
    fulfilmentId: record.fulfilmentId,
    invoiceNumber: record.invoiceNumber,
    currency: 'JMD',
    issuedAt: record.issuedAt.toISOString(),
    dueAt: dateOnly(record.dueAt),
    customerBillingSnapshot: billing,
    paymentTermsSnapshot: terms,
    grossAmount: record.grossAmount.toFixed(2),
    taxTreatmentStatus: record.taxTreatmentStatus,
    taxPolicyReference: record.taxPolicyReference,
    taxPolicyVersion: record.taxPolicyVersion,
    status: record.status,
    lines: record.lines.map((line) => ({
      id: line.id,
      sourceOrderLineId: line.orderLineId,
      sourceFulfilmentLineId: line.fulfilmentLineId,
      description: line.description,
      quantity: line.quantity.toString(),
      unit: line.unit,
      unitPrice: line.unitPrice.toFixed(4),
      lineAmount: line.lineAmount.toFixed(2),
    })),
    createdAt: record.createdAt.toISOString(),
  };
}

@Injectable()
export class InvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorization: AuthorizationService,
    private readonly activation: InvoiceActivationService,
    private readonly farmAccess: FarmAccessService,
  ) {}

  async issue(
    context: OrganizationContext,
    rawFulfilmentId: string,
    rawKey: string,
  ) {
    const fulfilmentId = rawFulfilmentId.toLowerCase();
    const key = new ZodValidationPipe(idempotencyKeySchema)
      .transform(rawKey)
      .toLowerCase();
    return this.prisma.$transaction(
      async (tx) => {
        await this.authorize(tx, context, Permission.INVOICE_ISSUE);
        const prior = await tx.invoiceIssueCommand.findUnique({
          where: {
            organizationId_key: { organizationId: context.organizationId, key },
          },
          include: { invoice: { include: includeInvoice } },
        });
        if (prior) {
          if (
            prior.actorMembershipId !== context.membershipId ||
            prior.fulfilmentId !== fulfilmentId ||
            prior.requestHash !== issueHash(fulfilmentId)
          ) {
            throw fault(
              'IDEMPOTENCY_CONFLICT',
              'Idempotency key is already bound to another invoice command',
            );
          }
          return {
            status: 200 as const,
            invoice: projectInvoice(prior.invoice),
          };
        }

        // Discovery is intentionally read-only. The order is then locked using M5's
        // serialization point and the source is re-read before any financial writes.
        const discovered = await tx.fulfilment.findFirst({
          where: {
            organizationId: context.organizationId,
            id: fulfilmentId,
            kind: 'POSTING',
            commands: {
              some: {
                organizationId: context.organizationId,
                operation: 'POST',
              },
            },
          },
          select: { orderId: true, farmId: true },
        });
        if (!discovered)
          throw fault(
            'FULFILMENT_NOT_FOUND',
            'Committed posting fulfilment was not found',
            404,
          );
        await this.farmAccess.resolve(context, discovered.farmId);
        await lockMutation(tx, context, {
          financialCommand: { operation: 'ISSUE_INVOICE', key },
          orderId: discovered.orderId,
        });
        await this.farmAccess.resolve(context, discovered.farmId, tx);
        await this.authorize(tx, context, Permission.INVOICE_ISSUE);
        const raced = await tx.invoiceIssueCommand.findUnique({
          where: {
            organizationId_key: { organizationId: context.organizationId, key },
          },
          include: { invoice: { include: includeInvoice } },
        });
        if (raced) {
          if (
            raced.actorMembershipId !== context.membershipId ||
            raced.fulfilmentId !== fulfilmentId ||
            raced.requestHash !== issueHash(fulfilmentId)
          ) {
            throw fault(
              'IDEMPOTENCY_CONFLICT',
              'Idempotency key is already bound to another invoice command',
            );
          }
          return {
            status: 200 as const,
            invoice: projectInvoice(raced.invoice),
          };
        }
        const source = await tx.fulfilment.findFirst({
          where: {
            organizationId: context.organizationId,
            id: fulfilmentId,
            orderId: discovered.orderId,
            kind: 'POSTING',
            commands: {
              some: {
                organizationId: context.organizationId,
                operation: 'POST',
              },
            },
          },
          include: {
            lines: { include: { orderLine: true }, orderBy: { id: 'asc' } },
            order: true,
          },
        });
        if (!source || source.lines.length === 0)
          throw fault(
            'FULFILMENT_NOT_FOUND',
            'Committed posting fulfilment was not found',
            404,
          );
        if (
          await tx.invoice.findFirst({
            where: { organizationId: context.organizationId, fulfilmentId },
            select: { id: true },
          })
        ) {
          throw fault(
            'FULFILMENT_ALREADY_INVOICED',
            'This fulfilment has already been invoiced',
          );
        }
        if (
          await tx.fulfilment.findFirst({
            where: {
              organizationId: context.organizationId,
              reversesFulfilmentId: fulfilmentId,
            },
            select: { id: true },
          })
        ) {
          throw fault(
            'FULFILMENT_REVERSED',
            'A reversed fulfilment cannot be invoiced',
          );
        }

        // Tax configuration is checked after authorization/source validation but
        // before number allocation or writes. Rejection cannot partially persist.
        const policy = this.activation.assertEnabled();
        const issuedAt = new Date();
        let dueAt: Date;
        try {
          dueAt = calculateInvoiceDueDate(
            issuedAt,
            source.order.saleType,
            source.order.creditTermDays,
          );
        } catch {
          throw fault(
            'PAYMENT_TERMS_REQUIRED',
            'Valid payment terms are required on the source order',
          );
        }
        const calculated = source.lines.map((line) => ({
          line,
          amount: invoiceLineAmount(
            line.quantity.toString(),
            line.orderLine.unitPrice.toString(),
          ),
        }));
        const grossAmount = invoiceGrossAmount(
          calculated.map(({ amount }) => amount),
        );
        const sequence = await tx.invoiceSequence.upsert({
          where: { organizationId: context.organizationId },
          create: { organizationId: context.organizationId, nextNumber: 2 },
          update: { nextNumber: { increment: 1 } },
        });
        const allocatedNumber = sequence.nextNumber - 1;
        if (!Number.isSafeInteger(allocatedNumber) || allocatedNumber < 1)
          throw fault(
            'INVOICE_SEQUENCE_EXHAUSTED',
            'Invoice number sequence is exhausted',
            503,
          );
        const invoiceNumber = `INV-${String(allocatedNumber).padStart(8, '0')}`;
        const invoiceId = randomUUID();
        await tx.invoice.create({
          data: {
            id: invoiceId,
            organizationId: context.organizationId,
            farmId: source.farmId,
            customerId: source.order.customerId,
            orderId: source.orderId,
            fulfilmentId,
            invoiceNumber,
            currency: source.order.currency,
            issuedAt,
            dueAt,
            customerBillingSnapshot: {
              code: source.order.customerCode,
              name: source.order.customerName,
              contactPerson: source.order.customerContactPerson,
              phone: source.order.customerPhone,
              email: source.order.customerEmail,
              address: source.order.customerAddress,
            },
            paymentTermsSnapshot: {
              saleType: source.order.saleType,
              creditTermDays: source.order.creditTermDays,
            },
            grossAmount,
            taxTreatmentStatus: 'APPROVED_POLICY_NOT_CALCULATED',
            taxPolicyReference: policy.reference,
            taxPolicyVersion: policy.version,
            issuedByMembershipId: context.membershipId,
            status: 'ISSUED',
          },
        });
        await tx.invoiceLine.createMany({
          data: calculated.map(({ line, amount }) => ({
            organizationId: context.organizationId,
            farmId: source.farmId,
            orderId: source.orderId,
            invoiceId,
            orderLineId: line.orderLineId,
            fulfilmentLineId: line.id,
            description: line.orderLine.productName,
            quantity: line.quantity,
            unit: line.unit,
            unitPrice: line.orderLine.unitPrice,
            lineAmount: amount,
          })),
        });
        await tx.invoiceFulfilmentAllocation.createMany({
          data: source.lines.map((line) => ({
            organizationId: context.organizationId,
            farmId: source.farmId,
            orderId: source.orderId,
            orderLineId: line.orderLineId,
            fulfilmentLineId: line.id,
            invoiceId,
          })),
        });
        await tx.invoiceLifecycleEvent.create({
          data: {
            organizationId: context.organizationId,
            invoiceId,
            actorMembershipId: context.membershipId,
            type: 'ISSUED',
            details: {
              source: 'FULFILMENT',
              taxPolicyReference: policy.reference,
              taxPolicyVersion: policy.version,
            },
          },
        });
        await tx.invoiceIssueCommand.create({
          data: {
            organizationId: context.organizationId,
            key,
            fulfilmentId,
            actorMembershipId: context.membershipId,
            requestHash: issueHash(fulfilmentId),
            invoiceId,
          },
        });
        const created = await tx.invoice.findFirstOrThrow({
          where: { organizationId: context.organizationId, id: invoiceId },
          include: includeInvoice,
        });
        return { status: 201 as const, invoice: projectInvoice(created) };
      },
      { isolationLevel: 'ReadCommitted' },
    );
  }

  async list(
    context: OrganizationContext,
    query: InvoiceQuery,
  ): Promise<InvoiceListResponse> {
    await this.authorize(this.prisma, context, Permission.INVOICE_READ);
    const where: Prisma.InvoiceWhereInput = {
      organizationId: context.organizationId,
      customerId: query.customerId,
      ...(query.issueFrom || query.issueTo
        ? {
            issuedAt: {
              ...(query.issueFrom
                ? { gte: this.jamaicaStart(query.issueFrom) }
                : {}),
              ...(query.issueTo
                ? { lt: this.jamaicaStart(this.nextDate(query.issueTo)) }
                : {}),
            },
          }
        : {}),
      ...(query.dueFrom || query.dueTo
        ? {
            dueAt: {
              ...(query.dueFrom
                ? { gte: new Date(`${query.dueFrom}T00:00:00.000Z`) }
                : {}),
              ...(query.dueTo
                ? { lte: new Date(`${query.dueTo}T00:00:00.000Z`) }
                : {}),
            },
          }
        : {}),
      ...(query.search
        ? {
            OR: [
              {
                invoiceNumber: { contains: query.search, mode: 'insensitive' },
              },
              {
                customerBillingSnapshot: {
                  path: ['name'],
                  string_contains: query.search,
                  mode: 'insensitive',
                },
              },
              {
                customerBillingSnapshot: {
                  path: ['code'],
                  string_contains: query.search,
                  mode: 'insensitive',
                },
              },
            ],
          }
        : {}),
    };
    const sortField = {
      issuedAt: 'issuedAt',
      dueAt: 'dueAt',
      invoiceNumber: 'invoiceNumber',
      grossAmount: 'grossAmount',
    }[query.sortBy ?? 'issuedAt'];
    const direction = query.sortDirection ?? 'desc';
    const [records, totalItems] = await this.prisma.$transaction(
      [
        this.prisma.invoice.findMany({
          where,
          orderBy: [{ [sortField]: direction }, { id: direction }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
          include: includeInvoice,
        }),
        this.prisma.invoice.count({ where }),
      ],
      { isolationLevel: 'RepeatableRead' },
    );
    return {
      data: records.map(projectInvoice),
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        totalItems,
        totalPages: Math.ceil(totalItems / query.pageSize),
      },
    };
  }

  async eligibleFulfilments(context: OrganizationContext, farm: FarmContext) {
    await this.authorize(this.prisma, context, Permission.INVOICE_ISSUE);
    await this.authorize(this.prisma, context, Permission.ORDER_READ);
    await this.authorize(this.prisma, context, Permission.FULFILMENT_READ);
    const rows = await this.prisma.fulfilment.findMany({
      where: {
        organizationId: context.organizationId,
        farmId: farm.farmId,
        kind: 'POSTING',
        commands: {
          some: { organizationId: context.organizationId, operation: 'POST' },
        },
        invoice: null,
        reversals: { none: {} },
      },
      include: { order: true, lines: { include: { orderLine: true } } },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      take: 100,
    });
    return {
      data: rows
        .filter(
          (row) =>
            row.order.saleType === 'CASH' || row.order.creditTermDays !== null,
        )
        .map((row) => ({
          id: row.id,
          code: row.code,
          orderId: row.orderId,
          customerName: row.order.customerName,
          occurredAt: row.occurredAt.toISOString(),
          grossAmount: invoiceGrossAmount(
            row.lines.map((line) =>
              invoiceLineAmount(
                line.quantity.toString(),
                line.orderLine.unitPrice.toString(),
              ),
            ),
          ).toFixed(2),
        })),
    };
  }

  issuanceStatus() {
    try {
      this.activation.assertEnabled();
      return { enabled: true, message: null };
    } catch {
      return {
        enabled: false,
        message:
          'Invoice issuance is not enabled for this deployment. No invoice will be issued until the finance feature and approved tax policy are activated.',
      };
    }
  }

  private nextDate(date: string): string {
    const [year, month, day] = date.split('-').map(Number);
    return new Date(Date.UTC(year!, month! - 1, day! + 1))
      .toISOString()
      .slice(0, 10);
  }

  private jamaicaStart(date: string): Date {
    const [year, month, day] = date.split('-').map(Number);
    const target = Date.UTC(year!, month! - 1, day!);
    let guess = target;
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Jamaica',
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

  async get(context: OrganizationContext, id: string): Promise<Invoice> {
    await this.authorize(this.prisma, context, Permission.INVOICE_READ);
    const record = await this.prisma.invoice.findFirst({
      where: { organizationId: context.organizationId, id },
      include: includeInvoice,
    });
    if (!record) throw fault('INVOICE_NOT_FOUND', 'Invoice was not found', 404);
    return projectInvoice(record);
  }

  async customers(context: OrganizationContext) {
    await this.authorize(this.prisma, context, Permission.INVOICE_READ);
    const rows = await this.prisma.$queryRaw<
      { customerId: string; customerName: string }[]
    >`
      SELECT DISTINCT ON (i."customerId") i."customerId", i."customerBillingSnapshot"->>'name' AS "customerName"
      FROM "invoices" i
      WHERE i."organizationId" = ${context.organizationId}::uuid AND i."status" = 'ISSUED'
      ORDER BY i."customerId", i."issuedAt" DESC, i.id DESC LIMIT 500
    `;
    return { data: rows };
  }

  async history(context: OrganizationContext, id: string) {
    await this.authorize(this.prisma, context, Permission.INVOICE_READ);
    if (
      !(await this.prisma.invoice.findFirst({
        where: { organizationId: context.organizationId, id },
        select: { id: true },
      }))
    )
      throw fault('INVOICE_NOT_FOUND', 'Invoice was not found', 404);
    const events = await this.prisma.invoiceLifecycleEvent.findMany({
      where: { organizationId: context.organizationId, invoiceId: id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        type: true,
        actorMembershipId: true,
        details: true,
        createdAt: true,
      },
    });
    return {
      data: events.map((event) => ({
        ...event,
        createdAt: event.createdAt.toISOString(),
      })),
    };
  }

  async allocations(context: OrganizationContext, id: string) {
    await this.authorize(this.prisma, context, Permission.INVOICE_READ);
    if (
      !(await this.prisma.invoice.findFirst({
        where: { organizationId: context.organizationId, id },
        select: { id: true },
      }))
    )
      throw fault('INVOICE_NOT_FOUND', 'Invoice was not found', 404);
    const entries = await this.prisma.invoiceFulfilmentAllocation.findMany({
      where: { organizationId: context.organizationId, invoiceId: id },
      orderBy: [{ fulfilmentLineId: 'asc' }],
      include: {
        fulfilmentLine: {
          select: {
            id: true,
            orderLineId: true,
            quantity: true,
            unit: true,
            fulfilmentId: true,
          },
        },
      },
    });
    return {
      data: entries.map(({ fulfilmentLine }) => ({
        fulfilmentLineId: fulfilmentLine.id,
        fulfilmentId: fulfilmentLine.fulfilmentId,
        orderLineId: fulfilmentLine.orderLineId,
        quantity: fulfilmentLine.quantity.toString(),
        unit: fulfilmentLine.unit,
      })),
    };
  }

  private async authorize(
    client: PrismaService | Prisma.TransactionClient,
    context: OrganizationContext,
    permission: Permission,
  ) {
    const membership = await client.organizationMembership.findFirst({
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
        'You do not have permission to access invoices',
        403,
      );
    }
  }
}
