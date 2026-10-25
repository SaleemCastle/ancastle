import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PasswordService } from './password.service.js';
import { TokenService } from './token.service.js';
import { AuthService } from './auth.service.js';
import { AuthController } from './auth.controller.js';
import { AuthGuard } from './auth.guard.js';

@Module({
  imports: [JwtModule.register({})],
  providers: [AuthService, PasswordService, TokenService, AuthGuard],
  exports: [AuthService, PasswordService, TokenService, AuthGuard],
  controllers: [AuthController],
})
export class AuthModule {}
