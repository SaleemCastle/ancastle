import { MembershipRole } from '../../generated/prisma/client.js';
import {
  Permission,
  type Permission as PermissionType,
} from './permissions.js';

export const rolePermissions: Record<
  MembershipRole,
  readonly PermissionType[]
> = {
  [MembershipRole.OWNER]: Object.values(Permission),

  [MembershipRole.ADMIN]: [
    Permission.ORGANIZATION_READ,
    Permission.ORGANIZATION_UPDATE,

    Permission.FARM_READ,
    Permission.FARM_ACCESS_ALL,
    Permission.FARM_CREATE,
    Permission.FARM_UPDATE,

    Permission.CUSTOMER_READ,
    Permission.CUSTOMER_CREATE,
    Permission.CUSTOMER_UPDATE,
    Permission.CUSTOMER_DEACTIVATE,

    Permission.SUPPLIER_READ,
    Permission.SUPPLIER_CREATE,
    Permission.SUPPLIER_UPDATE,
    Permission.SUPPLIER_DEACTIVATE,

    Permission.INVENTORY_READ,
    Permission.INVENTORY_ITEM_MANAGE,
    Permission.INVENTORY_MOVEMENT_POST,
    Permission.INVENTORY_LIFECYCLE_MANAGE,

    Permission.USER_READ,
    Permission.USER_CREATE,
    Permission.USER_UPDATE,
    Permission.USER_DEACTIVATE,

    Permission.MEMBERSHIP_READ,
    Permission.MEMBERSHIP_MANAGE,
  ],

  [MembershipRole.MANAGER]: [
    Permission.ORGANIZATION_READ,

    Permission.FARM_READ,

    Permission.CUSTOMER_READ,
    Permission.CUSTOMER_CREATE,
    Permission.CUSTOMER_UPDATE,

    Permission.SUPPLIER_READ,
    Permission.SUPPLIER_CREATE,
    Permission.SUPPLIER_UPDATE,

    Permission.INVENTORY_READ,
    Permission.INVENTORY_ITEM_MANAGE,
    Permission.INVENTORY_MOVEMENT_POST,
    Permission.INVENTORY_LIFECYCLE_MANAGE,

    Permission.USER_READ,
    Permission.MEMBERSHIP_READ,
  ],

  [MembershipRole.STAFF]: [
    Permission.ORGANIZATION_READ,
    Permission.CUSTOMER_READ,
    Permission.SUPPLIER_READ,
    Permission.FARM_READ,
    Permission.INVENTORY_READ,
    Permission.INVENTORY_MOVEMENT_POST,
  ],
};
