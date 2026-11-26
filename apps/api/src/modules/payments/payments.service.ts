import { createHash, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type {
  InvoicePaymentBalance,
  Payment as PaymentDto,
  PaymentListResponse,
  PaymentStatus,
} from '@ancastle/types';
import {
  idempotencyKeySchema,
  type AllocatePaymentInput,
  type PaymentQuery,
  type RecordPaymentInput,
  type ReversePaymentInput,
} from '@ancastle/validation';
import { PrismaService } from '../../database/prisma.service.js';
import { lockMutation } from '../../database/mutation-locks.js';
import {
  Prisma,
  type PaymentCommandType,
} from '../../generated/prisma/client.js';
import { BusinessException } from '../../common/exceptions/business.exception.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import type { OrganizationContext } from '../authorization/organization-context.js';
import { AuthorizationService } from '../authorization/authorization.service.js';
import { Permission } from '../authorization/permissions.js';

const fault = (code: string, message: string, status = 409) =>
  new BusinessException(code, message, status);
const includePayment = {
  events: { orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }] },
  allocations: {
    orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }],
    include: { reversals: { orderBy: [{ createdAt: 'asc' as const }] } },
  },
} satisfies Prisma.PaymentInclude;
type PaymentRecord = Prisma.PaymentGetPayload<{
  include: typeof includePayment;
}>;
type Client = PrismaService | Prisma.TransactionClient;

function hashRequest(command: PaymentCommandType, input: unknown): string {
  return createHash('sha256')
    .update(`m6-payment:${command.toLowerCase()}:v1\0${JSON.stringify(input)}`)
    .digest('hex');
}

function canonicalEvidence(value: string): string {
  return value.trim().replace(/\s+/gu, '').toLocaleLowerCase('en-US');
}

function canonicalEvidenceKey(input: {
  method: 'CASH' | 'BANK_TRANSFER';
  evidence: string;
  receivingAccount: string | null;
}): string {
  const evidence = canonicalEvidence(input.evidence);
  if (input.method === 'CASH') return `CASH:${evidence}`;
  const account = canonicalEvidence(input.receivingAccount ?? '');
  return `BANK:${Array.from(account).length}:${account}:${evidence}`;
}

function moneyToCents(value: Prisma.Decimal | string): bigint {
  const [whole, fraction = '00'] =
    typeof value === 'string' ? value.split('.') : value.toFixed(2).split('.');
  return BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, '0'));
}

function centsToMoney(value: bigint): string {
  const sign = value < 0n ? '-' : '';
  const absolute = value < 0n ? -value : value;
  return `${sign}${absolute / 100n}.${(absolute % 100n).toString().padStart(2, '0')}`;
}

