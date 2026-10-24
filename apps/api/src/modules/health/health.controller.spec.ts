import { HttpStatus } from '@nestjs/common';
import type { Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HealthController } from './health.controller.js';
import type { HealthService } from './health.service.js';

describe('HealthController', () => {
  let controller: HealthController;
  let healthService: {
    check: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    healthService = {
      check: vi.fn(),
    };

    controller = new HealthController(
      healthService as unknown as HealthService,
    );
  });

  function createResponseMock(): {
    response: Response;
    status: ReturnType<typeof vi.fn>;
    json: ReturnType<typeof vi.fn>;
  } {
    const status = vi.fn();
    const json = vi.fn();

    const response = {
      status,
      json,
    };

    status.mockReturnValue(response);
    json.mockReturnValue(response);

    return {
      response: response as unknown as Response,
      status,
      json,
    };
  }

  it('returns HTTP 200 when the application is healthy', async () => {
    const health = {
      status: 'ok' as const,
      service: 'ancastle-api',
      timestamp: '2026-10-24T18:00:00.000Z',
      dependencies: {
        database: 'up' as const,
        redis: 'up' as const,
      },
    };

    healthService.check.mockResolvedValue(health);

    const { response, status, json } = createResponseMock();

    await controller.getHealth(response);

    expect(status).toHaveBeenCalledWith(HttpStatus.OK);
    expect(json).toHaveBeenCalledWith(health);
  });

  it('returns HTTP 503 when the application is unhealthy', async () => {
    const health = {
      status: 'error' as const,
      service: 'ancastle-api',
      timestamp: '2026-10-24T18:00:00.000Z',
      dependencies: {
        database: 'down' as const,
        redis: 'up' as const,
      },
    };

    healthService.check.mockResolvedValue(health);

    const { response, status, json } = createResponseMock();

    await controller.getHealth(response);

    expect(status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
    expect(json).toHaveBeenCalledWith(health);
  });
});
