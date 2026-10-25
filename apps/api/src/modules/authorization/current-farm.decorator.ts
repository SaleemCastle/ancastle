import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import { BusinessException } from '../../common/exceptions/business.exception.js';
import type { FarmContext, FarmRequest } from './farm-context.js';

export const CurrentFarm = createParamDecorator(
  (_data: unknown, context: ExecutionContext): FarmContext => {
    const request = context.switchToHttp().getRequest<FarmRequest>();
    if (!request.farmContext) {
      throw new BusinessException(
        'FORBIDDEN',
        'You do not have permission to perform this action',
        403,
      );
    }
    return request.farmContext;
  },
);
