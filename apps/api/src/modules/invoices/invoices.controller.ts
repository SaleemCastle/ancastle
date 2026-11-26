import {
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import {
  invoiceQuerySchema,
  resourceIdSchema,
  type InvoiceQuery,
} from '@ancastle/validation';
import { AuthGuard } from '../auth/auth.guard.js';
import { AuthorizationGuard } from '../authorization/authorization.guard.js';
import { CurrentOrganization } from '../authorization/current-organization.decorator.js';
import type { OrganizationContext } from '../authorization/organization-context.js';
import {
  OrganizationParam,
  RequirePermissions,
} from '../authorization/require-permissions.decorator.js';
import { Permission } from '../authorization/permissions.js';
import { CurrentFarm } from '../authorization/current-farm.decorator.js';
import { FarmAccessGuard } from '../authorization/farm-access.guard.js';
import { FarmParam } from '../authorization/farm-param.decorator.js';
import type { FarmContext } from '../authorization/farm-context.js';
import { InvoicesService } from './invoices.service.js';

@Controller('organizations/:organizationId/invoices')
@UseGuards(AuthGuard, AuthorizationGuard)
@OrganizationParam()
export class InvoicesController {
  constructor(private readonly invoices: InvoicesService) {}

  @Get()
  @RequirePermissions(Permission.INVOICE_READ)
  list(
    @CurrentOrganization() context: OrganizationContext,
    @Query(new ZodValidationPipe(invoiceQuerySchema)) query: InvoiceQuery,
  ) {
    return this.invoices.list(context, query);
  }

  @Get('customers')
  @RequirePermissions(Permission.INVOICE_READ)
  customers(@CurrentOrganization() context: OrganizationContext) {
    return this.invoices.customers(context);
  }

  @Get('issuance-status')
  @RequirePermissions(Permission.INVOICE_ISSUE)
  issuanceStatus() {
    return { data: this.invoices.issuanceStatus() };
  }

  @Get(':invoiceId')
  @RequirePermissions(Permission.INVOICE_READ)
  async get(
    @CurrentOrganization() context: OrganizationContext,
    @Param('invoiceId', new ZodValidationPipe(resourceIdSchema)) id: string,
  ) {
    return { data: await this.invoices.get(context, id) };
  }

  @Get(':invoiceId/history')
  @RequirePermissions(Permission.INVOICE_READ)
  history(
    @CurrentOrganization() context: OrganizationContext,
    @Param('invoiceId', new ZodValidationPipe(resourceIdSchema)) id: string,
  ) {
    return this.invoices.history(context, id);
  }

  @Get(':invoiceId/allocations')
  @RequirePermissions(Permission.INVOICE_READ)
  allocations(
    @CurrentOrganization() context: OrganizationContext,
    @Param('invoiceId', new ZodValidationPipe(resourceIdSchema)) id: string,
  ) {
    return this.invoices.allocations(context, id);
  }

  @Post('fulfilments/:fulfilmentId/issue')
  @RequirePermissions(Permission.INVOICE_ISSUE)
  async issue(
    @CurrentOrganization() context: OrganizationContext,
    @Param('fulfilmentId', new ZodValidationPipe(resourceIdSchema))
    fulfilmentId: string,
    @Headers('idempotency-key') key: string,
  ) {
    const result = await this.invoices.issue(context, fulfilmentId, key);
    return { data: result.invoice };
  }

  @Get('eligible-fulfilments/:farmId')
  @UseGuards(FarmAccessGuard)
  @FarmParam('farmId')
  @RequirePermissions(
    Permission.INVOICE_ISSUE,
    Permission.ORDER_READ,
    Permission.FULFILMENT_READ,
  )
  eligibleFulfilments(
    @CurrentOrganization() context: OrganizationContext,
    @CurrentFarm() farm: FarmContext,
  ) {
    return this.invoices.eligibleFulfilments(context, farm);
  }
}
