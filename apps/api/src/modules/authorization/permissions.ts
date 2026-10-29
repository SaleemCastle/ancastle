export const Permission = {
  ORGANIZATION_READ: 'organization:read',
  ORGANIZATION_UPDATE: 'organization:update',

  FARM_READ: 'farm:read',
  FARM_ACCESS_ALL: 'farm:access-all',
  FARM_CREATE: 'farm:create',
  FARM_UPDATE: 'farm:update',

  CUSTOMER_READ: 'customer:read',
  CUSTOMER_CREATE: 'customer:create',
  CUSTOMER_UPDATE: 'customer:update',
  CUSTOMER_DEACTIVATE: 'customer:deactivate',

  SUPPLIER_READ: 'supplier:read',
  SUPPLIER_CREATE: 'supplier:create',
  SUPPLIER_UPDATE: 'supplier:update',
  SUPPLIER_DEACTIVATE: 'supplier:deactivate',

  INVENTORY_READ: 'inventory:read',
  INVENTORY_ITEM_MANAGE: 'inventory:item-manage',
  INVENTORY_MOVEMENT_POST: 'inventory:movement-post',
  INVENTORY_LIFECYCLE_MANAGE: 'inventory:lifecycle-manage',

  USER_READ: 'user:read',
  USER_CREATE: 'user:create',
  USER_UPDATE: 'user:update',
  USER_DEACTIVATE: 'user:deactivate',

  MEMBERSHIP_READ: 'membership:read',
  MEMBERSHIP_MANAGE: 'membership:manage',
} as const;

export type Permission = (typeof Permission)[keyof typeof Permission];
