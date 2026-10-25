import { ORGANIZATION_ROLES } from '@ancastle/types';
import { MembershipRole, Prisma } from '../../generated/prisma/client.js';
import type { PrismaService } from '../../database/prisma.service.js';
import type { PasswordService } from '../auth/password.service.js';
import { AuthorizationService } from '../authorization/authorization.service.js';
import { OrganizationContext } from '../authorization/organization-context.js';
import { UsersService } from './users.service.js';

describe('UsersService transaction retries', () => {
  const transaction = vi.fn();
  const findFirst = vi.fn();
  const updateMany = vi.fn();
  const service = new UsersService(
    { $transaction: transaction } as unknown as PrismaService,
    {} as PasswordService,
    new AuthorizationService(),
  );
  const context = new OrganizationContext(
    'organization',
    'actor-membership',
    'actor',
    'OWNER',
  );
  const conflict = () =>
    new Prisma.PrismaClientKnownRequestError('Serialization conflict', {
      code: 'P2034',
      clientVersion: 'test',
    });

  const adapterConflict = () => {
    const error = new Error('TransactionWriteConflict', {
      cause: { kind: 'TransactionWriteConflict' },
    });
    error.name = 'DriverAdapterError';
    return error;
  };

  beforeEach(() => {
    vi.resetAllMocks();
    updateMany.mockResolvedValue({ count: 1 });
    findFirst.mockResolvedValueOnce({ role: 'OWNER' }).mockResolvedValue({
      id: 'target-membership',
      userId: 'target',
      organizationId: 'organization',
      displayName: 'Updated',
      role: 'STAFF',
      isActive: true,
      user: { email: 'target@example.com', isActive: true },
      farmAccessAssignments: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  });

  it.each([conflict, adapterConflict])(
    'retries transient conflicts and completes once a transaction succeeds (%#)',
    async (failure) => {
      transaction
        .mockRejectedValueOnce(failure())
        .mockRejectedValueOnce(failure())
        .mockImplementation((operation: (tx: unknown) => unknown) =>
          operation({ organizationMembership: { findFirst, updateMany } }),
        );
      await expect(
        service.updateProfile(context, 'target', { displayName: 'Updated' }),
      ).resolves.toMatchObject({ displayName: 'Updated' });
      expect(transaction).toHaveBeenCalledTimes(3);
      expect(updateMany).toHaveBeenCalledTimes(1);
    },
  );

  it.each([conflict, adapterConflict])(
    'bounds retries and returns a safe stable concurrency error (%#)',
    async (failure) => {
      transaction.mockRejectedValue(failure());
      await expect(
        service.updateProfile(context, 'target', { displayName: 'Updated' }),
      ).rejects.toMatchObject({
        code: 'CONCURRENT_UPDATE',
        message: 'The data changed during this request; please retry',
      });
      expect(transaction).toHaveBeenCalledTimes(3);
    },
  );

  it('does not retry unrelated persistence errors', async () => {
    const failure = new Error('Database unavailable');
    transaction.mockRejectedValue(failure);
    await expect(
      service.updateProfile(context, 'target', { displayName: 'Updated' }),
    ).rejects.toBe(failure);
    expect(transaction).toHaveBeenCalledTimes(1);
  });
  it('keeps shared role contracts aligned with persisted membership roles', () => {
    expect(new Set(ORGANIZATION_ROLES)).toEqual(
      new Set(Object.values(MembershipRole)),
    );
  });
  it.each([
    new Error('TransactionWriteConflict'),
    Object.assign(
      new Error('private adapter failure', {
        cause: { kind: 'ConnectionClosed' },
      }),
      { name: 'DriverAdapterError' },
    ),
    new Error('unrelated failure', {
      cause: { kind: 'TransactionWriteConflict' },
    }),
    Object.assign(new Error('private adapter failure'), {
      name: 'DriverAdapterError',
    }),
  ])(
    'does not retry unrelated or message-only adapter failures (%#)',
    async (failure) => {
      transaction.mockRejectedValue(failure);
      await expect(
        service.updateProfile(context, 'target', { displayName: 'Updated' }),
      ).rejects.toBe(failure);
      expect(transaction).toHaveBeenCalledTimes(1);
    },
  );
});
