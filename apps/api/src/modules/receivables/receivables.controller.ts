import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import {
  receivableAsOfQuerySchema,
  receivableCustomerQuerySchema,
  receivableInvoiceQuerySchema,
  resourceIdSchema,
  statementQuerySchema,
  type ReceivableCustomerQuery,
  type ReceivableInvoiceQuery,
  type StatementQuery,
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
import { ReceivablesService } from './receivables.service.js';

@Controller('organizations/:organizationId')
@UseGuards(AuthGuard, AuthorizationGuard)
@OrganizationParam()
export class ReceivablesController {
  constructor(private readonly receivables: ReceivablesService) {}

  @Get('receivables/invoices')
  @RequirePermissions(Permission.RECEIVABLE_READ)
  listInvoices(
    @CurrentOrganization() context: OrganizationContext,
    @Query(new ZodValidationPipe(receivableInvoiceQuerySchema))
    query: ReceivableInvoiceQuery,
  ) {
    return this.receivables.listInvoices(context, query);
  }

  @Get('receivables/customers')
  @RequirePermissions(Permission.RECEIVABLE_READ)
  listCustomers(
    @CurrentOrganization() context: OrganizationContext,
    @Query(new ZodValidationPipe(receivableCustomerQuerySchema))
    query: ReceivableCustomerQuery,
  ) {
    return this.receivables.listCustomers(context, query);
  }

  @Get('receivables/customers/:customerId')
  @RequirePermissions(Permission.RECEIVABLE_READ)
  getCustomer(
    @CurrentOrganization() context: OrganizationContext,
    @Param('customerId', new ZodValidationPipe(resourceIdSchema))
    customerId: string,
    @Query(new ZodValidationPipe(receivableAsOfQuerySchema))
    query: { asOfDate?: string },
  ) {
    return this.receivables.getCustomer(context, customerId, query.asOfDate);
  }

  @Get('customers/:customerId/statements')
  @RequirePermissions(Permission.STATEMENT_READ)
  statement(
    @CurrentOrganization() context: OrganizationContext,
    @Param('customerId', new ZodValidationPipe(resourceIdSchema))
    customerId: string,
    @Query(new ZodValidationPipe(statementQuerySchema)) query: StatementQuery,
  ) {
    return this.receivables.statement(context, customerId, query);
  }
}
