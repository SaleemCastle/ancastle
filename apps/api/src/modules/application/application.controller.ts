import { Controller, Get, Header, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { paginationQuerySchema } from '@ancastle/validation';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { CurrentUser } from '../../common/decoraters/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { AuthGuard } from '../auth/auth.guard.js';
import { ApplicationService } from './application.service.js';

@Controller('application/context')
@UseGuards(AuthGuard)
export class ApplicationController {
  constructor(private readonly application: ApplicationService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  context(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(paginationQuerySchema))
    query: z.infer<typeof paginationQuerySchema>,
  ) {
    return this.application.context(user.id, query);
  }
}
