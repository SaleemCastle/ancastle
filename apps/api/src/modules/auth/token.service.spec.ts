import { JwtService } from '@nestjs/jwt';
import { TokenService } from './token.service.js';

describe('TokenService', () => {
  let jwtService: JwtService;
  let service: TokenService;

  beforeAll(() => {
    process.env.JWT_SECRET = 'test-access-secret-at-least-32-characters-long';
    process.env.JWT_REFRESH_SECRET =
      'test-refresh-secret-at-least-32-characters-long';
    process.env.JWT_ACCESS_TTL_SECONDS = '900';
    process.env.JWT_REFRESH_TTL_SECONDS = '604800';

    jwtService = new JwtService();
    service = new TokenService(jwtService);
  });

  it('creates a valid access token', async () => {
    const token = await service.createAccessToken(
      'user-id',
      'user@example.com',
    );

    const payload = await jwtService.verifyAsync(token, {
      secret: process.env.JWT_SECRET,
    });

    expect(payload).toMatchObject({
      sub: 'user-id',
      email: 'user@example.com',
      type: 'access',
    });
  });

  it('creates a valid refresh token associated with a session', async () => {
    const token = await service.createRefreshToken('user-id', 'session-id');

    const payload = await jwtService.verifyAsync(token, {
      secret: process.env.JWT_REFRESH_SECRET,
    });

    expect(payload).toMatchObject({
      sub: 'user-id',
      sid: 'session-id',
      type: 'refresh',
    });
  });

  it('hashes refresh tokens using a deterministic SHA-256 digest', () => {
    const token = 'refresh-token';

    const firstHash = service.hashRefreshToken(token);
    const secondHash = service.hashRefreshToken(token);

    expect(firstHash).toBe(secondHash);
    expect(firstHash).not.toBe(token);
    expect(firstHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('verifies a valid access token', async () => {
    const token = await service.createAccessToken(
      'user-id',
      'user@example.com',
    );

    await expect(service.verifyAccessToken(token)).resolves.toMatchObject({
      sub: 'user-id',
      email: 'user@example.com',
      type: 'access',
    });
  });
  it('issues distinct refresh tokens for the same session in the same second', async () => {
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    try {
      const [first, second] = await Promise.all([
        service.createRefreshToken('user-id', 'session-id'),
        service.createRefreshToken('user-id', 'session-id'),
      ]);
      expect(first === second).toBe(false);
      const payload = await jwtService.verifyAsync(first, {
        secret: process.env.JWT_REFRESH_SECRET,
      });
      expect(payload.jti).toMatch(/^[a-f0-9-]{36}$/);
    } finally {
      clock.mockRestore();
    }
  });
});
