import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { BusinessException } from '../../common/exceptions/business.exception.js';

const taxPolicySchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('PENDING_POLICY') }).strict(),
  z
    .object({
      state: z.literal('APPROVED_POLICY_NOT_CALCULATED'),
      reference: z.string().trim().min(1).max(200),
      version: z.string().trim().min(1).max(64),
    })
    .strict(),
]);

@Injectable()
export class InvoiceActivationService {
  assertEnabled(): { reference: string; version: string } {
    if (process.env.M6_INVOICE_ISSUANCE_ENABLED !== 'true') {
      throw new BusinessException(
        'INVOICE_ISSUANCE_DISABLED',
        'Invoice issuance is not enabled',
        503,
      );
    }
    if (process.env.M6_INVOICE_TAX_POLICY_READY !== 'true') {
      throw new BusinessException(
        'INVOICE_TAX_POLICY_PENDING',
        'Approved tax policy is required before invoice issuance',
        503,
      );
    }
    let raw: unknown;
    try {
      raw = JSON.parse(
        process.env.M6_INVOICE_TAX_POLICY_CONFIG ??
          '{"state":"PENDING_POLICY"}',
      );
    } catch {
      throw new BusinessException(
        'INVOICE_TAX_POLICY_INVALID',
        'Tax policy configuration is invalid',
        503,
      );
    }
    const parsed = taxPolicySchema.safeParse(raw);
    if (!parsed.success) {
      throw new BusinessException(
        'INVOICE_TAX_POLICY_INVALID',
        'Tax policy configuration is invalid',
        503,
      );
    }
    if (parsed.data.state !== 'APPROVED_POLICY_NOT_CALCULATED') {
      throw new BusinessException(
        'INVOICE_TAX_POLICY_PENDING',
        'Approved tax policy is required before invoice issuance',
        503,
      );
    }
    return { reference: parsed.data.reference, version: parsed.data.version };
  }
}
