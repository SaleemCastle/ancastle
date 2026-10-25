import { createHash, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { AccessTokenPayload, RefreshTokenPayload } from './auth.types.js';

@Injectable()
export class TokenService {
  constructor(private readonly jwtService: JwtService) {}

  async createAccessToken(userId: string, email: string): Promise<string> {
    const payload: AccessTokenPayload = {
      sub: userId,
      email,
      type: 'access',
    };

    return this.jwtService.signAsync(payload, {
      secret: process.env.JWT_SECRET,
      expiresIn: Number(process.env.JWT_ACCESS_TTL_SECONDS ?? 900),
    });
  }

  async verifyAccessToken(token: string): Promise<AccessTokenPayload> {
    return this.jwtService.verifyAsync<AccessTokenPayload>(token, {
      secret: process.env.JWT_SECRET,
    });
  }

  async createRefreshToken(userId: string, sessionId: string): Promise<string> {
    const payload: RefreshTokenPayload = {
      sub: userId,
      sid: sessionId,
      type: 'refresh',
    };

    return this.jwtService.signAsync(payload, {
      secret: process.env.JWT_REFRESH_SECRET,
      expiresIn: Number(process.env.JWT_REFRESH_TTL_SECONDS ?? 604800),
    });
  }

  hashRefreshToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  async verifyRefreshToken(token: string): Promise<RefreshTokenPayload> {
    return this.jwtService.verifyAsync<RefreshTokenPayload>(token, {
      secret: process.env.JWT_REFRESH_SECRET,
    });
  }

  refreshTokenMatches(token: string, storedHash: string): boolean {
    const suppliedHash = Buffer.from(this.hashRefreshToken(token), 'hex');

    const expectedHash = Buffer.from(storedHash, 'hex');

    if (suppliedHash.length !== expectedHash.length) {
      return false;
    }

    return timingSafeEqual(suppliedHash, expectedHash);
  }
}
