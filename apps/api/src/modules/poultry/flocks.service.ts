import { Injectable } from '@nestjs/common';
import type {
  Flock,
  FlockWithMetrics,
  FlockMetricsListResponse,
  MortalityListResponse,
  FeedUsageListResponse,
} from '@ancastle/types';
import {
  createFlockSchema,
  type CreateFlockInput,
  type UpdateFlockInput,
  type FlockApiQuery,
  type PoultryHistoryQuery,
} from '@ancastle/validation';
import { BusinessException } from '../../common/exceptions/business.exception.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { FarmAccessService } from '../authorization/farm-access.service.js';
import type { OrganizationContext } from '../authorization/organization-context.js';
import { FlockMetricsService } from './flock-metrics.service.js';
import { lockFlockMutation } from './flock-mutation-lock.js';
import { authorizedFlock, effectiveMortality } from './poultry-history.js';
import {
  flockDetails,
  metricDetails,
  mortalityDetails,
  feedDetails,
} from './poultry-response.js';

function meta(input: PoultryHistoryQuery, totalItems: number) {
  return {
    page: input.page,
    pageSize: input.pageSize,
    totalItems,
    totalPages: Math.ceil(totalItems / input.pageSize),
  };
}
const historyOrder = [
  { occurredAt: 'desc' },
  { createdAt: 'desc' },
  { id: 'desc' },
] as const;

/** Mirror M4-05's existing calendar-date boundaries before counting/paginating.
 * Lifecycle is independent: closed flocks may match any maturity state.
 */
function maturityWhere(input: FlockApiQuery): Prisma.FlockWhereInput {
  switch (input.maturityState) {
    case 'BEFORE_EXPECTED_MATURITY':
      return {
        expectedMaturityDate: { gt: new Date(input.ageAndMaturityAsOfDate) },
      };
    case 'AT_OR_PAST_EXPECTED_MATURITY':
      return {
        expectedMaturityDate: { lte: new Date(input.ageAndMaturityAsOfDate) },
      };
    case 'NO_EXPECTED_MATURITY_DATE':
      return { expectedMaturityDate: null };
    default:
      return {};
  }
}

