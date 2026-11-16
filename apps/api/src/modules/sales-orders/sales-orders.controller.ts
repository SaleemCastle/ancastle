import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  amendOrderSchema,
  cancelOrderSchema,
  confirmOrderSchema,
  createOrderSchema,
  orderQuerySchema,
  paginationQuerySchema,
  resourceIdSchema,
  type AmendOrderInput,
  type CancelOrderInput,
  type ConfirmOrderInput,
  type CreateOrderInput,
  type OrderEventQuery,
  type OrderQuery,
} from '@ancastle/validation';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { AuthGuard } from '../auth/auth.guard.js';
import { AuthorizationGuard } from '../authorization/authorization.guard.js';
import { CurrentOrganization } from '../authorization/current-organization.decorator.js';
import type { OrganizationContext } from '../authorization/organization-context.js';
import {
  OrganizationParam,
  RequirePermissions,
} from '../authorization/require-permissions.decorator.js';
import { Permission } from '../authorization/permissions.js';
import { SalesOrdersService } from './sales-orders.service.js';

@Controller('organizations/:organizationId/orders')
@UseGuards(AuthGuard, AuthorizationGuard)
@OrganizationParam()
export class SalesOrdersController {
  constructor(private readonly orders: SalesOrdersService) {}

  @Get()
  @RequirePermissions(Permission.ORDER_READ)
  list(
    @CurrentOrganization() context: OrganizationContext,
    @Query(new ZodValidationPipe(orderQuerySchema)) query: OrderQuery,
  ) {
    return this.orders.list(context, query);
  }

  @Post()
  @RequirePermissions(Permission.ORDER_MANAGE)
  async create(
    @CurrentOrganization() context: OrganizationContext,
    @Body(new ZodValidationPipe(createOrderSchema)) input: CreateOrderInput,
  ) {
    return { data: await this.orders.create(context, input) };
  }

  @Get(':orderId/events')
  @RequirePermissions(Permission.ORDER_READ)
  events(
    @CurrentOrganization() context: OrganizationContext,
    @Param('orderId', new ZodValidationPipe(resourceIdSchema)) orderId: string,
    @Query(new ZodValidationPipe(paginationQuerySchema)) query: OrderEventQuery,
  ) {
    return this.orders.events(context, orderId, query);
  }

  @Get(':orderId')
  @RequirePermissions(Permission.ORDER_READ)
  async get(
    @CurrentOrganization() context: OrganizationContext,
    @Param('orderId', new ZodValidationPipe(resourceIdSchema)) orderId: string,
  ) {
    return { data: await this.orders.get(context, orderId) };
  }

  @Patch(':orderId')
  @RequirePermissions(Permission.ORDER_MANAGE)
  async amend(
    @CurrentOrganization() context: OrganizationContext,
    @Param('orderId', new ZodValidationPipe(resourceIdSchema)) orderId: string,
    @Body(new ZodValidationPipe(amendOrderSchema)) input: AmendOrderInput,
  ) {
    return { data: await this.orders.amend(context, orderId, input) };
  }

  @Post(':orderId/confirm')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.ORDER_CONFIRM)
  async confirm(
    @CurrentOrganization() context: OrganizationContext,
    @Param('orderId', new ZodValidationPipe(resourceIdSchema)) orderId: string,
    @Body(new ZodValidationPipe(confirmOrderSchema)) input: ConfirmOrderInput,
  ) {
    return { data: await this.orders.confirm(context, orderId, input) };
  }

  @Post(':orderId/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.ORDER_CANCEL)
  async cancel(
    @CurrentOrganization() context: OrganizationContext,
    @Param('orderId', new ZodValidationPipe(resourceIdSchema)) orderId: string,
    @Body(new ZodValidationPipe(cancelOrderSchema)) input: CancelOrderInput,
  ) {
    return { data: await this.orders.cancel(context, orderId, input) };
  }
}
