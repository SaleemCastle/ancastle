import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type {
  Fulfilment,
  FulfilmentCommandReceipt,
  FulfilmentListResponse,
} from '@ancastle/types';
import {
  fulfilmentSchema,
  idempotencyKeySchema,
  postFulfilmentSchema,
  reverseFulfilmentSchema,
  type FulfilmentQuery,
  type PostFulfilmentInput,
  type ReverseFulfilmentInput,
} from '@ancastle/validation';
import { BusinessException } from '../../common/exceptions/business.exception.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { lockMutation } from '../../database/mutation-locks.js';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { AuthorizationService } from '../authorization/authorization.service.js';
import { FarmAccessService } from '../authorization/farm-access.service.js';
import type { OrganizationContext } from '../authorization/organization-context.js';
import { Permission } from '../authorization/permissions.js';
import { InventoryStockService } from '../inventory/inventory-stock.service.js';
import { effectivePopulation } from '../poultry/poultry-history.js';
import { FulfilmentActivationService } from './fulfilment-activation.service.js';
import {
  canonicalId,
  fulfilmentFingerprint,
  fulfilmentHashVersion,
} from './fulfilment-command.js';

const eventInclude = {
  lines: { include: { depletions: true }, orderBy: { id: 'asc' as const } },
} satisfies Prisma.FulfilmentInclude;
type EventRecord = Prisma.FulfilmentGetPayload<{
  include: typeof eventInclude;
}>;
const orderInclude = {
  lines: { include: { allocations: true } },
} satisfies Prisma.OrderInclude;
type OrderRecord = Prisma.OrderGetPayload<{ include: typeof orderInclude }>;
const fault = (code: string, message: string, status = 409) =>
  new BusinessException(code, message, status);
const missing = () =>
  fault('FULFILMENT_NOT_FOUND', 'Fulfilment was not found', 404);
const unavailable = () =>
  fault(
    'FULFILMENT_SOURCE_UNAVAILABLE',
    'Selected fulfilment source is unavailable',
  );
const forbidden = () =>
  fault('FORBIDDEN', 'You do not have permission to perform this action', 403);
const Decimal = Prisma.Decimal.clone({ precision: 40 });

function projectEvent(event: EventRecord): Fulfilment {
  // Explicit allowlist: no Prisma relations or command hashes enter responses.
  return fulfilmentSchema.parse({
    id: event.id,
    code: event.code,
    orderId: event.orderId,
    farmId: event.farmId,
    actorUserId: event.actorUserId,
    occurredAt: event.occurredAt.toISOString(),
    createdAt: event.createdAt.toISOString(),
    note: event.note,
    reference: event.reference,
    kind: event.kind,
    reversesFulfilmentId: event.reversesFulfilmentId,
    ...(event.kind === 'REVERSAL'
      ? {
          reason: event.reason,
          postingErrorConfirmed: event.postingErrorConfirmed,
        }
      : {}),
    lines: event.lines.map((line) => ({
      id: line.id,
      orderLineId: line.orderLineId,
      quantity: line.quantity.toString(),
      sourceCode: line.sourceCode,
      kind: line.kind,
      unit: line.unit,
      reversesLineId: line.reversesLineId,
      ...(line.kind === 'POULTRY'
        ? { flockId: line.flockId, depletionId: line.depletions[0]?.id }
        : {
            inventoryItemId: line.inventoryItemId,
            inventoryMovementId: line.inventoryMovementId,
            movementReason: event.kind === 'POSTING' ? 'ISSUE' : 'ADJUSTMENT',
          }),
    })),
  });
}

