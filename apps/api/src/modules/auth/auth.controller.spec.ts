import { AuthController } from './auth.controller.js';

describe('AuthController', () => {
  const authService = {
    login: vi.fn(),
  };

  const controller = new AuthController(authService as never);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('delegates login to AuthService', async () => {
    const input = {
      email: 'user@example.com',
      password: 'password',
    };

    const response = {
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresIn: 900,
      user: {
        id: 'user-id',
        email: input.email,
      },
      memberships: [],
    };

    authService.login.mockResolvedValue(response);

    await expect(controller.login(input)).resolves.toEqual(response);

    expect(authService.login).toHaveBeenCalledWith(input);
  });
});
