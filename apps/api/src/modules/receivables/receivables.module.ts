import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { ReceivablesController } from './receivables.controller.js';
import { ReceivablesService } from './receivables.service.js';

@Module({
  imports: [AuthModule, AuthorizationModule],
  controllers: [ReceivablesController],
  providers: [ReceivablesService],
})
export class ReceivablesModule {}