function projectPayment(record: PaymentRecord): PaymentDto {
  const verified = record.events.find((event) => event.type === 'VERIFIED');
  const reversed = record.events.find((event) => event.type === 'REVERSED');
  const allocations = record.allocations.map((allocation) => {
    const reversal = allocation.reversals[0];
    return {
      id: allocation.id,
      invoiceId: allocation.invoiceId,
      amount: allocation.amount.toFixed(2),
      activeAmount: reversal ? '0.00' : allocation.amount.toFixed(2),
      allocatedByMembershipId: allocation.allocatedByMembershipId,
      createdAt: allocation.createdAt.toISOString(),
      reversedAt: reversal?.createdAt.toISOString() ?? null,
    };
  });
  const allocated = allocations.reduce(
    (sum, allocation) => sum + moneyToCents(allocation.activeAmount),
    0n,
  );
  const common = {
    id: record.id,
    customerId: record.customerId,
    amount: record.amount.toFixed(2),
    currency: 'JMD' as const,
    status: (reversed
      ? 'REVERSED'
      : verified
        ? 'VERIFIED'
        : 'PENDING_VERIFICATION') as PaymentStatus,
    recordedByMembershipId: record.recordedByMembershipId,
    recordedAt: record.recordedAt.toISOString(),
    verifiedByMembershipId: verified?.actorMembershipId ?? null,
    verifiedAt: verified?.createdAt.toISOString() ?? null,
    selfVerification: verified?.selfVerification ?? false,
    allocatedAmount: centsToMoney(allocated),
    unallocatedAmount: reversed
      ? '0.00'
      : centsToMoney(moneyToCents(record.amount) - allocated),
    events: record.events.map((event) => ({
      id: event.id,
      type: event.type,
      actorMembershipId: event.actorMembershipId,
      reason: event.reason,
      selfVerification: event.selfVerification,
      createdAt: event.createdAt.toISOString(),
    })),
    allocations,
  };
  return record.method === 'CASH'
    ? {
        ...common,
        method: 'CASH' as const,
        cashReceiptNumber: record.cashReceiptNumber!,
        receivingAccount: null,
        bankTransferReference: null,
      }
    : {
        ...common,
        method: 'BANK_TRANSFER' as const,
        cashReceiptNumber: null,
        receivingAccount: record.receivingAccount!,
        bankTransferReference: record.bankTransferReference!,
      };
}

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorization: AuthorizationService,
  ) {}

  async record(
    context: OrganizationContext,
    input: RecordPaymentInput,
    rawKey: string,
  ) {
    const key = this.key(rawKey);
    const evidence =
      input.method === 'CASH'
        ? input.cashReceiptNumber.trim()
        : input.bankTransferReference.trim();
    const normalized = {
      customerId: input.customerId.toLowerCase(),
      amount: input.amount,
      method: input.method,
      evidence,
      receivingAccount:
        input.method === 'BANK_TRANSFER' ? input.receivingAccount.trim() : null,
    };
    const requestHash = hashRequest('RECORD', normalized);
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          await this.authorize(tx, context, Permission.PAYMENT_RECORD);
          await this.lockLedger(tx, context);
          await this.lockActor(tx, context);
          await this.authorize(tx, context, Permission.PAYMENT_RECORD);
          const prior = await this.prior(
            tx,
            context,
            key,
            requestHash,
            'RECORD',
          );
          if (prior)
            return {
              status: 200 as const,
              payment: await this.loadDto(tx, context, prior.paymentId),
            };
          const customer = await tx.customer.findFirst({
            where: {
              organizationId: context.organizationId,
              id: normalized.customerId,
            },
            select: { id: true },
          });
          if (!customer)
            throw fault('CUSTOMER_NOT_FOUND', 'Customer was not found', 404);
          const paymentId = randomUUID();
          await tx.payment.create({
            data: {
              id: paymentId,
              organizationId: context.organizationId,
              customerId: customer.id,
              amount: new Prisma.Decimal(normalized.amount),
              currency: 'JMD',
              method: normalized.method,
              cashReceiptNumber: normalized.method === 'CASH' ? evidence : null,
              receivingAccount: normalized.receivingAccount,
              bankTransferReference:
                normalized.method === 'BANK_TRANSFER' ? evidence : null,
              evidenceKey: canonicalEvidenceKey(normalized),
              recordedByMembershipId: context.membershipId,
            },
          });
          await tx.paymentLifecycleEvent.create({
            data: {
              organizationId: context.organizationId,
              paymentId,
              type: 'RECORDED',
              actorMembershipId: context.membershipId,
            },
          });
          await this.saveCommand(
            tx,
            context,
            key,
            requestHash,
            'RECORD',
            paymentId,
          );
          return {
            status: 201 as const,
            payment: await this.loadDto(tx, context, paymentId),
          };
        },
        { isolationLevel: 'ReadCommitted' },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw fault(
          'PAYMENT_EVIDENCE_DUPLICATE',
          'Payment evidence has already been recorded',
        );
      }
      throw error;
    }
  }

  async verify(
    context: OrganizationContext,
    paymentId: string,
    rawKey: string,
  ) {
    const key = this.key(rawKey);
    paymentId = paymentId.toLowerCase();
    const requestHash = hashRequest('VERIFY', { paymentId });
    return this.prisma.$transaction(
      async (tx) => {
        await this.authorize(tx, context, Permission.PAYMENT_VERIFY);
        await this.lockLedger(tx, context, [paymentId]);
        await this.lockActor(tx, context);
        const actor = await this.authorize(
          tx,
          context,
          Permission.PAYMENT_VERIFY,
        );
        const prior = await this.prior(tx, context, key, requestHash, 'VERIFY');
        if (prior)
          return {
            status: 200 as const,
            payment: await this.loadDto(tx, context, prior.paymentId),
          };
        const payment = await tx.payment.findFirst({
          where: { organizationId: context.organizationId, id: paymentId },
          include: { events: true },
        });
        if (!payment)
          throw fault('PAYMENT_NOT_FOUND', 'Payment was not found', 404);
        if (payment.events.some((event) => event.type === 'REVERSED'))
          throw fault(
            'PAYMENT_REVERSED',
            'A reversed payment cannot be verified',
          );
        if (payment.events.some((event) => event.type === 'VERIFIED'))
          throw fault(
            'PAYMENT_ALREADY_VERIFIED',
            'Payment has already been verified',
          );
        const selfVerification =
          payment.recordedByMembershipId === context.membershipId;
        if (selfVerification && actor.role === 'MANAGER')
          throw fault(
            'PAYMENT_SELF_VERIFICATION_DENIED',
            'Managers cannot verify payments they recorded',
            403,
          );
        await tx.paymentLifecycleEvent.create({
          data: {
            organizationId: context.organizationId,
            paymentId,
            type: 'VERIFIED',
            actorMembershipId: context.membershipId,
            selfVerification,
          },
        });
        await this.saveCommand(
          tx,
          context,
          key,
          requestHash,
          'VERIFY',
          paymentId,
        );
        return {
          status: 200 as const,
          payment: await this.loadDto(tx, context, paymentId),
        };
      },
      { isolationLevel: 'ReadCommitted' },
    );
  }

  async allocate(
    context: OrganizationContext,
    paymentId: string,
    input: AllocatePaymentInput,
    rawKey: string,
  ) {
    const key = this.key(rawKey);
    paymentId = paymentId.toLowerCase();
    const allocations = [...input.allocations]
      .map((allocation) => ({
        invoiceId: allocation.invoiceId.toLowerCase(),
        amount: allocation.amount,
      }))
      .sort((a, b) => a.invoiceId.localeCompare(b.invoiceId));
    const requestHash = hashRequest('ALLOCATE', { paymentId, allocations });
    return this.prisma.$transaction(
      async (tx) => {
        await this.authorize(tx, context, Permission.PAYMENT_ALLOCATE);
        await this.lockLedger(
          tx,
          context,
          [paymentId],
          input.allocations.map((allocation) =>
            allocation.invoiceId.toLowerCase(),
          ),
        );
        await this.lockActor(tx, context);
        await this.authorize(tx, context, Permission.PAYMENT_ALLOCATE);
        const prior = await this.prior(
          tx,
          context,
          key,
          requestHash,
          'ALLOCATE',
        );
        if (prior)
          return {
            status: 200 as const,
            payment: await this.loadDto(tx, context, prior.paymentId),
          };
        const payment = await tx.payment.findFirst({
          where: { organizationId: context.organizationId, id: paymentId },
          include: { events: true },
        });
        if (!payment)
          throw fault('PAYMENT_NOT_FOUND', 'Payment was not found', 404);
        if (!payment.events.some((event) => event.type === 'VERIFIED'))
          throw fault(
            'PAYMENT_NOT_VERIFIED',
            'Only verified payments can be allocated',
          );
        if (payment.events.some((event) => event.type === 'REVERSED'))
          throw fault(
            'PAYMENT_REVERSED',
            'A reversed payment cannot be allocated',
          );
        const invoiceIds = allocations.map(
          (allocation) => allocation.invoiceId,
        );
        const invoices = await tx.invoice.findMany({
          where: {
            organizationId: context.organizationId,
            id: { in: invoiceIds },
          },
          select: {
            id: true,
            customerId: true,
            currency: true,
            grossAmount: true,
            status: true,
          },
        });
        if (invoices.length !== invoiceIds.length)
          throw fault(
            'INVOICE_NOT_FOUND',
            'One or more invoices were not found',
            404,
          );
        const invoiceById = new Map(
          invoices.map((invoice) => [invoice.id, invoice]),
        );
        const currentAllocations = await tx.paymentAllocation.findMany({
          where: {
            organizationId: context.organizationId,
            invoiceId: { in: invoiceIds },
          },
          include: { reversals: true },
        });
        const activeByInvoice = new Map<string, bigint>();
        for (const allocation of currentAllocations) {
          const active = allocation.reversals.length
            ? 0n
            : moneyToCents(allocation.amount);
          activeByInvoice.set(
            allocation.invoiceId,
            (activeByInvoice.get(allocation.invoiceId) ?? 0n) + active,
          );
        }
        const paymentAllocations = await tx.paymentAllocation.findMany({
          where: { organizationId: context.organizationId, paymentId },
          include: { reversals: true },
        });
        let available =
          moneyToCents(payment.amount) -
          paymentAllocations.reduce(
            (sum, allocation) =>
              sum +
              (allocation.reversals.length
                ? 0n
                : moneyToCents(allocation.amount)),
            0n,
          );
        for (const item of allocations) {
          const invoice = invoiceById.get(item.invoiceId)!;
          if (
            invoice.status !== 'ISSUED' ||
            invoice.customerId !== payment.customerId ||
            invoice.currency !== payment.currency
          )
            throw fault(
              'PAYMENT_ALLOCATION_SCOPE_MISMATCH',
              'Payment and invoice must have matching customer, currency, and issued status',
            );
          const amount = moneyToCents(item.amount);
          if (amount > available)
            throw fault(
              'PAYMENT_FUNDS_EXCEEDED',
              'Allocation exceeds available verified payment funds',
            );
          const outstanding =
            moneyToCents(invoice.grossAmount) -
            (activeByInvoice.get(invoice.id) ?? 0n);
          if (amount > outstanding)
            throw fault(
              'INVOICE_AMOUNT_EXCEEDED',
              'Allocation exceeds the invoice outstanding amount',
            );
          available -= amount;
          activeByInvoice.set(
            invoice.id,
            (activeByInvoice.get(invoice.id) ?? 0n) + amount,
          );
        }
        await tx.paymentAllocation.createMany({
          data: allocations.map((item) => ({
            organizationId: context.organizationId,
            paymentId,
            invoiceId: item.invoiceId,
            customerId: payment.customerId,
            currency: payment.currency,
            amount: new Prisma.Decimal(item.amount),
            allocatedByMembershipId: context.membershipId,
          })),
        });
        await this.saveCommand(
          tx,
          context,
          key,
          requestHash,
          'ALLOCATE',
          paymentId,
        );
        return {
          status: 201 as const,
          payment: await this.loadDto(tx, context, paymentId),
        };
      },
      { isolationLevel: 'ReadCommitted' },
    );
  }

  async reverse(
    context: OrganizationContext,
    paymentId: string,
    input: ReversePaymentInput,
    rawKey: string,
  ) {
    const key = this.key(rawKey);
    paymentId = paymentId.toLowerCase();
    const normalized = { paymentId, reason: input.reason.trim() };
    const requestHash = hashRequest('REVERSE', normalized);
    return this.prisma.$transaction(
      async (tx) => {
        await this.authorize(tx, context, Permission.PAYMENT_REVERSE);
        await this.lockLedger(tx, context, [paymentId]);
        await this.lockActor(tx, context);
        await this.authorize(tx, context, Permission.PAYMENT_REVERSE);
        const prior = await this.prior(
          tx,
          context,
          key,
          requestHash,
          'REVERSE',
        );
        if (prior)
          return {
            status: 200 as const,
            payment: await this.loadDto(tx, context, prior.paymentId),
          };
        const payment = await tx.payment.findFirst({
          where: { organizationId: context.organizationId, id: paymentId },
          include: { events: true },
        });
        if (!payment)
          throw fault('PAYMENT_NOT_FOUND', 'Payment was not found', 404);
        if (payment.events.some((event) => event.type === 'REVERSED'))
          throw fault(
            'PAYMENT_ALREADY_REVERSED',
            'Payment has already been reversed',
          );
        const activeAllocations = await tx.paymentAllocation.findMany({
          where: {
            organizationId: context.organizationId,
            paymentId,
            reversals: { none: {} },
          },
        });
        if (activeAllocations.length) {
          await tx.paymentAllocationReversal.createMany({
            data: activeAllocations.map((allocation) => ({
              organizationId: context.organizationId,
              paymentId,
              allocationId: allocation.id,
              amount: allocation.amount,
              reason: normalized.reason,
              actorMembershipId: context.membershipId,
            })),
          });
        }
        await tx.paymentLifecycleEvent.create({
          data: {
            organizationId: context.organizationId,
            paymentId,
            type: 'REVERSED',
            actorMembershipId: context.membershipId,
            reason: normalized.reason,
          },
        });
        await this.saveCommand(
          tx,
          context,
          key,
          requestHash,
          'REVERSE',
          paymentId,
        );
        return {
          status: 200 as const,
          payment: await this.loadDto(tx, context, paymentId),
        };
      },
      { isolationLevel: 'ReadCommitted' },
    );
  }

  async list(
    context: OrganizationContext,
    query: PaymentQuery,
  ): Promise<PaymentListResponse> {
    await this.authorize(this.prisma, context, Permission.PAYMENT_READ);
    const where = {
      organizationId: context.organizationId,
      customerId: query.customerId,
    };
    const [records, totalItems] = await this.prisma.$transaction(
      [
        this.prisma.payment.findMany({
          where,
          orderBy: [{ recordedAt: 'desc' }, { id: 'desc' }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
          include: includePayment,
        }),
        this.prisma.payment.count({ where }),
      ],
      { isolationLevel: 'RepeatableRead' },
    );
    return {
      data: records.map(projectPayment),
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        totalItems,
        totalPages: Math.ceil(totalItems / query.pageSize),
      },
    };
  }

  async get(
    context: OrganizationContext,
    paymentId: string,
  ): Promise<PaymentDto> {
    await this.authorize(this.prisma, context, Permission.PAYMENT_READ);
    return this.loadDto(this.prisma, context, paymentId.toLowerCase());
  }

  async invoiceBalance(
    context: OrganizationContext,
    invoiceId: string,
  ): Promise<InvoicePaymentBalance> {
    await this.authorize(this.prisma, context, Permission.PAYMENT_READ);
    const invoice = await this.prisma.invoice.findFirst({
      where: {
        organizationId: context.organizationId,
        id: invoiceId.toLowerCase(),
      },
      select: { id: true, currency: true, grossAmount: true },
    });
    if (!invoice)
      throw fault('INVOICE_NOT_FOUND', 'Invoice was not found', 404);
    const rows = await this.prisma.paymentAllocation.findMany({
      where: { organizationId: context.organizationId, invoiceId: invoice.id },
      include: { reversals: true },
    });
    const allocated = rows.reduce(
      (sum, allocation) =>
        sum +
        (allocation.reversals.length ? 0n : moneyToCents(allocation.amount)),
      0n,
    );
    return {
      invoiceId: invoice.id,
      currency: 'JMD',
      grossAmount: invoice.grossAmount.toFixed(2),
      allocatedAmount: centsToMoney(allocated),
      outstandingAmount: centsToMoney(
        moneyToCents(invoice.grossAmount) - allocated,
      ),
    };
  }

  async invoiceAllocations(context: OrganizationContext, invoiceId: string) {
    await this.authorize(this.prisma, context, Permission.PAYMENT_READ);
    const invoice = await this.prisma.invoice.findFirst({
      where: {
        organizationId: context.organizationId,
        id: invoiceId.toLowerCase(),
      },
      select: { id: true },
    });
    if (!invoice)
      throw fault('INVOICE_NOT_FOUND', 'Invoice was not found', 404);
    const rows = await this.prisma.paymentAllocation.findMany({
      where: { organizationId: context.organizationId, invoiceId: invoice.id },
      include: {
        payment: { select: { id: true, method: true, recordedAt: true } },
        reversals: { select: { createdAt: true, amount: true } },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return {
      data: rows.map((row) => {
        const reversed = row.reversals.reduce(
          (sum, entry) => sum + moneyToCents(entry.amount),
          0n,
        );
        const active = moneyToCents(row.amount) - reversed;
        const reversedAt = row.reversals.length
          ? row.reversals.reduce(
              (latest, item) =>
                item.createdAt > latest ? item.createdAt : latest,
              row.reversals[0]!.createdAt,
            )
          : null;
        return {
          allocationId: row.id,
          paymentId: row.payment.id,
          amount: row.amount.toFixed(2),
          activeAmount: centsToMoney(active),
          paymentMethod: row.payment.method,
          paymentRecordedAt: row.payment.recordedAt.toISOString(),
          allocatedAt: row.createdAt.toISOString(),
          reversedAt: reversedAt?.toISOString() ?? null,
        };
      }),
    };
  }

  private key(rawKey: string): string {
    return new ZodValidationPipe(idempotencyKeySchema)
      .transform(rawKey)
      .toLowerCase();
  }

  private async lockLedger(
    tx: Prisma.TransactionClient,
    context: OrganizationContext,
    paymentIds: readonly string[] = [],
    invoiceIds: readonly string[] = [],
  ) {
    await lockMutation(tx, context, {
      parent: 'UPDATE',
      financialCommand: { operation: 'PAYMENT_LEDGER', key: 'ledger' },
      paymentIds,
      invoiceIds,
    });
  }

  private async lockActor(
    tx: Prisma.TransactionClient,
    context: OrganizationContext,
  ) {
    await tx.$queryRaw`
      SELECT "id" FROM "organization_memberships"
      WHERE "organizationId" = ${context.organizationId}::uuid
        AND "id" = ${context.membershipId}::uuid
      FOR SHARE
    `;
    await tx.$queryRaw`
      SELECT "id" FROM "users"
      WHERE "id" = ${context.userId}::uuid
      FOR SHARE
    `;
  }

  private async prior(
    tx: Prisma.TransactionClient,
    context: OrganizationContext,
    key: string,
    requestHash: string,
    type: PaymentCommandType,
  ) {
    const prior = await tx.paymentCommandReceipt.findUnique({
      where: {
        organizationId_key: { organizationId: context.organizationId, key },
      },
    });
    if (!prior) return null;
    if (
      prior.actorMembershipId !== context.membershipId ||
      prior.type !== type ||
      prior.requestHash !== requestHash
    )
      throw fault(
        'IDEMPOTENCY_CONFLICT',
        'Idempotency key is already bound to another payment command',
      );
    return prior;
  }

  private async saveCommand(
    tx: Prisma.TransactionClient,
    context: OrganizationContext,
    key: string,
    requestHash: string,
    type: PaymentCommandType,
    paymentId: string,
  ) {
    await tx.paymentCommandReceipt.create({
      data: {
        organizationId: context.organizationId,
        key,
        requestHash,
        type,
        paymentId,
        actorMembershipId: context.membershipId,
      },
    });
  }

  private async loadDto(
    client: Client,
    context: OrganizationContext,
    paymentId: string,
  ): Promise<PaymentDto> {
    const record = await client.payment.findFirst({
      where: { organizationId: context.organizationId, id: paymentId },
      include: includePayment,
    });
    if (!record) throw fault('PAYMENT_NOT_FOUND', 'Payment was not found', 404);
    return projectPayment(record);
  }

  private async authorize(
    client: Client,
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
        'You do not have permission to access payments',
        403,
      );
    }
    return membership;
  }
}