@Injectable()
export class FulfilmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stock: InventoryStockService,
    private readonly farms: FarmAccessService,
    private readonly authorization: AuthorizationService,
    private readonly activation: FulfilmentActivationService,
  ) {}

  async post(
    context: OrganizationContext,
    farmId: string,
    orderId: string,
    key: string,
    raw: PostFulfilmentInput,
  ) {
    this.activation.assertEnabled();
    const input = new ZodValidationPipe(postFulfilmentSchema).transform(raw);
    key = canonicalId(
      new ZodValidationPipe(idempotencyKeySchema).transform(key),
    );
    farmId = canonicalId(farmId);
    orderId = canonicalId(orderId);
    input.allocations = input.allocations.map((a) => ({
      ...a,
      orderLineId: canonicalId(a.orderLineId),
      ...(a.kind === 'POULTRY'
        ? { flockId: canonicalId(a.flockId) }
        : { inventoryItemId: canonicalId(a.inventoryItemId) }),
    }));
    const pairs = input.allocations.map(
      (a) =>
        `${a.orderLineId}:${a.kind}:${a.kind === 'POULTRY' ? a.flockId : a.inventoryItemId}`,
    );
    if (new Set(pairs).size !== pairs.length)
      throw fault(
        'FULFILMENT_DUPLICATE_SOURCE',
        'Duplicate line/source allocation',
        400,
      );
    const hash = fulfilmentFingerprint('POST', orderId, input);
    return this.prisma.$transaction(
      async (tx) => {
        await this.authorize(tx, context, farmId, Permission.FULFILMENT_POST);
        // Scoped discovery only. No availability or mutable eligibility decision until
        // the complete canonical plan is held. Replays precede all such decisions.
        const peek = await this.order(tx, context, orderId);
        const flockIds = input.allocations.flatMap((a) =>
          a.kind === 'POULTRY' ? [a.flockId] : [],
        );
        const itemIds = input.allocations.flatMap((a) =>
          a.kind === 'PRODUCE' ? [a.inventoryItemId] : [],
        );
        const productIds =
          peek?.lines
            .filter((line) =>
              input.allocations.some((a) => a.orderLineId === line.id),
            )
            .map((line) => line.productId) ?? [];
        const sources = await tx.poultryProductSource.findMany({
          where: {
            organizationId: context.organizationId,
            farmId,
            productId: { in: productIds },
            flockId: { in: flockIds },
          },
          select: { id: true },
        });
        await lockMutation(tx, context, {
          command: { farmId, operation: 'POST', key },
          orderId,
          definitions: {
            farms: [{ id: farmId }],
            customers: peek ? [{ id: peek.customerId }] : [],
            sales_products: productIds.map((id) => ({ id })),
            poultry_product_sources: sources.map(({ id }) => ({ id })),
            inventory_items: itemIds.map((id) => ({ id })),
          },
          flocks: flockIds.map((flockId) => ({ farmId, flockId })),
          stock: itemIds.map((inventoryItemId) => ({
            farmId,
            inventoryItemId,
          })),
        });
        this.activation.assertEnabled();
        await this.authorize(tx, context, farmId, Permission.FULFILMENT_POST);
        const replay = await this.replay(
          tx,
          context,
          farmId,
          'POST',
          key,
          hash,
        );
        if (replay) return replay;
        const order = await this.order(tx, context, orderId);
        this.checkOrder(order, input.expectedOrderVersion, false);
        if (!peek || order.customerId !== peek.customerId) throw unavailable();
        const customer = await tx.customer.findFirst({
          where: {
            id: order.customerId,
            organizationId: context.organizationId,
            isActive: true,
          },
        });
        if (!customer)
          throw fault('CUSTOMER_INACTIVE', 'Customer is unavailable');

        const products = await tx.salesProduct.findMany({
          where: {
            organizationId: context.organizationId,
            id: { in: productIds },
          },
        });
        const eligible = await tx.poultryProductSource.findMany({
          where: {
            organizationId: context.organizationId,
            farmId,
            id: { in: sources.map((s) => s.id) },
            isActive: true,
          },
        });
        const flocks = await tx.flock.findMany({
          where: {
            organizationId: context.organizationId,
            farmId,
            id: { in: flockIds },
            isActive: true,
          },
        });
        const items = await tx.inventoryItem.findMany({
          where: {
            organizationId: context.organizationId,
            id: { in: itemIds },
            category: 'PRODUCE',
            isActive: true,
          },
        });
        const perLine = new Map<string, Prisma.Decimal>();
        const perFlock = new Map<string, Prisma.Decimal>();
        for (const a of input.allocations) {
          const line = order.lines.find(
            (l) => l.id === a.orderLineId && !l.isRemoved,
          );
          const product = products.find(
            (p) => p.id === line?.productId && p.isActive,
          );
          if (
            !line ||
            !product ||
            line.kind !== a.kind ||
            product.kind !== line.kind ||
            product.unit !== line.unit ||
            product.inventoryItemId !== line.inventoryItemId
          )
            throw unavailable();
          const quantity = new Decimal(a.quantity);
          if (line.unit === 'EACH' && !quantity.isInteger())
            throw fault(
              'FULFILMENT_QUANTITY_INVALID',
              'Whole units are required',
              400,
            );
          if (a.kind === 'POULTRY') {
            if (
              !flocks.some((f) => f.id === a.flockId) ||
              !eligible.some(
                (s) =>
                  s.productId === line.productId && s.flockId === a.flockId,
              )
            )
              throw unavailable();
            perFlock.set(
              a.flockId,
              (perFlock.get(a.flockId) ?? new Decimal(0)).plus(quantity),
            );
          } else {
            const item = items.find((i) => i.id === a.inventoryItemId);
            if (
              !item ||
              item.id !== line.inventoryItemId ||
              item.unit !== line.unit
            )
              throw unavailable();
          }
          perLine.set(
            line.id,
            (perLine.get(line.id) ?? new Decimal(0)).plus(quantity),
          );
        }
        for (const [id, requested] of perLine) {
          const line = order.lines.find((l) => l.id === id)!;
          const fulfilled = line.allocations.reduce(
            (total, a) =>
              a.reversesLineId === null
                ? total.plus(a.quantity)
                : total.minus(a.quantity),
            new Decimal(0),
          );
          if (
            fulfilled.isNegative() ||
            requested.plus(fulfilled).gt(line.orderedQuantity)
          )
            throw fault(
              'ORDER_OVER_FULFILMENT',
              'Requested quantity exceeds remaining order demand',
            );
        }
        for (const [flockId, requested] of perFlock) {
          const population = await effectivePopulation(tx, {
            organizationId: context.organizationId,
            farmId,
            flockId,
          });
          const flock = flocks.find((f) => f.id === flockId)!;
          const available = new Decimal(flock.startingBirdCount)
            .minus(population.mortality)
            .minus(population.fulfilledBirds);
          if (requested.gt(available))
            throw fault(
              'INSUFFICIENT_FLOCK_POPULATION',
              'Insufficient live birds for this posting',
            );
        }
        const id = randomUUID();
        const occurredAt = new Date(input.occurredAt);
        await tx.fulfilment.create({
          data: {
            id,
            code: `FUL-${id}`,
            organizationId: context.organizationId,
            farmId,
            orderId,
            kind: 'POSTING',
            actorUserId: context.userId,
            occurredAt,
            note: input.note,
            reference: input.reference,
          },
        });
        for (const a of input.allocations) {
          const line = order.lines.find((l) => l.id === a.orderLineId)!;
          const quantity = new Decimal(a.quantity);
          const movement =
            a.kind === 'PRODUCE'
              ? await this.stock.postMovementInTransaction(tx, context, {
                  farmId,
                  inventoryItemId: a.inventoryItemId,
                  expectedInventoryUnit: line.unit,
                  quantity: quantity.negated(),
                  reason: 'ISSUE',
                  occurredAt,
                  note: input.note,
                  reference: input.reference,
                })
              : null;
          const allocation = await tx.fulfilmentLine.create({
            data: {
              organizationId: context.organizationId,
              farmId,
              orderId,
              fulfilmentId: id,
              orderLineId: line.id,
              kind: a.kind,
              unit: line.unit,
              quantity,
              occurredAt,
              sourceCode:
                a.kind === 'POULTRY'
                  ? flocks.find((f) => f.id === a.flockId)!.code
                  : items.find((i) => i.id === a.inventoryItemId)!.code,
              flockId: a.kind === 'POULTRY' ? a.flockId : null,
              inventoryItemId: a.kind === 'PRODUCE' ? a.inventoryItemId : null,
              inventoryMovementId: movement?.id,
            },
          });
          if (a.kind === 'POULTRY')
            await tx.flockSaleDepletion.create({
              data: {
                organizationId: context.organizationId,
                farmId,
                flockId: a.flockId,
                fulfilmentLineId: allocation.id,
                birdCount: quantity.toNumber(),
                actorUserId: context.userId,
                occurredAt,
              },
            });
        }
        return this.seal(tx, context, farmId, orderId, id, 'POST', key, hash);
      },
      { isolationLevel: 'ReadCommitted' },
    );
  }

  async reverse(
    context: OrganizationContext,
    farmId: string,
    fulfilmentId: string,
    key: string,
    raw: ReverseFulfilmentInput,
  ) {
    this.activation.assertEnabled();
    const input = new ZodValidationPipe(reverseFulfilmentSchema).transform(raw);
    key = canonicalId(
      new ZodValidationPipe(idempotencyKeySchema).transform(key),
    );
    farmId = canonicalId(farmId);
    fulfilmentId = canonicalId(fulfilmentId);
    const hash = fulfilmentFingerprint('REVERSE', fulfilmentId, input);
    return this.prisma.$transaction(
      async (tx) => {
        await this.authorize(
          tx,
          context,
          farmId,
          Permission.FULFILMENT_REVERSE,
        );
        const original = await this.event(tx, context, farmId, fulfilmentId);
        // Discovery may miss a changed target. The scoped key must still be
        // serialized and compared before deciding whether a new intent is valid.
        const itemIds =
          original?.lines.flatMap((l) =>
            l.inventoryItemId ? [l.inventoryItemId] : [],
          ) ?? [];
        const flockIds =
          original?.lines.flatMap((l) => (l.flockId ? [l.flockId] : [])) ?? [];
        await lockMutation(tx, context, {
          command: { farmId, operation: 'REVERSE', key },
          orderId: original?.orderId,
          definitions: {
            farms: [{ id: farmId }],
            inventory_items: itemIds.map((id) => ({ id })),
          },
          flocks: flockIds.map((flockId) => ({ farmId, flockId })),
          stock: itemIds.map((inventoryItemId) => ({
            farmId,
            inventoryItemId,
          })),
        });
        this.activation.assertEnabled();
        await this.authorize(
          tx,
          context,
          farmId,
          Permission.FULFILMENT_REVERSE,
        );
        const replay = await this.replay(
          tx,
          context,
          farmId,
          'REVERSE',
          key,
          hash,
        );
        if (replay) return replay;
        if (!original) throw missing();
        const order = await this.order(tx, context, original.orderId);
        this.checkOrder(order, input.expectedOrderVersion, true);
        if (original.kind !== 'POSTING')
          throw fault(
            'FULFILMENT_REVERSAL_INVALID',
            'Only original postings can be reversed',
          );
        if (
          await tx.fulfilment.findFirst({
            where: {
              organizationId: context.organizationId,
              farmId,
              reversesFulfilmentId: original.id,
            },
          })
        )
          throw fault(
            'FULFILMENT_ALREADY_REVERSED',
            'Fulfilment has already been reversed',
          );
        const id = randomUUID();
        const occurredAt = new Date(input.occurredAt);
        await tx.fulfilment.create({
          data: {
            id,
            code: `FUL-${id}`,
            organizationId: context.organizationId,
            farmId,
            orderId: original.orderId,
            kind: 'REVERSAL',
            actorUserId: context.userId,
            occurredAt,
            reference: input.reference,
            reason: input.reason,
            postingErrorConfirmed: true,
            reversesFulfilmentId: original.id,
          },
        });
        for (const line of original.lines) {
          const movement =
            line.kind === 'PRODUCE'
              ? await this.stock.postMovementInTransaction(tx, context, {
                  farmId,
                  inventoryItemId: line.inventoryItemId!,
                  expectedInventoryUnit: line.unit,
                  quantity: line.quantity,
                  reason: 'ADJUSTMENT',
                  occurredAt,
                  note: input.reason,
                  reference: input.reference,
                })
              : null;
          const reversal = await tx.fulfilmentLine.create({
            data: {
              organizationId: context.organizationId,
              farmId,
              orderId: original.orderId,
              fulfilmentId: id,
              orderLineId: line.orderLineId,
              kind: line.kind,
              unit: line.unit,
              quantity: line.quantity,
              sourceCode: line.sourceCode,
              flockId: line.flockId,
              inventoryItemId: line.inventoryItemId,
              inventoryMovementId: movement?.id,
              reversesLineId: line.id,
              occurredAt,
            },
          });
          if (line.kind === 'POULTRY')
            await tx.flockSaleDepletion.create({
              data: {
                organizationId: context.organizationId,
                farmId,
                flockId: line.flockId!,
                fulfilmentLineId: reversal.id,
                birdCount: line.depletions[0]!.birdCount,
                actorUserId: context.userId,
                occurredAt,
                reversesDepletionId: line.depletions[0]!.id,
              },
            });
        }
        return this.seal(
          tx,
          context,
          farmId,
          original.orderId,
          id,
          'REVERSE',
          key,
          hash,
        );
      },
      { isolationLevel: 'ReadCommitted' },
    );
  }

  async list(
    context: OrganizationContext,
    farmId: string,
    query: FulfilmentQuery,
  ): Promise<FulfilmentListResponse> {
    return this.prisma.$transaction(
      async (tx) => {
        await this.authorize(tx, context, farmId, Permission.FULFILMENT_READ);
        const where = {
          organizationId: context.organizationId,
          farmId,
          orderId: query.orderId,
          kind: query.kind,
        };
        const records = await tx.fulfilment.findMany({
          where,
          include: eventInclude,
          orderBy: [
            { occurredAt: 'desc' },
            { createdAt: 'desc' },
            { id: 'desc' },
          ],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        });
        const totalItems = await tx.fulfilment.count({ where });
        return {
          data: records.map(projectEvent),
          meta: {
            page: query.page,
            pageSize: query.pageSize,
            totalItems,
            totalPages: Math.ceil(totalItems / query.pageSize),
          },
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }

  async get(
    context: OrganizationContext,
    farmId: string,
    id: string,
  ): Promise<Fulfilment> {
    return this.prisma.$transaction(
      async (tx) => {
        await this.authorize(tx, context, farmId, Permission.FULFILMENT_READ);
        const event = await this.event(tx, context, farmId, id);
        if (!event) throw missing();
        return projectEvent(event);
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }

  private async authorize(
    tx: Prisma.TransactionClient,
    context: OrganizationContext,
    farmId: string,
    permission: Permission,
  ) {
    const membership = await tx.organizationMembership.findFirst({
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
      !this.authorization.hasAllPermissions(membership.role, [
        Permission.ORDER_READ,
        permission,
      ])
    )
      throw forbidden();
    const farm = await tx.farm.findFirst({
      where: { AND: [this.farms.farmWhere(context), { id: farmId }] },
      select: { id: true },
    });
    if (!farm) throw forbidden();
  }

  private order(
    tx: Prisma.TransactionClient,
    context: OrganizationContext,
    id: string,
  ) {
    return tx.order.findFirst({
      where: { organizationId: context.organizationId, id },
      include: orderInclude,
    });
  }

  private event(
    tx: Prisma.TransactionClient,
    context: OrganizationContext,
    farmId: string,
    id: string,
  ) {
    return tx.fulfilment.findFirst({
      where: { organizationId: context.organizationId, farmId, id },
      include: eventInclude,
    });
  }

  private checkOrder(
    order: OrderRecord | null,
    version: number,
    reversal: boolean,
  ): asserts order is OrderRecord {
    if (!order) throw fault('ORDER_NOT_FOUND', 'Order was not found', 404);
    if (order.version !== version)
      throw fault(
        'ORDER_VERSION_CONFLICT',
        'Order changed; reload and retry your edit',
      );
    if (
      order.commercialState !== 'CONFIRMED' &&
      !(reversal && order.commercialState === 'CANCELLED')
    )
      throw fault(
        'ORDER_STATE_CONFLICT',
        'Order cannot make this state transition',
      );
  }

  private async replay(
    tx: Prisma.TransactionClient,
    context: OrganizationContext,
    farmId: string,
    operation: 'POST' | 'REVERSE',
    key: string,
    hash: string,
  ) {
    const command = await tx.fulfilmentCommand.findUnique({
      where: {
        organizationId_farmId_operation_key: {
          organizationId: context.organizationId,
          farmId,
          operation,
          key,
        },
      },
    });
    if (!command) return null;
    if (
      command.actorUserId !== context.userId ||
      command.hashVersion !== fulfilmentHashVersion ||
      command.requestHash !== hash
    )
      throw fault(
        'IDEMPOTENCY_CONFLICT',
        'Idempotency key is already bound to another command',
      );
    const event = await this.event(tx, context, farmId, command.fulfilmentId);
    if (!event) throw missing();
    return {
      status: command.responseStatus,
      receipt: {
        operation,
        idempotencyKey: key,
        orderVersion: command.orderVersion,
        fulfilment: projectEvent(event),
      } satisfies FulfilmentCommandReceipt,
    };
  }

  private async seal(
    tx: Prisma.TransactionClient,
    context: OrganizationContext,
    farmId: string,
    orderId: string,
    fulfilmentId: string,
    operation: 'POST' | 'REVERSE',
    key: string,
    hash: string,
  ) {
    const [order] = await tx.order.updateManyAndReturn({
      where: { id: orderId, organizationId: context.organizationId },
      data: { version: { increment: 1 } },
      select: { version: true },
    });
    // Receipt is deliberately the last write; its trigger seals the full batch.
    await tx.fulfilmentCommand.create({
      data: {
        organizationId: context.organizationId,
        farmId,
        orderId,
        operation,
        key,
        requestHash: hash,
        hashVersion: fulfilmentHashVersion,
        actorUserId: context.userId,
        fulfilmentId,
        orderVersion: order!.version,
        responseStatus: 201,
      },
    });
    const event = await this.event(tx, context, farmId, fulfilmentId);
    return {
      status: 201,
      receipt: {
        operation,
        idempotencyKey: key,
        orderVersion: order!.version,
        fulfilment: projectEvent(event!),
      } satisfies FulfilmentCommandReceipt,
    };
  }
}
