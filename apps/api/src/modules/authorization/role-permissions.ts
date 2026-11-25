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
    Permission.FULFILMENT_READ,
    Permission.FULFILMENT_POST,
    Permission.FULFILMENT_REVERSE,
    Permission.INVOICE_READ,
    Permission.INVOICE_ISSUE,
    Permission.PAYMENT_READ,
    Permission.PAYMENT_RECORD,
    Permission.PAYMENT_VERIFY,
    Permission.PAYMENT_ALLOCATE,
    Permission.PAYMENT_REVERSE,
    Permission.RECEIVABLE_READ,
    Permission.STATEMENT_READ,
    Permission.SALES_PRODUCT_READ,
    Permission.SALES_PRODUCT_MANAGE,
    Permission.SALES_PRODUCT_SOURCE_MANAGE,
    Permission.ORDER_READ,
    Permission.ORDER_MANAGE,
    Permission.ORDER_CONFIRM,
    Permission.ORDER_CANCEL,
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

    Permission.FLOCK_READ,
    Permission.FLOCK_MANAGE,
    Permission.FLOCK_MORTALITY_POST,
    Permission.FLOCK_FEED_USAGE_POST,

    Permission.USER_READ,
    Permission.USER_CREATE,
    Permission.USER_UPDATE,
    Permission.USER_DEACTIVATE,

    Permission.MEMBERSHIP_READ,
    Permission.MEMBERSHIP_MANAGE,
  ],

  [MembershipRole.MANAGER]: [
    Permission.FULFILMENT_READ,
    Permission.INVOICE_READ,
    Permission.PAYMENT_READ,
    Permission.PAYMENT_RECORD,
    Permission.PAYMENT_VERIFY,
    Permission.PAYMENT_ALLOCATE,
    Permission.RECEIVABLE_READ,
    Permission.STATEMENT_READ,
    Permission.FULFILMENT_POST,
    Permission.SALES_PRODUCT_READ,
    Permission.SALES_PRODUCT_MANAGE,
    Permission.SALES_PRODUCT_SOURCE_MANAGE,
    Permission.ORDER_READ,
    Permission.ORDER_MANAGE,
    Permission.ORDER_CONFIRM,
    Permission.ORDER_CANCEL,
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

    // Day-to-day poultry management still requires verified farm access.
    Permission.FLOCK_READ,
    Permission.FLOCK_MANAGE,
    Permission.FLOCK_MORTALITY_POST,
    Permission.FLOCK_FEED_USAGE_POST,

    Permission.USER_READ,
    Permission.MEMBERSHIP_READ,
  ],

  [MembershipRole.STAFF]: [
    Permission.FULFILMENT_READ,
    Permission.INVOICE_READ,
    Permission.PAYMENT_READ,
    Permission.PAYMENT_RECORD,
    Permission.FULFILMENT_POST,
    Permission.SALES_PRODUCT_READ,
    Permission.ORDER_READ,
    Permission.ORGANIZATION_READ,
    Permission.CUSTOMER_READ,
    Permission.SUPPLIER_READ,
    Permission.FARM_READ,
    Permission.INVENTORY_READ,
    Permission.INVENTORY_MOVEMENT_POST,
    // Assigned operational staff may record events, but cannot create/edit or
    // close/reactivate flocks. These capabilities never grant FARM_ACCESS_ALL.
    Permission.FLOCK_READ,
    Permission.FLOCK_MORTALITY_POST,
    Permission.FLOCK_FEED_USAGE_POST,
  ],
};
