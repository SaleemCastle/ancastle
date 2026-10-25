import { SetMetadata } from '@nestjs/common';
import type { Permission } from './permissions.js';

export const REQUIRED_PERMISSIONS_KEY = 'required_permissions';

export const ORGANIZATION_PARAM_KEY = 'organization_param';

export const RequirePermissions = (
  ...permissions: Permission[]
): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRED_PERMISSIONS_KEY, permissions);

export const OrganizationParam = (
  parameterName = 'organizationId',
): MethodDecorator & ClassDecorator =>
  SetMetadata(ORGANIZATION_PARAM_KEY, parameterName);
