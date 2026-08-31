import { describe, it, expect } from 'vitest';
import {
  BILLING_MODE_LABEL, PAYER_TYPE_LABEL, validateBillingConfig, billingConfigToParams,
  type BillingConfigForm,
} from './enterprisePayment';

describe('labels', () => {
  it('has billing mode + payer labels', () => {
    expect(BILLING_MODE_LABEL.hq_consolidated).toBe('본사 일괄청구');
    expect(BILLING_MODE_LABEL.per_store).toBe('가맹(매장) 개별청구');
    expect(PAYER_TYPE_LABEL.hq).toBe('본사');
    expect(PAYER_TYPE_LABEL.store).toBe('가맹점');
  });
});

describe('validateBillingConfig', () => {
  it('passes when billing disabled regardless of prices', () => {
    const f: BillingConfigForm = { billingEnabled: false, billingMode: 'hq_consolidated', hqMonthlyPrice: '', storeMonthlyPrice: '' };
    expect(validateBillingConfig(f).ok).toBe(true);
  });
  it('requires hq price when enabled + hq_consolidated', () => {
    expect(validateBillingConfig({ billingEnabled: true, billingMode: 'hq_consolidated', hqMonthlyPrice: 0, storeMonthlyPrice: '' }).ok).toBe(false);
    expect(validateBillingConfig({ billingEnabled: true, billingMode: 'hq_consolidated', hqMonthlyPrice: 99000, storeMonthlyPrice: '' }).ok).toBe(true);
  });
  it('requires store price when enabled + per_store', () => {
    expect(validateBillingConfig({ billingEnabled: true, billingMode: 'per_store', hqMonthlyPrice: '', storeMonthlyPrice: '' }).ok).toBe(false);
    expect(validateBillingConfig({ billingEnabled: true, billingMode: 'per_store', hqMonthlyPrice: '', storeMonthlyPrice: 4900 }).ok).toBe(true);
  });
  it('rejects non-integer price', () => {
    expect(validateBillingConfig({ billingEnabled: true, billingMode: 'hq_consolidated', hqMonthlyPrice: 100.5, storeMonthlyPrice: '' }).ok).toBe(false);
  });
});

describe('billingConfigToParams', () => {
  it('normalizes empty prices to null', () => {
    const p = billingConfigToParams({ billingEnabled: true, billingMode: 'hq_consolidated', hqMonthlyPrice: '99000', storeMonthlyPrice: '' });
    expect(p).toEqual({ billing_enabled: true, billing_mode: 'hq_consolidated', hq_monthly_price: 99000, store_monthly_price: null });
  });
  it('keeps both prices when provided', () => {
    const p = billingConfigToParams({ billingEnabled: false, billingMode: 'per_store', hqMonthlyPrice: 99000, storeMonthlyPrice: 4900 });
    expect(p.hq_monthly_price).toBe(99000);
    expect(p.store_monthly_price).toBe(4900);
    expect(p.billing_enabled).toBe(false);
  });
});
