import { MembershipRole } from '../../generated/prisma/client.js';
import { AuthorizationService } from './authorization.service.js';
import { Permission } from './permissions.js';

describe('AuthorizationService', () => {
  const service = new AuthorizationService();

  it('allows owners every defined permission', () => {
    for (const permission of Object.values(Permission)) {
      expect(service.hasPermission(MembershipRole.OWNER, permission)).toBe(
        true,
      );
    }
  });

  it('allows administrators to manage users', () => {
    expect(
      service.hasPermission(MembershipRole.ADMIN, Permission.USER_CREATE),
    ).toBe(true);

    expect(
      service.hasPermission(MembershipRole.ADMIN, Permission.MEMBERSHIP_MANAGE),
    ).toBe(true);
  });

  it('does not allow managers to manage memberships', () => {
    expect(
      service.hasPermission(
        MembershipRole.MANAGER,
        Permission.MEMBERSHIP_MANAGE,
      ),
    ).toBe(false);
  });

  it('limits staff to basic organization and farm access', () => {
    expect(
      service.hasPermission(MembershipRole.STAFF, Permission.ORGANIZATION_READ),
    ).toBe(true);

    expect(
      service.hasPermission(MembershipRole.STAFF, Permission.FARM_READ),
    ).toBe(true);

    expect(
      service.hasPermission(MembershipRole.STAFF, Permission.USER_CREATE),
    ).toBe(false);
  });

  it('requires every requested permission', () => {
    expect(
      service.hasAllPermissions(MembershipRole.ADMIN, [
        Permission.USER_READ,
        Permission.USER_CREATE,
      ]),
    ).toBe(true);

    expect(
      service.hasAllPermissions(MembershipRole.MANAGER, [
        Permission.USER_READ,
        Permission.USER_CREATE,
      ]),
    ).toBe(false);
  });
  it.each([
    [MembershipRole.ADMIN, true],
    [MembershipRole.MANAGER, false],
    [MembershipRole.STAFF, false],
  ] as const)(
    'organization-wide farm access for %s is %s',
    (role, expected) => {
      expect(service.hasPermission(role, Permission.FARM_ACCESS_ALL)).toBe(
        expected,
      );
    },
  );

  it.each([
    [
      MembershipRole.ADMIN,
      [
        Permission.CUSTOMER_READ,
        Permission.CUSTOMER_CREATE,
        Permission.CUSTOMER_UPDATE,
        Permission.CUSTOMER_DEACTIVATE,
        Permission.SUPPLIER_READ,
        Permission.SUPPLIER_CREATE,
        Permission.SUPPLIER_UPDATE,
        Permission.SUPPLIER_DEACTIVATE,
      ],
      [],
    ],
    [
      MembershipRole.MANAGER,
      [
        Permission.CUSTOMER_READ,
        Permission.CUSTOMER_CREATE,
        Permission.CUSTOMER_UPDATE,
        Permission.SUPPLIER_READ,
        Permission.SUPPLIER_CREATE,
        Permission.SUPPLIER_UPDATE,
      ],
      [Permission.CUSTOMER_DEACTIVATE, Permission.SUPPLIER_DEACTIVATE],
    ],
    [
      MembershipRole.STAFF,
      [Permission.CUSTOMER_READ, Permission.SUPPLIER_READ],
      [
        Permission.CUSTOMER_CREATE,
        Permission.CUSTOMER_UPDATE,
        Permission.CUSTOMER_DEACTIVATE,
        Permission.SUPPLIER_CREATE,
        Permission.SUPPLIER_UPDATE,
        Permission.SUPPLIER_DEACTIVATE,
      ],
    ],
  ] as const)(
    'enforces customer and supplier permission matrix for %s',
    (role, allowed, denied) => {
      for (const permission of allowed) {
        expect(service.hasPermission(role, permission)).toBe(true);
      }

      for (const permission of denied) {
        expect(service.hasPermission(role, permission)).toBe(false);
      }
    },
  );

  it.each([
    [
      MembershipRole.ADMIN,
      [
        Permission.INVENTORY_READ,
        Permission.INVENTORY_ITEM_MANAGE,
        Permission.INVENTORY_MOVEMENT_POST,
        Permission.INVENTORY_LIFECYCLE_MANAGE,
      ],
      [],
    ],
    [
      MembershipRole.MANAGER,
      [
        Permission.INVENTORY_READ,
        Permission.INVENTORY_ITEM_MANAGE,
        Permission.INVENTORY_MOVEMENT_POST,
        Permission.INVENTORY_LIFECYCLE_MANAGE,
      ],
      [],
    ],
    [
      MembershipRole.STAFF,
      [Permission.INVENTORY_READ, Permission.INVENTORY_MOVEMENT_POST],
      [Permission.INVENTORY_ITEM_MANAGE, Permission.INVENTORY_LIFECYCLE_MANAGE],
    ],
  ] as const)(
    'enforces inventory permission matrix for %s',
    (role, allowed, denied) => {
      for (const permission of allowed) {
        expect(service.hasPermission(role, permission)).toBe(true);
      }

      for (const permission of denied) {
        expect(service.hasPermission(role, permission)).toBe(false);
      }
    },
  );
});