@Injectable()
export class FlocksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly farms: FarmAccessService,
    private readonly metrics: FlockMetricsService,
  ) {}

  async list(
    context: OrganizationContext,
    farmId: string,
    input: FlockApiQuery,
  ): Promise<FlockMetricsListResponse> {
    await this.farms.resolve(context, farmId);
    const where: Prisma.FlockWhereInput = {
      organizationId: context.organizationId,
      farmId,
      farm: this.farms.farmWhere(context),
      ...maturityWhere(input),
      ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
      ...(input.birdType ? { birdType: input.birdType } : {}),
      ...(input.search
        ? {
            OR: ['code', 'name', 'birdType'].map((field) => ({
              [field]: { contains: input.search, mode: 'insensitive' },
            })),
          }
        : {}),
    };
    return this.prisma.$transaction(
      async (tx) => {
        const records = await tx.flock.findMany({
          where,
          skip: (input.page - 1) * input.pageSize,
          take: input.pageSize,
          orderBy: [{ code: 'asc' }, { id: 'asc' }],
        });
        const totalItems = await tx.flock.count({ where });
        const data: FlockWithMetrics[] = [];
        for (const record of records) {
          data.push({
            ...flockDetails(record),
            metrics: metricDetails(
              await this.metrics.get(
                context,
                farmId,
                record.id,
                input.ageAndMaturityAsOfDate,
                tx,
              ),
            ),
          });
        }
        return { data, meta: meta(input, totalItems) };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }

  async get(
    context: OrganizationContext,
    farmId: string,
    id: string,
    date: string,
  ): Promise<FlockWithMetrics> {
    return this.prisma.$transaction(
      async (tx) => {
        const record = await authorizedFlock(
          tx,
          this.farms,
          context,
          farmId,
          id,
        );
        return {
          ...flockDetails(record),
          metrics: metricDetails(
            await this.metrics.get(context, farmId, id, date, tx),
          ),
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }

  async create(
    context: OrganizationContext,
    farmId: string,
    input: CreateFlockInput,
  ): Promise<Flock> {
    await this.farms.resolve(context, farmId);
    return this.prisma.$transaction(async (tx) => {
      // Codes are organization-wide, matching the persisted uniqueness boundary.
      await tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "organizations" WHERE "id" = ${context.organizationId}::uuid FOR UPDATE`,
      );
      const latest = await tx.flock.findFirst({
        where: {
          organizationId: context.organizationId,
          code: { startsWith: 'FLK-' },
        },
        orderBy: { code: 'desc' },
        select: { code: true },
      });
      const match = latest ? /^FLK-(\d{6})$/.exec(latest.code) : undefined;
      if (latest && !match)
        throw new BusinessException(
          'FLOCK_CODE_GENERATION_FAILED',
          'Unable to generate the next flock code',
          500,
        );
      const next = latest ? Number(match![1]) + 1 : 1;
      if (next > 999999)
        throw new BusinessException(
          'FLOCK_CODE_LIMIT_REACHED',
          'Flock code limit has been reached',
          409,
        );
      return flockDetails(
        await tx.flock.create({
          data: {
            ...input,
            organizationId: context.organizationId,
            farmId,
            code: `FLK-${String(next).padStart(6, '0')}`,
            placementDate: new Date(input.placementDate),
            expectedMaturityDate: input.expectedMaturityDate
              ? new Date(input.expectedMaturityDate)
              : null,
          },
        }),
      );
    });
  }

  async update(
    context: OrganizationContext,
    farmId: string,
    id: string,
    input: UpdateFlockInput,
  ): Promise<Flock> {
    return this.prisma.$transaction(
      async (tx) => {
        // Share the mortality mutation lock before reading the baseline.
        // Concurrent definition edits also merge against the latest persisted dates.
        await lockFlockMutation(tx, context, farmId, id);
        const record = await authorizedFlock(
          tx,
          this.farms,
          context,
          farmId,
          id,
        );
        const placementDate =
          input.placementDate ??
          record.placementDate.toISOString().slice(0, 10);
        const expectedMaturityDate =
          input.expectedMaturityDate === undefined
            ? record.expectedMaturityDate?.toISOString().slice(0, 10)
            : input.expectedMaturityDate;
        new ZodValidationPipe(createFlockSchema).transform({
          name: input.name ?? record.name,
          startingBirdCount:
            input.startingBirdCount ?? record.startingBirdCount,
          placementDate,
          expectedMaturityDate: expectedMaturityDate ?? undefined,
        });
        if (
          input.startingBirdCount !== undefined &&
          input.startingBirdCount !== record.startingBirdCount
        ) {
          const mortality = await effectiveMortality(tx, {
            organizationId: context.organizationId,
            farmId,
            flockId: id,
          });
          if (mortality.gt(input.startingBirdCount))
            throw new BusinessException(
              'FLOCK_OVER_MORTALITY',
              'Starting population cannot be less than effective mortality',
            );
        }
        const [updated] = await tx.flock.updateManyAndReturn({
          where: {
            id,
            organizationId: context.organizationId,
            farmId,
            farm: this.farms.farmWhere(context),
          },
          data: {
            name: input.name,
            birdType: input.birdType,
            notes: input.notes,
            startingBirdCount: input.startingBirdCount,
            placementDate: new Date(placementDate),
            expectedMaturityDate: expectedMaturityDate
              ? new Date(expectedMaturityDate)
              : null,
          },
        });
        if (!updated)
          throw new BusinessException(
            'FLOCK_NOT_FOUND',
            'Flock was not found',
            404,
          );
        return flockDetails(updated);
      },
      { isolationLevel: 'ReadCommitted' },
    );
  }

  async setActive(
    context: OrganizationContext,
    farmId: string,
    id: string,
    isActive: boolean,
  ): Promise<Flock> {
    return this.prisma.$transaction(async (tx) => {
      await lockFlockMutation(tx, context, farmId, id);
      const record = await authorizedFlock(tx, this.farms, context, farmId, id);
      // Match M2 lifecycle conventions: repeating the requested state succeeds.
      if (record.isActive === isActive) return flockDetails(record);
      const [updated] = await tx.flock.updateManyAndReturn({
        where: {
          id,
          organizationId: context.organizationId,
          farmId,
          farm: this.farms.farmWhere(context),
        },
        data: { isActive },
      });
      if (!updated)
        throw new BusinessException(
          'FLOCK_NOT_FOUND',
          'Flock was not found',
          404,
        );
      return flockDetails(updated);
    });
  }

  async mortalityHistory(
    context: OrganizationContext,
    farmId: string,
    flockId: string,
    input: PoultryHistoryQuery,
  ): Promise<MortalityListResponse> {
    return this.prisma.$transaction(
      async (tx) => {
        await authorizedFlock(tx, this.farms, context, farmId, flockId);
        const where = {
          organizationId: context.organizationId,
          farmId,
          flockId,
        };
        const records = await tx.mortalityEvent.findMany({
          where,
          skip: (input.page - 1) * input.pageSize,
          take: input.pageSize,
          orderBy: [...historyOrder],
        });
        return {
          data: records.map(mortalityDetails),
          meta: meta(input, await tx.mortalityEvent.count({ where })),
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }

  async feedHistory(
    context: OrganizationContext,
    farmId: string,
    flockId: string,
    input: PoultryHistoryQuery,
  ): Promise<FeedUsageListResponse> {
    return this.prisma.$transaction(
      async (tx) => {
        await authorizedFlock(tx, this.farms, context, farmId, flockId);
        const where = {
          organizationId: context.organizationId,
          farmId,
          flockId,
        };
        const records = await tx.feedUsage.findMany({
          where,
          skip: (input.page - 1) * input.pageSize,
          take: input.pageSize,
          orderBy: [...historyOrder],
        });
        return {
          data: records.map(feedDetails),
          meta: meta(input, await tx.feedUsage.count({ where })),
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
}
