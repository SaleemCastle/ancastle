import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { CustomersController } from './customers.controller.js';
import { CustomersService } from './customers.service.js';

@Module({
  imports: [AuthModule, AuthorizationModule],
  controllers: [CustomersController],
  providers: [CustomersService],
})
export class CustomersModule {}
