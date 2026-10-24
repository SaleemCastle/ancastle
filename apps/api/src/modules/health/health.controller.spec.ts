import { Test, type TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { HealthController } from './health.controller.js';

describe('HealthController', () => {
  let controller: HealthController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  describe('check', () => {
    it('should return the API health status', () => {
      const result = controller.getHealth();

      expect(result.status).toBe('ok');
      expect(result.service).toBe('ancastle-api');
      expect(result.timestamp).toBeDefined();
    });
  });
});
