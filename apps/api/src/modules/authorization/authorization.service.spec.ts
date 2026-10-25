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
});
