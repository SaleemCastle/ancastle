import { afterEach, describe, expect, it } from 'vitest';
import { createLoggerConfig } from './logger.config.js';

describe('createLoggerConfig', () => {
  const originalLogLevel = process.env.LOG_LEVEL;

  afterEach(() => {
    if (originalLogLevel === undefined) {
      delete process.env.LOG_LEVEL;
    } else {
      process.env.LOG_LEVEL = originalLogLevel;
    }
  });

  it('uses info as the default log level', () => {
    delete process.env.LOG_LEVEL;

    const config = createLoggerConfig();

    expect(config.pinoHttp).toMatchObject({
      level: 'info',
    });
  });

  it('uses the configured log level', () => {
    process.env.LOG_LEVEL = 'debug';

    const config = createLoggerConfig();

    expect(config.pinoHttp).toMatchObject({
      level: 'debug',
    });
  });

  it('configures sensitive values for redaction', () => {
    const config = createLoggerConfig();

    expect(config.pinoHttp).toMatchObject({
      redact: {
        censor: '[REDACTED]',
        paths: expect.arrayContaining([
          'req.headers.authorization',
          'req.headers.cookie',
          'req.body.password',
          'req.body.passwordConfirmation',
          'req.body.token',
          'req.body.accessToken',
          'req.body.refreshToken',
          'req.body.secret',
          'res.headers["set-cookie"]',
        ]),
      },
    });
  });
});
