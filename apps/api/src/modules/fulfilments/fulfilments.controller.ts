import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  fulfilmentQuerySchema,
  postFulfilmentSchema,
  resourceIdSchema,
  reverseFulfilmentSchema,
  type FulfilmentQuery,
  type PostFulfilmentInput,
  type ReverseFulfilmentInput,
} from '@ancastle/validation';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { AuthGuard } from '../auth/auth.guard.js';
import { AuthorizationGuard } from '../authorization/authorization.guard.js';
import { CurrentFarm } from '../authorization/current-farm.decorator.js';
import { CurrentOrganization } from '../authorization/current-organization.decorator.js';
import { FarmAccessGuard } from '../authorization/farm-access.guard.js';
import type { FarmContext } from '../authorization/farm-context.js';
import { FarmParam } from '../authorization/farm-param.decorator.js';
import type { OrganizationContext } from '../authorization/organization-context.js';
import { Permission } from '../authorization/permissions.js';
import {
  OrganizationParam,
  RequirePermissions,
} from '../authorization/require-permissions.decorator.js';
import { FulfilmentActivationService } from './fulfilment-activation.service.js';
import { FulfilmentsService } from './fulfilments.service.js';

@Controller('organizations/:organizationId/farms/:farmId')
@UseGuards(AuthGuard, AuthorizationGuard, FarmAccessGuard)
@OrganizationParam()
@FarmParam()
export class FulfilmentsController {
  constructor(
    private readonly fulfilments: FulfilmentsService,
    private readonly activation: FulfilmentActivationService,
  ) {}

  @Post('orders/:orderId/fulfilments')
  @RequirePermissions(Permission.ORDER_READ, Permission.FULFILMENT_POST)
  async post(
    @CurrentOrganization() context: OrganizationContext,
    @CurrentFarm() farm: FarmContext,
    @Param('orderId', new ZodValidationPipe(resourceIdSchema)) orderId: string,
    @Headers('idempotency-key') key: string,
    @Body(new ZodValidationPipe(postFulfilmentSchema))
    input: PostFulfilmentInput,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.activation.assertEnabled();
    const result = await this.fulfilments.post(
      context,
      farm.farmId,
      orderId,
      key,
      input,
    );
    response.status(result.status);
    return { data: result.receipt };
  }

  @Post('fulfilments/:fulfilmentId/reverse')
  @RequirePermissions(Permission.ORDER_READ, Permission.FULFILMENT_REVERSE)
  async reverse(
    @CurrentOrganization() context: OrganizationContext,
    @CurrentFarm() farm: FarmContext,
    @Param('fulfilmentId', new ZodValidationPipe(resourceIdSchema)) id: string,
    @Headers('idempotency-key') key: string,
    @Body(new ZodValidationPipe(reverseFulfilmentSchema))
    input: ReverseFulfilmentInput,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.activation.assertEnabled();
    const result = await this.fulfilments.reverse(
      context,
      farm.farmId,
      id,
      key,
      input,
    );
    response.status(result.status);
    return { data: result.receipt };
  }

  @Get('fulfilments')
  @RequirePermissions(Permission.ORDER_READ, Permission.FULFILMENT_READ)
  list(
    @CurrentOrganization() context: OrganizationContext,
    @CurrentFarm() farm: FarmContext,
    @Query(new ZodValidationPipe(fulfilmentQuerySchema)) query: FulfilmentQuery,
  ) {
    return this.fulfilments.list(context, farm.farmId, query);
  }

  @Get('fulfilments/:fulfilmentId')
  @RequirePermissions(Permission.ORDER_READ, Permission.FULFILMENT_READ)
  async get(
    @CurrentOrganization() context: OrganizationContext,
    @CurrentFarm() farm: FarmContext,
    @Param('fulfilmentId', new ZodValidationPipe(resourceIdSchema)) id: string,
  ) {
    return { data: await this.fulfilments.get(context, farm.farmId, id) };
  }
}
