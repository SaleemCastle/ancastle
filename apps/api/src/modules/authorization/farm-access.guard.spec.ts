import 'reflect-metadata';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { BusinessException } from '../../common/exceptions/business.exception.js';
import { OrganizationContext } from './organization-context.js';
import { FarmContext, type FarmRequest } from './farm-context.js';
import { FarmParam } from './farm-param.decorator.js';
import { FarmAccessGuard } from './farm-access.guard.js';
import type { FarmAccessService } from './farm-access.service.js';

class DefaultController {
  handler(this: void) {}
}

@FarmParam('selectedFarm')
class CustomController {
  handler(this: void) {}
}

describe('FarmAccessGuard', () => {
  const resolve = vi.fn();
  const guard = new FarmAccessGuard(new Reflector(), {
    resolve,
  } as unknown as FarmAccessService);
  let request: FarmRequest;

  function execution(controller = DefaultController): ExecutionContext {
    return {
      getHandler: () => controller.prototype.handler,
      getClass: () => controller,
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
  }

  beforeEach(() => {
    vi.resetAllMocks();
    request = {
      user: { id: 'user', email: 'user@example.com' },
      organizationContext: new OrganizationContext(
        'organization',
        'membership',
        'user',
        'STAFF',
      ),
      params: { farmId: 'farm', selectedFarm: 'custom-farm' },
      body: { farmId: 'spoofed-farm', userId: 'other-user', role: 'OWNER' },
    } as unknown as FarmRequest;
    resolve.mockResolvedValue(new FarmContext('organization', 'verified-farm'));
  });

  it('uses verified organization context and route selection, ignoring payload claims', async () => {
    await expect(guard.canActivate(execution())).resolves.toBe(true);
    expect(resolve).toHaveBeenCalledWith(request.organizationContext, 'farm');
    expect(request.farmContext).toEqual({
      organizationId: 'organization',
      farmId: 'verified-farm',
    });
    expect(Object.isFrozen(request.farmContext)).toBe(true);
  });

  it('supports custom farm parameter metadata', async () => {
    await guard.canActivate(execution(CustomController));
    expect(resolve).toHaveBeenCalledWith(
      request.organizationContext,
      'custom-farm',
    );
  });

  it.each(['organization', 'identity', 'mismatched identity'])(
    'fails closed without verified %s',
    async (kind) => {
      request.farmContext = new FarmContext('stale', 'stale');
      if (kind === 'organization') delete request.organizationContext;
      if (kind === 'identity') delete request.user;
      if (kind === 'mismatched identity')
        request.user = { id: 'other', email: 'other@example.com' };
      await expect(guard.canActivate(execution())).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      expect(resolve).not.toHaveBeenCalled();
      expect(request.farmContext).toBeUndefined();
    },
  );

  it('does not retain stale farm context when access is rejected', async () => {
    request.farmContext = new FarmContext('stale', 'stale');
    resolve.mockRejectedValue(
      new BusinessException('FORBIDDEN', 'Forbidden', 403),
    );
    await expect(guard.canActivate(execution())).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(request.farmContext).toBeUndefined();
  });
});
