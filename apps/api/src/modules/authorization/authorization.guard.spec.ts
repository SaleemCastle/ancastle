import 'reflect-metadata';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { PrismaService } from '../../database/prisma.service.js';
import { MembershipRole } from '../../generated/prisma/client.js';
import { AuthorizationGuard } from './authorization.guard.js';
import { AuthorizationService } from './authorization.service.js';
import {
  OrganizationContext,
  type OrganizationRequest,
} from './organization-context.js';
import { Permission } from './permissions.js';
import {
  OrganizationParam,
  RequirePermissions,
} from './require-permissions.decorator.js';

const organizationId = 'b7ed8cd1-08e7-4e94-b16d-1d99709bddb6';

@RequirePermissions(Permission.USER_CREATE)
class ProtectedController {
  handler(this: void) {}
}

@OrganizationParam('tenantId')
class ContextController {
  handler(this: void) {}
}

class PublicController {
  handler(this: void) {}
}

describe('AuthorizationGuard organization context', () => {
  const findUnique = vi.fn();
  const guard = new AuthorizationGuard(
    new Reflector(),
    { organizationMembership: { findUnique } } as unknown as PrismaService,
    new AuthorizationService(),
  );
  let request: OrganizationRequest;

  function executionContext(
    controller = ProtectedController,
  ): ExecutionContext {
    return {
      getHandler: () => controller.prototype.handler,
      getClass: () => controller,
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
  }

  beforeEach(() => {
    vi.resetAllMocks();
    request = {
      user: { id: 'authenticated-user', email: 'user@example.com' },
      params: { organizationId },
    } as unknown as OrganizationRequest;
    findUnique.mockResolvedValue({
      id: 'membership-id',
      organizationId,
      userId: 'authenticated-user',
      role: MembershipRole.ADMIN,
      isActive: true,
      organization: { isActive: true },
    });
  });

  it('derives immutable context from the verified membership', async () => {
    await expect(guard.canActivate(executionContext())).resolves.toBe(true);
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organizationId_userId: {
            organizationId,
            userId: 'authenticated-user',
          },
        },
      }),
    );
    expect(request.organizationContext).toEqual({
      organizationId,
      membershipId: 'membership-id',
      userId: 'authenticated-user',
      role: MembershipRole.ADMIN,
    });
    expect(Object.isFrozen(request.organizationContext)).toBe(true);
  });

  it('resolves a custom organization parameter even without required permissions', async () => {
    request.params = { tenantId: organizationId };
    await expect(
      guard.canActivate(executionContext(ContextController)),
    ).resolves.toBe(true);
    expect(request.organizationContext?.organizationId).toBe(organizationId);
  });

  it.each([undefined, '', 'not-a-uuid', ['one', 'two']])(
    'rejects missing/malformed organization selection %j before querying',
    async (value) => {
      request.params = { organizationId: value } as never;
      request.body = {
        organizationId,
        userId: 'authenticated-user',
        role: 'OWNER',
      };
      await expect(guard.canActivate(executionContext())).rejects.toMatchObject(
        { code: 'FORBIDDEN' },
      );
      expect(findUnique).not.toHaveBeenCalled();
      expect(request.organizationContext).toBeUndefined();
    },
  );

  it('requires authenticated identity regardless of payload identity', async () => {
    delete request.user;
    request.body = { userId: 'authenticated-user' };
    await expect(guard.canActivate(executionContext())).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(findUnique).not.toHaveBeenCalled();
  });

  it.each([
    null,
    { isActive: false, organization: { isActive: true } },
    { isActive: true, organization: { isActive: false } },
    {
      isActive: true,
      organization: { isActive: true },
      role: MembershipRole.STAFF,
    },
  ])(
    'rejects invalid memberships/permissions and clears stale context: %j',
    async (membership) => {
      request.organizationContext = new OrganizationContext(
        organizationId,
        'stale',
        'user',
        MembershipRole.OWNER,
      );
      findUnique.mockResolvedValue(membership);
      await expect(guard.canActivate(executionContext())).rejects.toMatchObject(
        { code: 'FORBIDDEN' },
      );
      expect(request.organizationContext).toBeUndefined();
    },
  );

  it('keeps unrelated endpoints unscoped and clears stale context', async () => {
    request.organizationContext = new OrganizationContext(
      organizationId,
      'stale',
      'user',
      MembershipRole.OWNER,
    );
    await expect(
      guard.canActivate(executionContext(PublicController)),
    ).resolves.toBe(true);
    expect(findUnique).not.toHaveBeenCalled();
    expect(request.organizationContext).toBeUndefined();
  });
});
