export const Permission = {
  ORGANIZATION_READ: 'organization:read',
  ORGANIZATION_UPDATE: 'organization:update',

  FARM_READ: 'farm:read',
  FARM_CREATE: 'farm:create',
  FARM_UPDATE: 'farm:update',

  USER_READ: 'user:read',
  USER_CREATE: 'user:create',
  USER_UPDATE: 'user:update',
  USER_DEACTIVATE: 'user:deactivate',

  MEMBERSHIP_READ: 'membership:read',
  MEMBERSHIP_MANAGE: 'membership:manage',
} as const;

export type Permission = (typeof Permission)[keyof typeof Permission];
