import { Injectable } from '@nestjs/common';
import type {
  LoginInput,
  LogoutInput,
  RefreshTokenInput,
} from '@ancastle/validation';
import type { LoginResponse, RefreshTokenResponse } from '@ancastle/types';
import { BusinessException } from '../../common/exceptions/business.exception.js';
import { PrismaService } from '../../database/prisma.service.js';
import { PasswordService } from './password.service.js';
import { TokenService } from './token.service.js';
import { randomUUID } from 'node:crypto';
import { RefreshTokenPayload } from './auth.types.js';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwordService: PasswordService,
    private readonly tokenService: TokenService,
  ) {}

  async login(input: LoginInput): Promise<LoginResponse> {
    const email = input.email.trim().toLowerCase();

    const user = await this.prisma.user.findUnique({
      where: {
        email,
      },
      include: {
        memberships: {
          where: {
            isActive: true,
            organization: {
              isActive: true,
            },
          },
        },
      },
    });

    if (!user || !user.isActive) {
      throw this.invalidCredentials();
    }

    const passwordValid = await this.passwordService.verify(
      user.passwordHash,
      input.password,
    );

    if (!passwordValid) {
      throw this.invalidCredentials();
    }

    if (user.memberships.length === 0) {
      throw this.invalidCredentials();
    }

    const refreshTtlSeconds = Number(
      process.env.JWT_REFRESH_TTL_SECONDS ?? 604800,
    );

    const expiresAt = new Date(Date.now() + refreshTtlSeconds * 1000);

    const sessionId = randomUUID();

    const [accessToken, refreshToken] = await Promise.all([
      this.tokenService.createAccessToken(user.id, user.email),
      this.tokenService.createRefreshToken(user.id, sessionId),
    ]);

    await this.prisma.authSession.create({
      data: {
        id: sessionId,
        userId: user.id,
        refreshTokenHash: this.tokenService.hashRefreshToken(refreshToken),
        expiresAt,
      },
    });

    return {
      accessToken,
      refreshToken,
      expiresIn: Number(process.env.JWT_ACCESS_TTL_SECONDS ?? 900),
      user: {
        id: user.id,
        email: user.email,
      },
      memberships: user.memberships.map((membership) => ({
        organizationId: membership.organizationId,
        role: membership.role,
      })),
    };
  }

  private invalidCredentials(): BusinessException {
    return new BusinessException(
      'INVALID_CREDENTIALS',
      'Invalid email or password',
      401,
    );
  }

  private invalidSession(): BusinessException {
    return new BusinessException(
      'INVALID_SESSION',
      'Session is invalid or expired',
      401,
    );
  }

  async refresh(input: RefreshTokenInput): Promise<RefreshTokenResponse> {
    let payload: RefreshTokenPayload;

    try {
      payload = await this.tokenService.verifyRefreshToken(input.refreshToken);
    } catch {
      throw this.invalidSession();
    }

    if (payload.type !== 'refresh' || !payload.sub || !payload.sid) {
      throw this.invalidSession();
    }

    const session = await this.prisma.authSession.findUnique({
      where: {
        id: payload.sid,
      },
      include: {
        user: {
          include: {
            memberships: {
              where: {
                isActive: true,
                organization: {
                  isActive: true,
                },
              },
            },
          },
        },
      },
    });

    if (
      !session ||
      session.userId !== payload.sub ||
      session.revokedAt ||
      session.expiresAt <= new Date() ||
      !session.user.isActive ||
      session.user.memberships.length === 0
    ) {
      throw this.invalidSession();
    }

    if (
      !this.tokenService.refreshTokenMatches(
        input.refreshToken,
        session.refreshTokenHash,
      )
    ) {
      throw this.invalidSession();
    }

    const accessToken = await this.tokenService.createAccessToken(
      session.user.id,
      session.user.email,
    );

    const refreshToken = await this.tokenService.createRefreshToken(
      session.user.id,
      session.id,
    );

    const refreshTokenHash = this.tokenService.hashRefreshToken(refreshToken);

    const refreshTtlSeconds = Number(
      process.env.JWT_REFRESH_TTL_SECONDS ?? 604800,
    );

    // Exactly one request may consume the current hash. Recheck lifecycle at
    // replacement so a concurrent logout/deactivation cannot revive a session.
    const replaced = await this.prisma.authSession.updateMany({
      where: {
        id: session.id,
        userId: session.userId,
        refreshTokenHash: session.refreshTokenHash,
        revokedAt: null,
        expiresAt: { gt: new Date() },
        user: {
          isActive: true,
          memberships: {
            some: { isActive: true, organization: { isActive: true } },
          },
        },
      },
      data: {
        refreshTokenHash,
        expiresAt: new Date(Date.now() + refreshTtlSeconds * 1000),
      },
    });

    if (replaced.count !== 1) throw this.invalidSession();

    return {
      accessToken,
      refreshToken,
      expiresIn: Number(process.env.JWT_ACCESS_TTL_SECONDS ?? 900),
    };
  }

  async logout(input: LogoutInput): Promise<void> {
    let payload: RefreshTokenPayload;

    try {
      payload = await this.tokenService.verifyRefreshToken(input.refreshToken);
    } catch {
      return;
    }

    if (payload.type !== 'refresh' || !payload.sid) {
      return;
    }

    await this.prisma.authSession.updateMany({
      where: {
        id: payload.sid,
        userId: payload.sub,
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
      },
    });
  }
}
