import { Injectable } from '@nestjs/common';
import type { MembershipRole } from '../../generated/prisma/client.js';
import type { Permission } from './permissions.js';
import { rolePermissions } from './role-permissions.js';

@Injectable()
export class AuthorizationService {
  hasPermission(role: MembershipRole, permission: Permission): boolean {
    return rolePermissions[role].includes(permission);
  }

  hasAllPermissions(
    role: MembershipRole,
    permissions: readonly Permission[],
  ): boolean {
    return permissions.every((permission) =>
      this.hasPermission(role, permission),
    );
  }
}
