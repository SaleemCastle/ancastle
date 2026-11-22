import { afterEach, describe, expect, it } from 'vitest';
import { InvoiceActivationService } from './invoice-activation.service.js';

const names = [
  'M6_INVOICE_ISSUANCE_ENABLED',
  'M6_INVOICE_TAX_POLICY_READY',
  'M6_INVOICE_TAX_POLICY_CONFIG',
] as const;
const saved = Object.fromEntries(
  names.map((name) => [name, process.env[name]]),
);
afterEach(() => {
  for (const name of names) {
    const value = saved[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});
const configured = (
  policy = '{"state":"APPROVED_POLICY_NOT_CALCULATED","reference":"accounting-approval-1","version":"1"}',
) => {
  process.env.M6_INVOICE_ISSUANCE_ENABLED = 'true';
  process.env.M6_INVOICE_TAX_POLICY_READY = 'true';
  process.env.M6_INVOICE_TAX_POLICY_CONFIG = policy;
};

describe('InvoiceActivationService', () => {
  it('defaults to disabled issuance', () => {
    delete process.env.M6_INVOICE_ISSUANCE_ENABLED;
    expect(() => new InvoiceActivationService().assertEnabled()).toThrowError(
      expect.objectContaining({ code: 'INVOICE_ISSUANCE_DISABLED' }),
    );
  });
  it('does not authorize issuance from the readiness flag when policy is unresolved', () => {
    configured('{"state":"PENDING_POLICY"}');
    expect(() => new InvoiceActivationService().assertEnabled()).toThrowError(
      expect.objectContaining({ code: 'INVOICE_TAX_POLICY_PENDING' }),
    );
  });
  it.each([
    '{',
    'null',
    '{"state":"APPROVED_POLICY_NOT_CALCULATED"}',
    '{"state":"APPROVED_POLICY_NOT_CALCULATED","reference":"x","version":""}',
    '{"state":"APPROVED_POLICY_NOT_CALCULATED","reference":"x","version":"1","rate":0}',
  ])('rejects invalid explicit tax policy %s', (policy) => {
    configured(policy);
    expect(() => new InvoiceActivationService().assertEnabled()).toThrowError(
      expect.objectContaining({ code: 'INVOICE_TAX_POLICY_INVALID' }),
    );
  });
  it('requires tax readiness in addition to a valid approved policy snapshot', () => {
    configured();
    process.env.M6_INVOICE_TAX_POLICY_READY = 'false';
    expect(() => new InvoiceActivationService().assertEnabled()).toThrowError(
      expect.objectContaining({ code: 'INVOICE_TAX_POLICY_PENDING' }),
    );
  });
  it('returns validated reference/version without inventing a rate or compliance claim', () => {
    configured();
    expect(new InvoiceActivationService().assertEnabled()).toEqual({
      reference: 'accounting-approval-1',
      version: '1',
    });
  });
});
