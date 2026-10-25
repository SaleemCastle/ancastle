import { Module } from '@nestjs/common';
import { AuthorizationService } from './authorization.service.js';
import { AuthorizationGuard } from './authorization.guard.js';

@Module({
  providers: [AuthorizationService, AuthorizationGuard],
  exports: [AuthorizationService, AuthorizationGuard],
})
export class AuthorizationModule {}
