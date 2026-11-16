import { Injectable } from '@nestjs/common';
import type {
  CommercialTerms,
  Order,
  OrderDetail,
  OrderEvent,
  OrderLine,
  OrderSummary,
} from '@ancastle/types';
import type {
  AmendOrderInput,
  CancelOrderInput,
  ConfirmOrderInput,
  CreateOrderInput,
  OrderEventQuery,
  OrderQuery,
} from '@ancastle/validation';
import { Prisma } from '../../generated/prisma/client.js';
import { BusinessException } from '../../common/exceptions/business.exception.js';
import { lockMutation } from '../../database/mutation-locks.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { OrganizationContext } from '../authorization/organization-context.js';

const SalesDecimal = Prisma.Decimal.clone({
  precision: 80,
  rounding: Prisma.Decimal.ROUND_HALF_UP,
});

const orderSelect = {
  id: true,
  code: true,
  customerId: true,
  commercialState: true,
  version: true,
  currency: true,
  saleType: true,
  creditTermDays: true,
  customerCode: true,
  customerName: true,
  customerContactPerson: true,
  customerPhone: true,
  customerEmail: true,
  customerAddress: true,
  createdAt: true,
  updatedAt: true,
  lines: {
    select: {
      id: true,
      lineNumber: true,
      productId: true,
      productCode: true,
      productName: true,
      kind: true,
      unit: true,
      inventoryItemId: true,
      orderedQuantity: true,
      unitPrice: true,
      isRemoved: true,
      allocations: {
        select: { quantity: true, reversesLineId: true },
      },
    },
    orderBy: { lineNumber: 'asc' },
  },
} satisfies Prisma.OrderSelect;
type OrderRecord = Prisma.OrderGetPayload<{ select: typeof orderSelect }>;

const productSelect = {
  id: true,
  code: true,
  name: true,
  kind: true,
  unit: true,
  inventoryItemId: true,
  isActive: true,
} satisfies Prisma.SalesProductSelect;
type ProductRecord = Prisma.SalesProductGetPayload<{
  select: typeof productSelect;
}>;

const customerSelect = {
  id: true,
  code: true,
  name: true,
  contactPerson: true,
  phone: true,
  email: true,
  address: true,
  isActive: true,
} satisfies Prisma.CustomerSelect;
type CustomerRecord = Prisma.CustomerGetPayload<{
  select: typeof customerSelect;
}>;

const fault = (code: string, message: string, status = 409) =>
  new BusinessException(code, message, status);
const orderMissing = () => fault('ORDER_NOT_FOUND', 'Order was not found', 404);
const customerMissing = () =>
  fault('CUSTOMER_NOT_FOUND', 'Customer was not found', 404);
const productMissing = () =>
  fault('SALES_PRODUCT_NOT_FOUND', 'Sales product was not found', 404);
const stateConflict = () =>
  fault('ORDER_STATE_CONFLICT', 'Order cannot make this state transition');
const versionConflict = () =>
  fault('ORDER_VERSION_CONFLICT', 'Order changed; reload and retry your edit');
const sourceChanged = () =>
  fault(
    'SALES_PRODUCT_SOURCE_CHANGED',
    'Sales product definition changed; review and reselect the product',
  );

function canonicalTerms(
  saleType: string,
  creditTermDays: number | null,
): CommercialTerms {
  return saleType === 'CASH'
    ? { saleType: 'CASH', creditTermDays: null }
    : { saleType: 'CREDIT', creditTermDays: creditTermDays! };
}

function effectiveQuantity(line: OrderRecord['lines'][number]): Prisma.Decimal {
  return line.allocations.reduce(
    (total, allocation) =>
      allocation.reversesLineId === null
        ? total.plus(allocation.quantity)
        : total.minus(allocation.quantity),
    new SalesDecimal(0),
  );
}

function amount(quantity: Prisma.Decimal, unitPrice: Prisma.Decimal): string {
  return new SalesDecimal(quantity)
    .mul(unitPrice)
    .toDecimalPlaces(2, SalesDecimal.ROUND_HALF_UP)
    .toFixed(2);
}

