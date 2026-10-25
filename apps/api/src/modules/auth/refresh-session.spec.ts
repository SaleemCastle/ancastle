import { AuthService } from './auth.service.js';

describe('Atomic refresh-session replacement', () => {
  const findUnique = vi.fn();
  const updateMany = vi.fn();
  const verifyRefreshToken = vi.fn();
  const refreshTokenMatches = vi.fn();
  const service = new AuthService(
    { authSession: { findUnique, updateMany } } as never,
    {} as never,
    {
      verifyRefreshToken,
      refreshTokenMatches,
      createAccessToken: async () => 'test-access',
      createRefreshToken: async () => 'test-refresh',
      hashRefreshToken: () => 'new-hash',
    } as never,
  );
  beforeEach(() => {
    vi.resetAllMocks();
    verifyRefreshToken.mockResolvedValue({
      sub: 'user',
      sid: 'session',
      type: 'refresh',
    });
    refreshTokenMatches.mockReturnValue(true);
    findUnique.mockResolvedValue({
      id: 'session',
      userId: 'user',
      refreshTokenHash: 'old-hash',
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60000),
      user: {
        id: 'user',
        email: 'user@example.com',
        isActive: true,
        memberships: [{}],
      },
    });
    updateMany.mockResolvedValue({ count: 1 });
  });
  it('compares the consumed hash and rechecks revocation, expiry and active identity/membership at replacement', async () => {
    await expect(
      service.refresh({ refreshToken: 'submitted' }),
    ).resolves.toMatchObject({ refreshToken: 'test-refresh' });
    expect(refreshTokenMatches).toHaveBeenCalledWith('submitted', 'old-hash');
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: 'session',
        userId: 'user',
        refreshTokenHash: 'old-hash',
        revokedAt: null,
        expiresAt: { gt: expect.any(Date) },
        user: {
          isActive: true,
          memberships: {
            some: { isActive: true, organization: { isActive: true } },
          },
        },
      },
      data: { refreshTokenHash: 'new-hash', expiresAt: expect.any(Date) },
    });
  });
  it('rejects a lost replacement race without returning newly minted tokens', async () => {
    updateMany.mockResolvedValue({ count: 0 });
    await expect(
      service.refresh({ refreshToken: 'submitted' }),
    ).rejects.toMatchObject({ code: 'INVALID_SESSION' });
    expect(updateMany).toHaveBeenCalledTimes(1);
  });
  it('rejects mismatched token hashes before replacement', async () => {
    refreshTokenMatches.mockReturnValue(false);
    await expect(
      service.refresh({ refreshToken: 'submitted' }),
    ).rejects.toMatchObject({ code: 'INVALID_SESSION' });
    expect(updateMany).not.toHaveBeenCalled();
  });
});
