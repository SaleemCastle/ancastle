import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type {
  FlockResponse,
  FlockDetailResponse,
  FlockMetricsListResponse,
  MortalityResponse,
  MortalityListResponse,
  FeedUsageResponse,
  FeedUsageListResponse,
} from '@ancastle/types';
import {
  createFlockSchema,
  updateFlockSchema,
  flockApiQuerySchema,
  flockMetricsQuerySchema,
  flockLifecycleSchema,
  poultryHistoryQuerySchema,
  postMortalitySchema,
  postFeedUsageSchema,
  resourceIdSchema,
  type CreateFlockInput,
  type UpdateFlockInput,
  type FlockApiQuery,
  type FlockMetricsQuery,
  type PoultryHistoryQuery,
  type PostMortalityInput,
  type PostFeedUsageInput,
} from '@ancastle/validation';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { Prisma } from '../../generated/prisma/client.js';
import { AuthGuard } from '../auth/auth.guard.js';
import { AuthorizationGuard } from '../authorization/authorization.guard.js';
import { FarmAccessGuard } from '../authorization/farm-access.guard.js';
import { CurrentOrganization } from '../authorization/current-organization.decorator.js';
import { CurrentFarm } from '../authorization/current-farm.decorator.js';
import type { OrganizationContext } from '../authorization/organization-context.js';
import type { FarmContext } from '../authorization/farm-context.js';
import {
  OrganizationParam,
  RequirePermissions,
} from '../authorization/require-permissions.decorator.js';
import { FarmParam } from '../authorization/farm-param.decorator.js';
import { Permission } from '../authorization/permissions.js';
import { FlocksService } from './flocks.service.js';
import { MortalityService } from './mortality.service.js';
import { FeedUsageService } from './feed-usage.service.js';
import { mortalityDetails, feedDetails } from './poultry-response.js';

@Controller('organizations/:organizationId/farms/:farmId/flocks')
@UseGuards(AuthGuard, AuthorizationGuard, FarmAccessGuard)
@OrganizationParam()
@FarmParam()
export class FlocksController {
  constructor(
    private readonly flocks: FlocksService,
    private readonly mortality: MortalityService,
    private readonly feed: FeedUsageService,
  ) {}

  @Get()
  @RequirePermissions(Permission.FLOCK_READ)
  list(
    @CurrentOrganization() context: OrganizationContext,
    @CurrentFarm() farm: FarmContext,
    @Query(new ZodValidationPipe(flockApiQuerySchema)) query: FlockApiQuery,
  ): Promise<FlockMetricsListResponse> {
    return this.flocks.list(context, farm.farmId, query);
  }

  @Post()
  @RequirePermissions(Permission.FLOCK_MANAGE)
  async create(
    @CurrentOrganization() context: OrganizationContext,
    @CurrentFarm() farm: FarmContext,
    @Body(new ZodValidationPipe(createFlockSchema)) input: CreateFlockInput,
  ): Promise<FlockResponse> {
    return { data: await this.flocks.create(context, farm.farmId, input) };
  }

  @Get(':flockId')
  @RequirePermissions(Permission.FLOCK_READ)
  async get(
    @CurrentOrganization() context: OrganizationContext,
    @CurrentFarm() farm: FarmContext,
    @Param('flockId', new ZodValidationPipe(resourceIdSchema)) id: string,
    @Query(new ZodValidationPipe(flockMetricsQuerySchema))
    query: FlockMetricsQuery,
  ): Promise<FlockDetailResponse> {
    return {
      data: await this.flocks.get(
        context,
        farm.farmId,
        id,
        query.ageAndMaturityAsOfDate,
      ),
    };
  }

