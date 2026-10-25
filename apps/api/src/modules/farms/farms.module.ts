import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { FarmsController } from './farms.controller.js';
import { FarmsService } from './farms.service.js';

@Module({
  imports: [AuthModule, AuthorizationModule],
  controllers: [FarmsController],
  providers: [FarmsService],
})
export class FarmsModule {}
