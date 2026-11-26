import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  allocatePaymentSchema,
  paymentQuerySchema,
  recordPaymentSchema,
  resourceIdSchema,
  reversePaymentSchema,
  type AllocatePaymentInput,
  type PaymentQuery,
  type RecordPaymentInput,
  type ReversePaymentInput,
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
import { PaymentsService } from './payments.service.js';

@Controller('organizations/:organizationId/payments')
@UseGuards(AuthGuard, AuthorizationGuard)
@OrganizationParam()
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get()
  @RequirePermissions(Permission.PAYMENT_READ)
  list(
    @CurrentOrganization() context: OrganizationContext,
    @Query(new ZodValidationPipe(paymentQuerySchema)) query: PaymentQuery,
  ) {
    return this.payments.list(context, query);
  }

  @Get('invoices/:invoiceId/balance')
  @RequirePermissions(Permission.PAYMENT_READ)
  async invoiceBalance(
    @CurrentOrganization() context: OrganizationContext,
    @Param('invoiceId', new ZodValidationPipe(resourceIdSchema))
    invoiceId: string,
  ) {
    return { data: await this.payments.invoiceBalance(context, invoiceId) };
  }

  @Get('invoices/:invoiceId/allocations')
  @RequirePermissions(Permission.PAYMENT_READ)
  invoiceAllocations(
    @CurrentOrganization() context: OrganizationContext,
    @Param('invoiceId', new ZodValidationPipe(resourceIdSchema))
    invoiceId: string,
  ) {
    return this.payments.invoiceAllocations(context, invoiceId);
  }

  @Get(':paymentId')
  @RequirePermissions(Permission.PAYMENT_READ)
  async get(
    @CurrentOrganization() context: OrganizationContext,
    @Param('paymentId', new ZodValidationPipe(resourceIdSchema))
    paymentId: string,
  ) {
    return { data: await this.payments.get(context, paymentId) };
  }

  @Post()
  @RequirePermissions(Permission.PAYMENT_RECORD)
  async record(
    @CurrentOrganization() context: OrganizationContext,
    @Body(new ZodValidationPipe(recordPaymentSchema)) body: RecordPaymentInput,
    @Headers('idempotency-key') key: string,
  ) {
    const result = await this.payments.record(context, body, key);
    return { data: result.payment };
  }

  @Post(':paymentId/verify')
  @RequirePermissions(Permission.PAYMENT_VERIFY)
  async verify(
    @CurrentOrganization() context: OrganizationContext,
    @Param('paymentId', new ZodValidationPipe(resourceIdSchema))
    paymentId: string,
    @Headers('idempotency-key') key: string,
  ) {
    const result = await this.payments.verify(context, paymentId, key);
    return { data: result.payment };
  }

  @Post(':paymentId/allocations')
  @RequirePermissions(Permission.PAYMENT_ALLOCATE)
  async allocate(
    @CurrentOrganization() context: OrganizationContext,
    @Param('paymentId', new ZodValidationPipe(resourceIdSchema))
    paymentId: string,
    @Body(new ZodValidationPipe(allocatePaymentSchema))
    body: AllocatePaymentInput,
    @Headers('idempotency-key') key: string,
  ) {
    const result = await this.payments.allocate(context, paymentId, body, key);
    return { data: result.payment };
  }

  @Post(':paymentId/reverse')
  @RequirePermissions(Permission.PAYMENT_REVERSE)
  async reverse(
    @CurrentOrganization() context: OrganizationContext,
    @Param('paymentId', new ZodValidationPipe(resourceIdSchema))
    paymentId: string,
    @Body(new ZodValidationPipe(reversePaymentSchema))
    body: ReversePaymentInput,
    @Headers('idempotency-key') key: string,
  ) {
    const result = await this.payments.reverse(context, paymentId, body, key);
    return { data: result.payment };
  }
}