  @Patch(':flockId')
  @RequirePermissions(Permission.FLOCK_MANAGE)
  async update(
    @CurrentOrganization() context: OrganizationContext,
    @CurrentFarm() farm: FarmContext,
    @Param('flockId', new ZodValidationPipe(resourceIdSchema)) id: string,
    @Body(new ZodValidationPipe(updateFlockSchema)) input: UpdateFlockInput,
  ): Promise<FlockResponse> {
    return { data: await this.flocks.update(context, farm.farmId, id, input) };
  }

  @Post(':flockId/close')
  @RequirePermissions(Permission.FLOCK_MANAGE)
  async close(
    @CurrentOrganization() context: OrganizationContext,
    @CurrentFarm() farm: FarmContext,
    @Param('flockId', new ZodValidationPipe(resourceIdSchema)) id: string,
    @Body(new ZodValidationPipe(flockLifecycleSchema))
    _input: Record<string, never>,
  ): Promise<FlockResponse> {
    return {
      data: await this.flocks.setActive(context, farm.farmId, id, false),
    };
  }

  @Post(':flockId/reactivate')
  @RequirePermissions(Permission.FLOCK_MANAGE)
  async reactivate(
    @CurrentOrganization() context: OrganizationContext,
    @CurrentFarm() farm: FarmContext,
    @Param('flockId', new ZodValidationPipe(resourceIdSchema)) id: string,
    @Body(new ZodValidationPipe(flockLifecycleSchema))
    _input: Record<string, never>,
  ): Promise<FlockResponse> {
    return {
      data: await this.flocks.setActive(context, farm.farmId, id, true),
    };
  }

  @Get(':flockId/mortality')
  @RequirePermissions(Permission.FLOCK_READ)
  mortalityHistory(
    @CurrentOrganization() context: OrganizationContext,
    @CurrentFarm() farm: FarmContext,
    @Param('flockId', new ZodValidationPipe(resourceIdSchema)) id: string,
    @Query(new ZodValidationPipe(poultryHistoryQuerySchema))
    query: PoultryHistoryQuery,
  ): Promise<MortalityListResponse> {
    return this.flocks.mortalityHistory(context, farm.farmId, id, query);
  }

  @Post(':flockId/mortality')
  @RequirePermissions(Permission.FLOCK_MORTALITY_POST)
  async postMortality(
    @CurrentOrganization() context: OrganizationContext,
    @CurrentFarm() farm: FarmContext,
    @Param('flockId', new ZodValidationPipe(resourceIdSchema)) id: string,
    @Body(new ZodValidationPipe(postMortalitySchema)) input: PostMortalityInput,
  ): Promise<MortalityResponse> {
    return {
      data: mortalityDetails(
        await this.mortality.post(context, farm.farmId, {
          ...input,
          flockId: id,
        }),
      ),
    };
  }

  @Get(':flockId/feed-usage')
  @RequirePermissions(Permission.FLOCK_READ)
  feedHistory(
    @CurrentOrganization() context: OrganizationContext,
    @CurrentFarm() farm: FarmContext,
    @Param('flockId', new ZodValidationPipe(resourceIdSchema)) id: string,
    @Query(new ZodValidationPipe(poultryHistoryQuerySchema))
    query: PoultryHistoryQuery,
  ): Promise<FeedUsageListResponse> {
    return this.flocks.feedHistory(context, farm.farmId, id, query);
  }

  @Post(':flockId/feed-usage')
  @RequirePermissions(Permission.FLOCK_FEED_USAGE_POST)
  async postFeed(
    @CurrentOrganization() context: OrganizationContext,
    @CurrentFarm() farm: FarmContext,
    @Param('flockId', new ZodValidationPipe(resourceIdSchema)) id: string,
    @Body(new ZodValidationPipe(postFeedUsageSchema)) input: PostFeedUsageInput,
  ): Promise<FeedUsageResponse> {
    return {
      data: feedDetails(
        await this.feed.post(context, farm.farmId, {
          ...input,
          quantity: new Prisma.Decimal(input.quantity),
          flockId: id,
        }),
      ),
    };
  }
}
