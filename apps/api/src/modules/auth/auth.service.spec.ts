import { MembershipRole } from '../../generated/prisma/client.js';
import { AuthService } from './auth.service.js';

describe('AuthService', () => {
  const user = {
    id: '11111111-1111-1111-1111-111111111111',
    email: 'user@example.com',
    passwordHash: '$argon2id$test-hash',
    isActive: true,
    memberships: [
      {
        organizationId: '22222222-2222-2222-2222-222222222222',
        role: MembershipRole.ADMIN,
        isActive: true,
      },
    ],
  };

  const prisma = {
    user: {
      findUnique: vi.fn(),
    },
    authSession: {
      create: vi.fn(),
    },
  };

  const passwordService = {
    verify: vi.fn(),
  };

  const tokenService = {
    createAccessToken: vi.fn(),
    createRefreshToken: vi.fn(),
    hashRefreshToken: vi.fn(),
  };

  let service: AuthService;

  beforeEach(() => {
    vi.clearAllMocks();

    service = new AuthService(
      prisma as never,
      passwordService as never,
      tokenService as never,
    );

    prisma.user.findUnique.mockResolvedValue(user);
    passwordService.verify.mockResolvedValue(true);

    tokenService.createAccessToken.mockResolvedValue('access-token');
    tokenService.createRefreshToken.mockResolvedValue('refresh-token');
    tokenService.hashRefreshToken.mockReturnValue('refresh-token-hash');

    prisma.authSession.create.mockResolvedValue({});
  });

  it('authenticates valid credentials and creates a session', async () => {
    const result = await service.login({
      email: 'USER@EXAMPLE.COM',
      password: 'correct-password',
    });

    expect(prisma.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          email: 'user@example.com',
        },
      }),
    );

    expect(passwordService.verify).toHaveBeenCalledWith(
      user.passwordHash,
      'correct-password',
    );

    expect(tokenService.createAccessToken).toHaveBeenCalledWith(
      user.id,
      user.email,
    );

    expect(tokenService.createRefreshToken).toHaveBeenCalledWith(
      user.id,
      expect.any(String),
    );

    expect(tokenService.hashRefreshToken).toHaveBeenCalledWith('refresh-token');

    expect(prisma.authSession.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: user.id,
        refreshTokenHash: 'refresh-token-hash',
        expiresAt: expect.any(Date),
      }),
    });

    expect(result).toEqual(
      expect.objectContaining({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        user: {
          id: user.id,
          email: user.email,
        },
        memberships: [
          {
            organizationId: user.memberships[0].organizationId,
            role: MembershipRole.ADMIN,
          },
        ],
      }),
    );
  });

  it('rejects an unknown email', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(
      service.login({
        email: 'missing@example.com',
        password: 'password',
      }),
    ).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
    });

    expect(passwordService.verify).not.toHaveBeenCalled();
    expect(prisma.authSession.create).not.toHaveBeenCalled();
  });

  it('rejects an incorrect password', async () => {
    passwordService.verify.mockResolvedValue(false);

    await expect(
      service.login({
        email: user.email,
        password: 'wrong-password',
      }),
    ).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
    });

    expect(prisma.authSession.create).not.toHaveBeenCalled();
  });

  it('rejects an inactive user', async () => {
    prisma.user.findUnique.mockResolvedValue({
      ...user,
      isActive: false,
    });

    await expect(
      service.login({
        email: user.email,
        password: 'correct-password',
      }),
    ).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
    });

    expect(passwordService.verify).not.toHaveBeenCalled();
  });

  it('rejects a user without an active organization membership', async () => {
    prisma.user.findUnique.mockResolvedValue({
      ...user,
      memberships: [],
    });

    await expect(
      service.login({
        email: user.email,
        password: 'correct-password',
      }),
    ).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
    });

    expect(prisma.authSession.create).not.toHaveBeenCalled();
  });

  it('does not expose the password hash in the login response', async () => {
    const result = await service.login({
      email: user.email,
      password: 'correct-password',
    });

    expect(result).not.toHaveProperty('passwordHash');
    expect(result.user).not.toHaveProperty('passwordHash');

    expect(JSON.stringify(result)).not.toContain(user.passwordHash);
  });

  it('stores the refresh token hash instead of the raw refresh token', async () => {
    await service.login({
      email: user.email,
      password: 'correct-password',
    });

    expect(prisma.authSession.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        refreshTokenHash: 'refresh-token-hash',
      }),
    });

    const createCall = prisma.authSession.create.mock.calls[0]?.[0];

    expect(createCall?.data.refreshTokenHash).not.toBe('refresh-token');
  });
});
