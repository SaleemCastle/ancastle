import {
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { BusinessException } from '../../common/exceptions/business.exception.js';
import { FarmAccessService } from './farm-access.service.js';
import type { FarmRequest } from './farm-context.js';
import { FARM_PARAM_KEY } from './farm-param.decorator.js';

@Injectable()
export class FarmAccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly farms: FarmAccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FarmRequest>();
    delete request.farmContext;
    const parameter =
      this.reflector.getAllAndOverride<string>(FARM_PARAM_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? 'farmId';

    if (
      !request.organizationContext ||
      !request.user ||
      request.user.id !== request.organizationContext.userId
    ) {
      throw new BusinessException(
        'FORBIDDEN',
        'You do not have permission to perform this action',
        403,
      );
    }

    request.farmContext = await this.farms.resolve(
      request.organizationContext,
      request.params?.[parameter],
    );
    return true;
  }
}
