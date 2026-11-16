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

import type { CustomerListResponse, CustomerResponse } from '@ancastle/types';

import {
  createCustomerSchema,
  customerOrderHistoryQuerySchema,
  masterDataQuerySchema,
  resourceIdSchema,
  updateCustomerSchema,
  type CreateCustomerInput,
  type CustomerOrderHistoryQuery,
  type MasterDataQuery,
  type UpdateCustomerInput,
} from '@ancastle/validation';

import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { AuthGuard } from '../auth/auth.guard.js';
import { AuthorizationGuard } from '../authorization/authorization.guard.js';
import { CurrentOrganization } from '../authorization/current-organization.decorator.js';
import { OrganizationContext } from '../authorization/organization-context.js';
import {
  OrganizationParam,
  RequirePermissions,
} from '../authorization/require-permissions.decorator.js';
import { CustomersService } from './customers.service.js';
import { Permission } from '../authorization/permissions.js';
import { SalesOrdersService } from '../sales-orders/sales-orders.service.js';

@Controller('organizations/:organizationId/customers')
@UseGuards(AuthGuard, AuthorizationGuard)
@OrganizationParam()
export class CustomersController {
  constructor(
    private readonly customers: CustomersService,
    private readonly orders: SalesOrdersService,
  ) {}

  @Get()
  @RequirePermissions(Permission.CUSTOMER_READ)
  list(
    @CurrentOrganization() context: OrganizationContext,
    @Query(new ZodValidationPipe(masterDataQuerySchema))
    query: MasterDataQuery,
  ): Promise<CustomerListResponse> {
    return this.customers.list(context, query);
  }

  @Get(':customerId/orders')
  @RequirePermissions(Permission.ORDER_READ)
  orderHistory(
    @CurrentOrganization() context: OrganizationContext,
    @Param('customerId', new ZodValidationPipe(resourceIdSchema))
    customerId: string,
    @Query(new ZodValidationPipe(customerOrderHistoryQuerySchema))
    query: CustomerOrderHistoryQuery,
  ) {
    return this.orders.customerHistory(context, customerId, query);
  }

  @Post()
  @RequirePermissions(Permission.CUSTOMER_CREATE)
  async create(
    @CurrentOrganization() context: OrganizationContext,
    @Body(new ZodValidationPipe(createCustomerSchema))
    input: CreateCustomerInput,
  ): Promise<CustomerResponse> {
    return {
      data: await this.customers.create(context, input),
    };
  }

  @Get(':customerId')
  @RequirePermissions(Permission.CUSTOMER_READ)
  async get(
    @CurrentOrganization() context: OrganizationContext,
    @Param('customerId', new ZodValidationPipe(resourceIdSchema))
    id: string,
  ): Promise<CustomerResponse> {
    return {
      data: await this.customers.get(context, id),
    };
  }

  @Patch(':customerId')
  @RequirePermissions(Permission.CUSTOMER_UPDATE)
  async update(
    @CurrentOrganization() context: OrganizationContext,
    @Param('customerId', new ZodValidationPipe(resourceIdSchema))
    id: string,
    @Body(new ZodValidationPipe(updateCustomerSchema))
    input: UpdateCustomerInput,
  ): Promise<CustomerResponse> {
    return {
      data: await this.customers.update(context, id, input),
    };
  }

  @Post(':customerId/deactivate')
  @RequirePermissions(Permission.CUSTOMER_DEACTIVATE)
  async deactivate(
    @CurrentOrganization() context: OrganizationContext,
    @Param('customerId', new ZodValidationPipe(resourceIdSchema))
    id: string,
  ): Promise<CustomerResponse> {
    return {
      data: await this.customers.deactivate(context, id),
    };
  }

  @Post(':customerId/reactivate')
  @RequirePermissions(Permission.CUSTOMER_DEACTIVATE)
  async reactivate(
    @CurrentOrganization() context: OrganizationContext,
    @Param('customerId', new ZodValidationPipe(resourceIdSchema))
    id: string,
  ): Promise<CustomerResponse> {
    return {
      data: await this.customers.reactivate(context, id),
    };
  }
}
