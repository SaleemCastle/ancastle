import { Injectable } from '@nestjs/common';
import type { SalesProduct, PoultryProductSource } from '@ancastle/types';
import type {
  CreateSalesProductInput,
  UpdateSalesProductInput,
  SalesProductQuery,
  PoultryProductSourceQuery,
} from '@ancastle/validation';
import { BusinessException } from '../../common/exceptions/business.exception.js';
import { PrismaService } from '../../database/prisma.service.js';
import { lockMutation } from '../../database/mutation-locks.js';
import { Prisma } from '../../generated/prisma/client.js';
import type { OrganizationContext } from '../authorization/organization-context.js';
import { FarmAccessService } from '../authorization/farm-access.service.js';
import { AuthorizationService } from '../authorization/authorization.service.js';
import { Permission } from '../authorization/permissions.js';

const productSelect = {
  id: true,
  code: true,
  name: true,
  kind: true,
  unit: true,
  inventoryItemId: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.SalesProductSelect;
type ProductRecord = Prisma.SalesProductGetPayload<{
  select: typeof productSelect;
}>;
const sourceSelect = {
  id: true,
  productId: true,
  farmId: true,
  flockId: true,
  actorUserId: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  product: { select: { isActive: true } },
  flock: { select: { code: true, name: true, isActive: true } },
} satisfies Prisma.PoultryProductSourceSelect;
type SourceRecord = Prisma.PoultryProductSourceGetPayload<{
  select: typeof sourceSelect;
}>;
function productDetails(row: ProductRecord): SalesProduct {
  const common = {
    id: row.id,
    code: row.code,
    name: row.name,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
  return row.kind === 'POULTRY'
    ? { ...common, kind: 'POULTRY', unit: 'EACH' }
    : {
        ...common,
        kind: 'PRODUCE',
        unit: row.unit,
        inventoryItemId: row.inventoryItemId!,
      };
}
function sourceDetails(row: SourceRecord): PoultryProductSource {
  const { product, flock, createdAt, updatedAt, ...identity } = row;
  return {
    ...identity,
    flockCode: flock.code,
    flockName: flock.name,
    flockIsActive: flock.isActive,
    productIsActive: product.isActive,
    isEligible: row.isActive && product.isActive && flock.isActive,
    createdAt: createdAt.toISOString(),
    updatedAt: updatedAt.toISOString(),
  };
}
const meta = (
  input: { page: number; pageSize: number },
  totalItems: number,
) => ({
  ...input,
  totalItems,
  totalPages: Math.ceil(totalItems / input.pageSize),
});
const fault = (code: string, message: string, status = 409) =>
  new BusinessException(code, message, status);
const productMissing = () =>
  fault('SALES_PRODUCT_NOT_FOUND', 'Sales product is unavailable', 404);

@Injectable()
export class SalesCatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly farms: FarmAccessService,
    private readonly authorization: AuthorizationService,
  ) {}

  async listProducts(context: OrganizationContext, input: SalesProductQuery) {
    const where: Prisma.SalesProductWhereInput = {
      organizationId: context.organizationId,
      kind: input.kind,
      isActive: input.isActive,
      ...(input.search
        ? {
            OR: ['code', 'name'].map((field) => ({
              [field]: { contains: input.search, mode: 'insensitive' },
            })),
          }
        : {}),
    };
    const [rows, count] = await this.prisma.$transaction(
      [
        this.prisma.salesProduct.findMany({
          where,
          select: productSelect,
          skip: (input.page - 1) * input.pageSize,
          take: input.pageSize,
          orderBy: [{ code: 'asc' }, { id: 'asc' }],
        }),
        this.prisma.salesProduct.count({ where }),
      ],
      { isolationLevel: 'RepeatableRead' },
    );
    return {
      data: rows.map(productDetails),
      meta: meta({ page: input.page, pageSize: input.pageSize }, count),
    };
  }

  async getProduct(context: OrganizationContext, id: string) {
    return productDetails(await this.product(this.prisma, context, id));
  }

  async createProduct(
    context: OrganizationContext,
    input: CreateSalesProductInput,
  ) {
    return this.prisma.$transaction(
      async (tx) => {
        await lockMutation(tx, context, {
          parent: 'UPDATE',
          definitions: {
            inventory_items:
              input.kind === 'PRODUCE' ? [{ id: input.inventoryItemId }] : [],
          },
        });
        const definition = await this.definition(tx, context, input);
        const latest = await tx.salesProduct.findFirst({
          where: {
            organizationId: context.organizationId,
            code: { startsWith: 'PRD-' },
          },
          select: { code: true },
          orderBy: { code: 'desc' },
        });
        const match = latest ? /^PRD-(\d{6})$/.exec(latest.code) : undefined;
        if (latest && !match)
          throw fault(
            'SALES_PRODUCT_CODE_GENERATION_FAILED',
            'Product code could not be generated',
            500,
          );
        const next = latest ? Number(match![1]) + 1 : 1;
        if (next > 999999)
          throw fault(
            'SALES_PRODUCT_CODE_LIMIT_REACHED',
            'No additional product codes are available',
          );
        return productDetails(
          await tx.salesProduct.create({
            data: {
              organizationId: context.organizationId,
              code: `PRD-${String(next).padStart(6, '0')}`,
              name: input.name,
              ...definition,
            },
            select: productSelect,
          }),
        );
      },
      { isolationLevel: 'ReadCommitted' },
    );
  }

  async updateProduct(
    context: OrganizationContext,
    id: string,
    input: UpdateSalesProductInput,
  ) {
    return this.prisma.$transaction(
      async (tx) => {
        const current = await this.lockProduct(
          tx,
          context,
          id,
          input.definition?.kind === 'PRODUCE'
            ? input.definition.inventoryItemId
            : undefined,
        );
        const definition = input.definition
          ? await this.definition(tx, context, input.definition)
          : undefined;
        if (
          definition &&
          (definition.kind !== current.kind ||
            definition.unit !== current.unit ||
            definition.inventoryItemId !== current.inventoryItemId)
        ) {
          const [line, source] = await Promise.all([
            tx.orderLine.findFirst({
              where: {
                organizationId: context.organizationId,
                productId: id,
                order: { commercialState: { not: 'DRAFT' } },
              },
              select: { id: true },
            }),
            tx.poultryProductSource.findFirst({
              where: { organizationId: context.organizationId, productId: id },
              select: { id: true },
            }),
          ]);
          if (line || source)
            throw fault(
              'SALES_PRODUCT_DEFINITION_FROZEN',
              'Referenced product identity cannot be changed',
            );
        }
        return productDetails(
          await tx.salesProduct.update({
            where: {
              organizationId_id: { organizationId: context.organizationId, id },
            },
            data: { name: input.name, ...definition },
            select: productSelect,
          }),
        );
      },
      { isolationLevel: 'ReadCommitted' },
    );
  }

  async setProductActive(
    context: OrganizationContext,
    id: string,
    isActive: boolean,
  ) {
    return this.prisma.$transaction(
      async (tx) => {
        const current = await this.lockProduct(tx, context, id);
        if (isActive && current.kind === 'PRODUCE')
          await this.definition(tx, context, {
            kind: 'PRODUCE',
            inventoryItemId: current.inventoryItemId!,
            expectedInventoryUnit: current.unit,
          });
        return productDetails(
          await tx.salesProduct.update({
            where: {
              organizationId_id: { organizationId: context.organizationId, id },
            },
            data: { isActive },
            select: productSelect,
          }),
        );
      },
      { isolationLevel: 'ReadCommitted' },
    );
  }

  async listSources(
    context: OrganizationContext,
    farmId: string,
    productId: string,
    input: PoultryProductSourceQuery,
  ) {
    return this.prisma.$transaction(
      async (tx) => {
        await this.verifyFarm(tx, context, farmId);
        this.poultry(await this.product(tx, context, productId));
        const where = {
          organizationId: context.organizationId,
          farmId,
          productId,
          isActive: input.isActive,
        };
        const [rows, count] = await Promise.all([
          tx.poultryProductSource.findMany({
            where,
            select: sourceSelect,
            skip: (input.page - 1) * input.pageSize,
            take: input.pageSize,
            orderBy: [{ flock: { code: 'asc' } }, { id: 'asc' }],
          }),
          tx.poultryProductSource.count({ where }),
        ]);
        return {
          data: rows.map(sourceDetails),
          meta: meta({ page: input.page, pageSize: input.pageSize }, count),
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }

  async attachSource(
    context: OrganizationContext,
    farmId: string,
    productId: string,
    flockId: string,
  ) {
    return this.prisma.$transaction(
      async (tx) => {
        await lockMutation(tx, context, {
          definitions: { sales_products: [{ id: productId }] },
          flocks: [{ farmId, flockId }],
        });
        await this.verifyFarm(tx, context, farmId);
        const product = await this.product(tx, context, productId);
        this.poultry(product);
        const flock = await this.flock(tx, context, farmId, flockId);
        const existing = await tx.poultryProductSource.findFirst({
          where: {
            organizationId: context.organizationId,
            farmId,
            productId,
            flockId,
          },
          select: sourceSelect,
        });
        if (existing) {
          if (!existing.isActive)
            throw fault(
              'POULTRY_SOURCE_INACTIVE',
              'Reactivate the existing source eligibility explicitly',
            );
          return sourceDetails(existing);
        }
        if (!product.isActive || !flock.isActive)
          throw fault(
            'POULTRY_SOURCE_INELIGIBLE',
            'An active poultry product and active flock are required',
          );
        return sourceDetails(
          await tx.poultryProductSource.create({
            data: {
              organizationId: context.organizationId,
              farmId,
              productId,
              flockId,
              actorUserId: context.userId,
            },
            select: sourceSelect,
          }),
        );
      },
      { isolationLevel: 'ReadCommitted' },
    );
  }

  async setSourceActive(
    context: OrganizationContext,
    farmId: string,
    productId: string,
    id: string,
    isActive: boolean,
  ) {
    return this.prisma.$transaction(
      async (tx) => {
        const where = {
          id,
          organizationId: context.organizationId,
          farmId,
          productId,
        };
        // Immutable identity discovery only; lifecycle/eligibility is re-read under the full prefix.
        const discovered = await tx.poultryProductSource.findFirst({
          where,
          select: { flockId: true },
        });
        if (!discovered)
          throw fault(
            'POULTRY_SOURCE_NOT_FOUND',
            'Source eligibility is unavailable',
            404,
          );
        await lockMutation(tx, context, {
          definitions: {
            sales_products: [{ id: productId }],
            poultry_product_sources: [{ id, mode: 'UPDATE' }],
          },
          flocks: [{ farmId, flockId: discovered.flockId }],
        });
        await this.verifyFarm(tx, context, farmId);
        const product = await this.product(tx, context, productId);
        this.poultry(product);
        const flock = await this.flock(tx, context, farmId, discovered.flockId);
        const current = await tx.poultryProductSource.findFirst({
          where,
          select: sourceSelect,
        });
        if (!current)
          throw fault(
            'POULTRY_SOURCE_NOT_FOUND',
            'Source eligibility is unavailable',
            404,
          );
        if (current.isActive === isActive) return sourceDetails(current);
        if (isActive && (!product.isActive || !flock.isActive))
          throw fault(
            'POULTRY_SOURCE_INELIGIBLE',
            'An active poultry product and active flock are required',
          );
        return sourceDetails(
          await tx.poultryProductSource.update({
            where: {
              id: current.id,
              organizationId: context.organizationId,
              farmId,
              productId,
            },
            data: { isActive },
            select: sourceSelect,
          }),
        );
      },
      { isolationLevel: 'ReadCommitted' },
    );
  }

  private async product(
    tx: Prisma.TransactionClient,
    context: OrganizationContext,
    id: string,
  ) {
    const row = await tx.salesProduct.findFirst({
      where: { id, organizationId: context.organizationId },
      select: productSelect,
    });
    if (!row) throw productMissing();
    return row;
  }
  private async lockProduct(
    tx: Prisma.TransactionClient,
    context: OrganizationContext,
    id: string,
    nextItemId?: string,
  ) {
    const before = await this.product(tx, context, id);
    await lockMutation(tx, context, {
      definitions: {
        sales_products: [{ id, mode: 'UPDATE' }],
        inventory_items: [before.inventoryItemId, nextItemId]
          .filter((value): value is string => !!value)
          .map((itemId) => ({ id: itemId })),
      },
    });
    const current = await this.product(tx, context, id);
    if (
      current.kind !== before.kind ||
      current.unit !== before.unit ||
      current.inventoryItemId !== before.inventoryItemId
    )
      throw fault(
        'CONCURRENT_UPDATE',
        'Product definition changed; reload and review before retrying',
      );
    return current;
  }
  private async definition(
    tx: Prisma.TransactionClient,
    context: OrganizationContext,
    input:
      | CreateSalesProductInput
      | NonNullable<UpdateSalesProductInput['definition']>,
  ) {
    if (input.kind === 'POULTRY')
      return {
        kind: 'POULTRY' as const,
        unit: 'EACH' as const,
        inventoryItemId: null,
      };
    if (
      !this.authorization.hasPermission(context.role, Permission.INVENTORY_READ)
    )
      throw fault(
        'FORBIDDEN',
        'You do not have permission to perform this action',
        403,
      );
    const item = await tx.inventoryItem.findFirst({
      where: {
        organizationId: context.organizationId,
        id: input.inventoryItemId,
        category: 'PRODUCE',
        isActive: true,
      },
      select: { id: true, unit: true },
    });
    if (!item)
      throw fault(
        'SALES_PRODUCE_SOURCE_INELIGIBLE',
        'An active produce inventory item in this organization is required',
      );
    if (item.unit !== input.expectedInventoryUnit)
      throw fault(
        'INVENTORY_DEFINITION_CHANGED',
        'Inventory unit changed; reload and review before linking',
      );
    return {
      kind: 'PRODUCE' as const,
      unit: item.unit,
      inventoryItemId: item.id,
    };
  }
  private poultry(product: ProductRecord) {
    if (product.kind !== 'POULTRY')
      throw fault(
        'SALES_PRODUCT_KIND_MISMATCH',
        'Poultry source eligibility requires a poultry product',
      );
  }
  private async verifyFarm(
    tx: Prisma.TransactionClient,
    context: OrganizationContext,
    id: string,
  ) {
    if (
      !(await tx.farm.findFirst({
        where: { AND: [this.farms.farmWhere(context), { id }] },
        select: { id: true },
      }))
    )
      throw fault(
        'FORBIDDEN',
        'You do not have permission to perform this action',
        403,
      );
  }
  private async flock(
    tx: Prisma.TransactionClient,
    context: OrganizationContext,
    farmId: string,
    id: string,
  ) {
    const row = await tx.flock.findFirst({
      where: { id, organizationId: context.organizationId, farmId },
      select: { id: true, isActive: true },
    });
    if (!row)
      throw fault(
        'POULTRY_SOURCE_NOT_FOUND',
        'Source eligibility is unavailable',
        404,
      );
    return row;
  }
}
