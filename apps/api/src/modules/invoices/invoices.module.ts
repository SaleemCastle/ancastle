import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { InvoiceActivationService } from './invoice-activation.service.js';
import { InvoicesController } from './invoices.controller.js';
import { InvoicesService } from './invoices.service.js';

@Module({
  imports: [AuthModule, AuthorizationModule],
  controllers: [InvoicesController],
  providers: [InvoicesService, InvoiceActivationService],
})
export class InvoicesModule {}
