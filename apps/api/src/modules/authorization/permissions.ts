export const Permission = {
  FULFILMENT_READ: 'fulfilment:read',
  FULFILMENT_POST: 'fulfilment:post',
  FULFILMENT_REVERSE: 'fulfilment:reverse',
  INVOICE_READ: 'invoice:read',
  INVOICE_ISSUE: 'invoice:issue',
  PAYMENT_READ: 'payment:read',
  PAYMENT_RECORD: 'payment:record',
  PAYMENT_VERIFY: 'payment:verify',
  PAYMENT_ALLOCATE: 'payment:allocate',
  PAYMENT_REVERSE: 'payment:reverse',
  RECEIVABLE_READ: 'receivable:read',
  STATEMENT_READ: 'statement:read',
  SALES_PRODUCT_READ: 'sales-product:read',
  SALES_PRODUCT_MANAGE: 'sales-product:manage',
  SALES_PRODUCT_SOURCE_MANAGE: 'sales-product-source:manage',
  ORDER_READ: 'order:read',
  ORDER_MANAGE: 'order:manage',
  ORDER_CONFIRM: 'order:confirm',
  ORDER_CANCEL: 'order:cancel',
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

  FLOCK_READ: 'flock:read',
  // Create/edit flock definitions and close/reactivate the flock lifecycle.
  FLOCK_MANAGE: 'flock:manage',
  FLOCK_MORTALITY_POST: 'flock:mortality-post',
  FLOCK_FEED_USAGE_POST: 'flock:feed-usage-post',

  USER_READ: 'user:read',
  USER_CREATE: 'user:create',
  USER_UPDATE: 'user:update',
  USER_DEACTIVATE: 'user:deactivate',

  MEMBERSHIP_READ: 'membership:read',
  MEMBERSHIP_MANAGE: 'membership:manage',
} as const;

export type Permission = (typeof Permission)[keyof typeof Permission];
