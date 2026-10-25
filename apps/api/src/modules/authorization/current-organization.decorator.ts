import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import { BusinessException } from '../../common/exceptions/business.exception.js';
import type {
  OrganizationContext,
  OrganizationRequest,
} from './organization-context.js';

export const CurrentOrganization = createParamDecorator(
  (_data: unknown, context: ExecutionContext): OrganizationContext => {
    const request = context.switchToHttp().getRequest<OrganizationRequest>();
    if (!request.organizationContext) {
      throw new BusinessException(
        'FORBIDDEN',
        'You do not have permission to perform this action',
        403,
      );
    }
    return request.organizationContext;
  },
);
