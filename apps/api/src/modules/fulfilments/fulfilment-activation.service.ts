import { Injectable } from '@nestjs/common';
import { BusinessException } from '../../common/exceptions/business.exception.js';

/** Server deployment setting only. Never derive capability from a request. */
@Injectable()
export class FulfilmentActivationService {
  assertEnabled(): void {
    if (process.env.SALES_FULFILMENT_ENABLED !== 'true') {
      throw new BusinessException(
        'FULFILMENT_DISABLED',
        'Fulfilment posting is not enabled',
        503,
      );
    }
  }
}
