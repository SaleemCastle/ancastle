import type { Params } from 'nestjs-pino';

export function createLoggerConfig(): Params {
  return {
    pinoHttp: {
      level: process.env.LOG_LEVEL ?? 'info',

      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'req.body.password',
          'req.body.passwordConfirmation',
          'req.body.token',
          'req.body.accessToken',
          'req.body.refreshToken',
          'req.body.secret',
          'res.headers["set-cookie"]',
        ],
        censor: '[REDACTED]',
      },

      serializers: {
        req(request) {
          return {
            id: request.id,
            method: request.method,
            url: request.url,
          };
        },

        res(response) {
          return {
            statusCode: response.statusCode,
          };
        },
      },

      customProps: () => ({
        service: 'ancastle-api',
      }),
    },
  };
}
