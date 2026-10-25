import { Module } from '@nestjs/common';
import { AuthorizationService } from './authorization.service.js';
import { AuthorizationGuard } from './authorization.guard.js';
import { FarmAccessService } from './farm-access.service.js';
import { FarmAccessGuard } from './farm-access.guard.js';

@Module({
  providers: [
    AuthorizationService,
    AuthorizationGuard,
    FarmAccessService,
    FarmAccessGuard,
  ],
  exports: [
    AuthorizationService,
    AuthorizationGuard,
    FarmAccessService,
    FarmAccessGuard,
  ],
})
export class AuthorizationModule {}
