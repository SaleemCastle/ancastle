import {
  Body,
  Controller,
  Post,
  HttpCode,
  Get,
  UseGuards,
} from '@nestjs/common';
import {
  loginSchema,
  type LoginInput,
  refreshTokenSchema,
  type RefreshTokenInput,
  logoutSchema,
  type LogoutInput,
} from '@ancastle/validation';
import type { LoginResponse, RefreshTokenResponse } from '@ancastle/types';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { AuthService } from './auth.service.js';
import { AuthGuard } from './auth.guard.js';
import { CurrentUser } from '../../common/decoraters/current-user.decorator.js';
import type { AuthenticatedUser } from './authenticated-user.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  login(
    @Body(new ZodValidationPipe(loginSchema))
    input: LoginInput,
  ): Promise<LoginResponse> {
    return this.authService.login(input);
  }

  @Post('refresh')
  refresh(
    @Body(new ZodValidationPipe(refreshTokenSchema))
    input: RefreshTokenInput,
  ): Promise<RefreshTokenResponse> {
    return this.authService.refresh(input);
  }

  @Post('logout')
  @HttpCode(204)
  async logout(
    @Body(new ZodValidationPipe(logoutSchema))
    input: LogoutInput,
  ): Promise<void> {
    await this.authService.logout(input);
  }

  @Get('me')
  @UseGuards(AuthGuard)
  me(@CurrentUser() user: AuthenticatedUser): AuthenticatedUser {
    return user;
  }
}
