import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { ApplicationController } from './application.controller.js';
import { ApplicationService } from './application.service.js';

@Module({
  imports: [AuthModule, AuthorizationModule],
  controllers: [ApplicationController],
  providers: [ApplicationService],
})
export class ApplicationModule {}
