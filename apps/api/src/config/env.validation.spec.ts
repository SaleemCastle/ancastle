import { describe, expect, it } from 'vitest';
import { validateEnvironment } from './env.validation.js';

const validEnvironment = {
  NODE_ENV: 'test',
  API_PORT: '4000',
  WEB_APP_URL: 'http://localhost:3000',
  DATABASE_URL: 'postgresql://user:password@localhost:5432/ancastle',
  REDIS_URL: 'redis://localhost:6379',
  JWT_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
  LOG_LEVEL: 'info',
};

describe('validateEnvironment', () => {
  it('returns validated and transformed configuration', () => {
    const result = validateEnvironment(validEnvironment);

    expect(result).toMatchObject({
      NODE_ENV: 'test',
      API_PORT: 4000,
      WEB_APP_URL: 'http://localhost:3000',
      LOG_LEVEL: 'info',
    });
  });

  it('applies supported defaults', () => {
    const {
      NODE_ENV: _nodeEnv,
      API_PORT: _apiPort,
      LOG_LEVEL: _logLevel,
      ...environment
    } = validEnvironment;

    const result = validateEnvironment(environment);

    expect(result.NODE_ENV).toBe('development');
    expect(result.API_PORT).toBe(4000);
    expect(result.LOG_LEVEL).toBe('info');
  });

  it('rejects missing required configuration', () => {
    const { DATABASE_URL: _databaseUrl, ...environment } = validEnvironment;

    expect(() => validateEnvironment(environment)).toThrow(/DATABASE_URL/);
  });

  it('rejects invalid application configuration', () => {
    expect(() =>
      validateEnvironment({
        ...validEnvironment,
        API_PORT: '99999',
        WEB_APP_URL: 'not-a-url',
      }),
    ).toThrow(/Invalid environment configuration/);
  });

  it('rejects weak authentication secrets', () => {
    expect(() =>
      validateEnvironment({
        ...validEnvironment,
        JWT_SECRET: 'short',
      }),
    ).toThrow(/JWT_SECRET/);
  });
});