function lineProgress(fulfilled: Prisma.Decimal, quantity: Prisma.Decimal) {
  if (fulfilled.isZero()) return 'UNFULFILLED' as const;
  if (fulfilled.eq(quantity)) return 'FULFILLED' as const;
  return 'PARTIALLY_FULFILLED' as const;
}

function projectOrder(record: OrderRecord): Order {
  const activeLines = record.lines.filter((line) => !line.isRemoved);
  const quantities = new Map<string, Prisma.Decimal>();
  for (const line of record.lines) {
    const fulfilled = effectiveQuantity(line);
    if (
      fulfilled.isNegative() ||
      fulfilled.gt(line.orderedQuantity) ||
      (line.isRemoved && !fulfilled.isZero())
    ) {
      throw fault(
        'ORDER_HISTORY_INVALID',
        'Order history is inconsistent',
        409,
      );
    }
    quantities.set(line.id, fulfilled);
  }
  const aggregate = activeLines.reduce(
    (total, line) => total.plus(quantities.get(line.id)!),
    new SalesDecimal(0),
  );
  const ordered = activeLines.reduce(
    (total, line) => total.plus(line.orderedQuantity),
    new SalesDecimal(0),
  );
  const progress =
    record.commercialState === 'DRAFT' || activeLines.length === 0
      ? null
      : lineProgress(aggregate, ordered);
  const lines: OrderLine[] = record.lines.map((line) => {
    const fulfilled = quantities.get(line.id)!;
    const remaining = new SalesDecimal(line.orderedQuantity).minus(fulfilled);
    const cancelled =
      record.commercialState === 'CANCELLED' && !line.isRemoved
        ? remaining
        : new SalesDecimal(0);
    return {
      id: line.id,
      lineNumber: line.lineNumber,
      productId: line.productId,
      productCode: line.productCode,
      productName: line.productName,
      kind: line.kind,
      unit: line.unit,
      orderedQuantity: line.orderedQuantity.toString(),
      unitPrice: line.unitPrice.toFixed(4),
      lineAmount: amount(line.orderedQuantity, line.unitPrice),
      fulfilledQuantity: fulfilled.toString(),
      remainingQuantity:
        record.commercialState === 'CANCELLED' || line.isRemoved
          ? '0'
          : remaining.toString(),
      cancelledQuantity: cancelled.toString(),
      fulfilmentProgress:
        record.commercialState === 'DRAFT' || line.isRemoved
          ? null
          : lineProgress(fulfilled, line.orderedQuantity),
      isRemoved: line.isRemoved,
    } as OrderLine;
  });
  const totalAmount = activeLines.reduce(
    (total, line) =>
      total.plus(amountDecimal(line.orderedQuantity, line.unitPrice)),
    new SalesDecimal(0),
  );
  return {
    id: record.id,
    code: record.code,
    commercialState: record.commercialState,
    fulfilmentProgress: progress,
    version: record.version,
    currency: 'JMD',
    terms: canonicalTerms(record.saleType, record.creditTermDays),
    totalAmount: totalAmount.toFixed(2),
    customer: {
      id: record.customerId,
      code: record.customerCode,
      name: record.customerName,
      contactPerson: record.customerContactPerson,
      phone: record.customerPhone,
      email: record.customerEmail,
      address: record.customerAddress,
    },
    lines,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

function projectSummary(order: Order): OrderSummary {
  return {
    id: order.id,
    code: order.code,
    customer: {
      id: order.customer.id,
      code: order.customer.code,
      name: order.customer.name,
    },
    commercialState: order.commercialState,
    fulfilmentProgress: order.fulfilmentProgress,
    version: order.version,
    currency: order.currency,
    terms: order.terms,
    totalAmount: order.totalAmount,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };
}

function amountDecimal(quantity: Prisma.Decimal, unitPrice: Prisma.Decimal) {
  return new SalesDecimal(quantity)
    .mul(unitPrice)
    .toDecimalPlaces(2, SalesDecimal.ROUND_HALF_UP);
}

function commercialProjection(order: Order): Prisma.InputJsonObject {
  return {
    commercialState: order.commercialState,
    customer: order.customer,
    currency: order.currency,
    terms: order.terms,
    totalAmount: order.totalAmount,
    lines: order.lines.map((line) => ({
      id: line.id,
      lineNumber: line.lineNumber,
      productId: line.productId,
      productCode: line.productCode,
      productName: line.productName,
      kind: line.kind,
      unit: line.unit,
      orderedQuantity: line.orderedQuantity,
      unitPrice: line.unitPrice,
      lineAmount: line.lineAmount,
      isRemoved: line.isRemoved,
    })),
  } as unknown as Prisma.InputJsonObject;
}

function customerData(customer: CustomerRecord) {
  return {
    customerCode: customer.code,
    customerName: customer.name,
    customerContactPerson: customer.contactPerson,
    customerPhone: customer.phone,
    customerEmail: customer.email,
    customerAddress: customer.address,
  };
}

function matchesExpectedProduct(
  product: ProductRecord,
  expected: { kind: string; unit: string; inventoryItemId?: string },
) {
  return (
    product.kind === expected.kind &&
    product.unit === expected.unit &&
    (product.inventoryItemId ?? undefined) === expected.inventoryItemId
  );
}

function eventData(order: Order, before: Prisma.InputJsonObject | null) {
  return {
    ...(before === null ? {} : { before }),
    after: commercialProjection(order),
  } satisfies Prisma.InputJsonObject;
}

@Injectable()
export class SalesOrdersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    context: OrganizationContext,
    input: CreateOrderInput,
  ): Promise<Order> {
    return this.prisma.$transaction(
      async (tx) => {
        const productIds = [
          ...new Set(input.lines.map((line) => line.productId)),
        ];
        await lockMutation(tx, context, {
          parent: 'UPDATE',
          definitions: {
            customers: [{ id: input.customerId }],
            sales_products: productIds.map((id) => ({ id })),
          },
        });
        const customer = await tx.customer.findFirst({
          where: {
            id: input.customerId,
            organizationId: context.organizationId,
          },
          select: customerSelect,
        });
        if (!customer) throw customerMissing();
        if (!customer.isActive)
          throw fault('CUSTOMER_INACTIVE', 'Customer is inactive');
        const products = await this.loadProducts(tx, context, productIds);
        const lines = input.lines.map((line) => this.makeLine(line, products));
        const latest = await tx.order.findFirst({
          where: {
            organizationId: context.organizationId,
            code: { startsWith: 'ORD-' },
          },
          select: { code: true },
          orderBy: { code: 'desc' },
        });
        const code = this.nextCode(latest?.code);
        const record = await tx.order.create({
          data: {
            organizationId: context.organizationId,
            code,
            customerId: customer.id,
            currency: input.currency,
            saleType: input.terms.saleType,
            creditTermDays: input.terms.creditTermDays,
            ...customerData(customer),
            actorUserId: context.userId,
            lines: {
              create: lines.map((line, index) => ({
                ...line,
                lineNumber: index + 1,
              })),
            },
          },
          select: orderSelect,
        });
        const order = projectOrder(record);
        await tx.orderEvent.create({
          data: {
            organizationId: context.organizationId,
            orderId: order.id,
            action: 'CREATED',
            orderVersion: order.version,
            actorUserId: context.userId,
            commercialChanges: eventData(order, null),
          },
        });
        return order;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
  }

  async amend(
    context: OrganizationContext,
    orderId: string,
    input: AmendOrderInput,
  ): Promise<Order> {
    const peek = await this.findOrder(context, orderId);
    const productIds = new Set(peek.lines.map((line) => line.productId));
    for (const operation of input.lines ?? [])
      if ('line' in operation) productIds.add(operation.line.productId);
    const customerId = input.customerId ?? peek.customerId;
    return this.prisma.$transaction(
      async (tx) => {
        await lockMutation(tx, context, {
          orderId,
          definitions: {
            customers: [{ id: customerId }],
            sales_products: [...productIds].map((id) => ({ id })),
          },
        });
        const current = await this.findOrder(context, orderId, tx);
        if (current.version !== input.expectedOrderVersion)
          throw versionConflict();
        if (current.commercialState !== 'DRAFT') throw stateConflict();

        const customer = await tx.customer.findFirst({
          where: { id: customerId, organizationId: context.organizationId },
          select: customerSelect,
        });
        if (!customer) throw customerMissing();
        if (!customer.isActive)
          throw fault('CUSTOMER_INACTIVE', 'Customer is inactive');
        const products = await this.loadProducts(tx, context, [...productIds]);
        const before = projectOrder(current);
        const terms = input.terms ?? before.terms;
        const remaining = new Map(current.lines.map((line) => [line.id, line]));
        let nextLineNumber = Math.max(
          0,
          ...current.lines.map((line) => line.lineNumber),
        );

        for (const operation of input.lines ?? []) {
          if (operation.operation === 'ADD') {
            nextLineNumber += 1;
            if (nextLineNumber > 100)
              throw fault(
                'ORDER_LINE_LIMIT_REACHED',
                'Order line limit has been reached',
                400,
              );
            const line = this.makeLine(operation.line, products);
            await tx.orderLine.create({
              data: {
                organizationId: context.organizationId,
                orderId,
                lineNumber: nextLineNumber,
                ...line,
              },
            });
          } else {
            const existing = remaining.get(operation.lineId);
            if (!existing || existing.isRemoved)
              throw fault(
                'ORDER_LINE_NOT_FOUND',
                'Order line was not found',
                404,
              );
            if (operation.operation === 'REMOVE') {
              if (!effectiveQuantity(existing).isZero()) throw stateConflict();
              await tx.orderLine.update({
                where: {
                  organizationId_orderId_id: {
                    organizationId: context.organizationId,
                    orderId,
                    id: existing.id,
                  },
                },
                data: { isRemoved: true },
              });
            } else {
              await tx.orderLine.update({
                where: {
                  organizationId_orderId_id: {
                    organizationId: context.organizationId,
                    orderId,
                    id: existing.id,
                  },
                },
                data: this.makeLine(operation.line, products),
              });
            }
          }
        }

        // Revalidate the complete resulting draft; unchanged lines may not silently
        // follow a catalog source identity that changed since the draft was saved.
        const finalLines = await tx.orderLine.findMany({
          where: {
            organizationId: context.organizationId,
            orderId,
            isRemoved: false,
          },
          select: {
            productId: true,
            kind: true,
            unit: true,
            inventoryItemId: true,
          },
        });
        for (const line of finalLines) {
          const product = products.get(line.productId);
          if (!product) throw productMissing();
          if (!product.isActive)
            throw fault('SALES_PRODUCT_INACTIVE', 'Sales product is inactive');
          if (
            product.kind !== line.kind ||
            product.unit !== line.unit ||
            product.inventoryItemId !== line.inventoryItemId
          )
            throw sourceChanged();
        }

        const [updated] = await tx.order.updateManyAndReturn({
          where: {
            id: orderId,
            organizationId: context.organizationId,
            version: current.version,
            commercialState: 'DRAFT',
          },
          data: {
            customerId,
            currency: input.currency ?? current.currency,
            saleType: terms.saleType,
            creditTermDays: terms.creditTermDays,
            ...customerData(customer),
            version: { increment: 1 },
          },
          select: { id: true },
        });
        if (!updated) throw versionConflict();
        const after = projectOrder(await this.findOrder(context, orderId, tx));
        await tx.orderEvent.create({
          data: {
            organizationId: context.organizationId,
            orderId,
            action: 'AMENDED',
            orderVersion: after.version,
            actorUserId: context.userId,
            commercialChanges: eventData(after, commercialProjection(before)),
          },
        });
        return after;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
  }

  async confirm(
    context: OrganizationContext,
    orderId: string,
    input: ConfirmOrderInput,
  ): Promise<Order> {
    const peek = await this.findOrder(context, orderId);
    const productIds = [
      ...new Set(
        peek.lines
          .filter((line) => !line.isRemoved)
          .map((line) => line.productId),
      ),
    ];
    return this.prisma.$transaction(
      async (tx) => {
        await lockMutation(tx, context, {
          orderId,
          definitions: {
            customers: [{ id: peek.customerId }],
            sales_products: productIds.map((id) => ({ id })),
          },
        });
        const current = await this.findOrder(context, orderId, tx);
        if (current.commercialState === 'CONFIRMED')
          return projectOrder(current);
        if (current.commercialState !== 'DRAFT') throw stateConflict();
        if (current.version !== input.expectedOrderVersion)
          throw versionConflict();
        const lines = current.lines.filter((line) => !line.isRemoved);
        if (lines.length === 0)
          throw fault(
            'ORDER_REQUIRES_LINES',
            'Order requires at least one active line',
            400,
          );
        const customer = await tx.customer.findFirst({
          where: {
            id: current.customerId,
            organizationId: context.organizationId,
          },
          select: customerSelect,
        });
        if (!customer) throw customerMissing();
        if (!customer.isActive)
          throw fault('CUSTOMER_INACTIVE', 'Customer is inactive');
        const products = await this.loadProducts(tx, context, productIds);
        for (const line of lines) {
          const product = products.get(line.productId);
          if (!product) throw productMissing();
          if (!product.isActive)
            throw fault('SALES_PRODUCT_INACTIVE', 'Sales product is inactive');
          if (
            product.kind !== line.kind ||
            product.unit !== line.unit ||
            product.inventoryItemId !== line.inventoryItemId
          )
            throw sourceChanged();
        }
        for (const line of lines) {
          const product = products.get(line.productId)!;
          await tx.orderLine.update({
            where: {
              organizationId_orderId_id: {
                organizationId: context.organizationId,
                orderId,
                id: line.id,
              },
            },
            data: { productCode: product.code, productName: product.name },
          });
        }
        const [updated] = await tx.order.updateManyAndReturn({
          where: {
            id: orderId,
            organizationId: context.organizationId,
            version: current.version,
            commercialState: 'DRAFT',
          },
          data: {
            commercialState: 'CONFIRMED',
            ...customerData(customer),
            version: { increment: 1 },
          },
          select: { id: true },
        });
        if (!updated) throw versionConflict();
        const after = projectOrder(await this.findOrder(context, orderId, tx));
        await tx.orderEvent.create({
          data: {
            organizationId: context.organizationId,
            orderId,
            action: 'CONFIRMED',
            orderVersion: after.version,
            actorUserId: context.userId,
            commercialChanges: eventData(
              after,
              commercialProjection(projectOrder(current)),
            ),
          },
        });
        return after;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
  }

  async cancel(
    context: OrganizationContext,
    orderId: string,
    input: CancelOrderInput,
  ): Promise<Order> {
    return this.prisma.$transaction(
      async (tx) => {
        await lockMutation(tx, context, { orderId });
        const current = await this.findOrder(context, orderId, tx);
        if (current.commercialState === 'CANCELLED')
          return projectOrder(current);
        if (
          current.commercialState !== 'DRAFT' &&
          current.commercialState !== 'CONFIRMED'
        )
          throw stateConflict();
        if (current.version !== input.expectedOrderVersion)
          throw versionConflict();
        const before = projectOrder(current);
        if (current.commercialState === 'CONFIRMED') {
          const open = current.lines
            .filter((line) => !line.isRemoved)
            .some((line) => effectiveQuantity(line).lt(line.orderedQuantity));
          if (!open) throw stateConflict();
        }
        const [updated] = await tx.order.updateManyAndReturn({
          where: {
            id: orderId,
            organizationId: context.organizationId,
            version: current.version,
            commercialState: current.commercialState,
          },
          data: {
            commercialState: 'CANCELLED',
            version: { increment: 1 },
          },
          select: { id: true },
        });
        if (!updated) throw versionConflict();
        const after = projectOrder(await this.findOrder(context, orderId, tx));
        await tx.orderEvent.create({
          data: {
            organizationId: context.organizationId,
            orderId,
            action: 'CANCELLED',
            orderVersion: after.version,
            actorUserId: context.userId,
            reason: input.reason,
            commercialChanges: {
              before: commercialProjection(before),
              after: commercialProjection(after),
              closedRemainder: current.lines
                .filter((line) => !line.isRemoved)
                .map((line) => ({
                  lineNumber: line.lineNumber,
                  quantity: new SalesDecimal(line.orderedQuantity)
                    .minus(effectiveQuantity(line))
                    .toString(),
                })),
            },
          },
        });
        return after;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
  }

  async get(
    context: OrganizationContext,
    orderId: string,
  ): Promise<OrderDetail> {
    const record = await this.findOrder(context, orderId);
    return {
      ...projectOrder(record),
      sourceDetails: { visibility: 'REDACTED' },
    };
  }

  async list(context: OrganizationContext, input: OrderQuery) {
    const where: Prisma.OrderWhereInput = {
      organizationId: context.organizationId,
      customerId: input.customerId,
      commercialState: input.state,
      ...(input.search
        ? {
            OR: [
              { code: { contains: input.search, mode: 'insensitive' } },
              { customerCode: { contains: input.search, mode: 'insensitive' } },
              { customerName: { contains: input.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    return this.prisma.$transaction(
      async (tx) => {
        if (input.progress) {
          const { ids: pageIds, totalItems } = await this.progressFilteredIds(
            tx,
            input,
            context,
          );
          const records = pageIds.length
            ? await tx.order.findMany({
                where: {
                  organizationId: context.organizationId,
                  id: { in: pageIds },
                },
                select: orderSelect,
              })
            : [];
          const byId = new Map(records.map((record) => [record.id, record]));
          const data: OrderSummary[] = pageIds
            .map((id) => byId.get(id))
            .filter((record) => record !== undefined)
            .map((record) => projectSummary(projectOrder(record)));
          return { data, meta: this.pageMeta(input, totalItems) };
        }
        const [records, totalItems] = await Promise.all([
          tx.order.findMany({
            where,
            select: orderSelect,
            skip: (input.page - 1) * input.pageSize,
            take: input.pageSize,
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          }),
          tx.order.count({ where }),
        ]);
        const data = records.map((record) =>
          projectSummary(projectOrder(record)),
        );
        return { data, meta: this.pageMeta(input, totalItems) };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  async events(
    context: OrganizationContext,
    orderId: string,
    input: OrderEventQuery,
  ) {
    return this.prisma.$transaction(
      async (tx) => {
        const order = await tx.order.findFirst({
          where: { id: orderId, organizationId: context.organizationId },
          select: { id: true },
        });
        if (!order) throw orderMissing();
        const where = { organizationId: context.organizationId, orderId };
        const [records, totalItems] = await Promise.all([
          tx.orderEvent.findMany({
            where,
            skip: (input.page - 1) * input.pageSize,
            take: input.pageSize,
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          }),
          tx.orderEvent.count({ where }),
        ]);
        const data: OrderEvent[] = records.map((record) => ({
          id: record.id,
          action: record.action as OrderEvent['action'],
          orderVersion: record.orderVersion,
          actorUserId: record.actorUserId,
          reason: record.reason,
          commercialChanges: record.commercialChanges as Record<
            string,
            unknown
          >,
          createdAt: record.createdAt.toISOString(),
        }));
        return { data, meta: this.pageMeta(input, totalItems) };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  private async findOrder(
    context: OrganizationContext,
    id: string,
    tx: Prisma.TransactionClient = this.prisma,
  ) {
    const order = await tx.order.findFirst({
      where: { id, organizationId: context.organizationId },
      select: orderSelect,
    });
    if (!order) throw orderMissing();
    return order;
  }

  private async loadProducts(
    tx: Prisma.TransactionClient,
    context: OrganizationContext,
    ids: string[],
  ) {
    const records = ids.length
      ? await tx.salesProduct.findMany({
          where: { organizationId: context.organizationId, id: { in: ids } },
          select: productSelect,
        })
      : [];
    if (records.length !== new Set(ids).size) throw productMissing();
    return new Map(records.map((product) => [product.id, product]));
  }

  private makeLine(
    input: CreateOrderInput['lines'][number],
    products: Map<string, ProductRecord>,
  ) {
    const product = products.get(input.productId);
    if (!product) throw productMissing();
    if (!product.isActive)
      throw fault('SALES_PRODUCT_INACTIVE', 'Sales product is inactive');
    if (!matchesExpectedProduct(product, input.expectedProduct))
      throw sourceChanged();
    return {
      productId: product.id,
      productCode: product.code,
      productName: product.name,
      kind: product.kind,
      unit: product.unit,
      inventoryItemId: product.inventoryItemId,
      orderedQuantity: new Prisma.Decimal(input.quantity),
      unitPrice: new Prisma.Decimal(input.unitPrice),
    };
  }

  private nextCode(previous?: string) {
    if (!previous) return 'ORD-000001';
    const match = /^ORD-(\d{6})$/.exec(previous);
    if (!match || Number(match[1]) >= 999999)
      throw fault(
        'ORDER_CODE_LIMIT_REACHED',
        'Order code limit has been reached',
        409,
      );
    return `ORD-${String(Number(match[1]) + 1).padStart(6, '0')}`;
  }

  private pageMeta(
    input: { page: number; pageSize: number },
    totalItems: number,
  ) {
    return {
      page: input.page,
      pageSize: input.pageSize,
      totalItems,
      totalPages: Math.ceil(totalItems / input.pageSize),
    };
  }

  private async progressFilteredIds(
    tx: Prisma.TransactionClient,
    input: OrderQuery,
    context: OrganizationContext,
  ) {
    const filters: Prisma.Sql[] = [
      Prisma.sql`o."organizationId" = ${context.organizationId}::uuid`,
    ];
    if (input.customerId)
      filters.push(Prisma.sql`o."customerId" = ${input.customerId}::uuid`);
    if (input.state)
      filters.push(Prisma.sql`o."commercialState"::text = ${input.state}`);
    if (input.search)
      filters.push(
        Prisma.sql`(o."code" ILIKE '%' || ${input.search} || '%' OR o."customerCode" ILIKE '%' || ${input.search} || '%' OR o."customerName" ILIKE '%' || ${input.search} || '%')`,
      );
    filters.push(Prisma.sql`p.progress = ${input.progress}`);
    const cte = Prisma.sql`
      WITH line_totals AS (
        SELECT l."orderId", l."id", l."isRemoved", l."orderedQuantity",
          COALESCE(SUM(CASE WHEN f."reversesLineId" IS NULL THEN f."quantity" ELSE -f."quantity" END), 0) AS fulfilled
        FROM "order_lines" l
        LEFT JOIN "fulfilment_lines" f ON f."organizationId" = l."organizationId"
          AND f."orderId" = l."orderId" AND f."orderLineId" = l."id"
        WHERE l."organizationId" = ${context.organizationId}::uuid
        GROUP BY l."orderId", l."id", l."isRemoved", l."orderedQuantity"
      ), order_progress AS (
        SELECT o."id", CASE
          WHEN o."commercialState" = 'DRAFT' THEN NULL
          WHEN COUNT(t."id") FILTER (WHERE NOT t."isRemoved") = 0 THEN NULL
          WHEN COALESCE(SUM(t.fulfilled) FILTER (WHERE NOT t."isRemoved"), 0) = 0 THEN 'UNFULFILLED'
          WHEN SUM(t.fulfilled) FILTER (WHERE NOT t."isRemoved") = SUM(t."orderedQuantity") FILTER (WHERE NOT t."isRemoved") THEN 'FULFILLED'
          ELSE 'PARTIALLY_FULFILLED' END AS progress
        FROM "orders" o
        LEFT JOIN line_totals t ON t."orderId" = o."id"
        WHERE o."organizationId" = ${context.organizationId}::uuid
        GROUP BY o."id"
      )
    `;
    const [rows, countRows] = await Promise.all([
      tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        ${cte}
        SELECT o."id" FROM "orders" o JOIN order_progress p ON p."id" = o."id"
        WHERE ${Prisma.join(filters, ' AND ')}
        ORDER BY o."createdAt" DESC, o."id" DESC
        LIMIT ${input.pageSize} OFFSET ${(input.page - 1) * input.pageSize}
      `),
      tx.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
        ${cte}
        SELECT COUNT(*)::bigint AS count FROM "orders" o
        JOIN order_progress p ON p."id" = o."id"
        WHERE ${Prisma.join(filters, ' AND ')}
      `),
    ]);
    return {
      ids: rows.map((row) => row.id),
      totalItems: Number(countRows[0]?.count ?? 0n),
    };
  }
}
