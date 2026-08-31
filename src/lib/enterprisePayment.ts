/**
 * 엔터프라이즈 정기결제 — 프론트 순수 헬퍼 (단위 테스트 대상).
 */
export type EnterpriseBillingMode = 'hq_consolidated' | 'per_store';
export type EnterprisePayerType = 'hq' | 'store';

export const BILLING_MODE_LABEL: Record<EnterpriseBillingMode, string> = {
  hq_consolidated: '본사 일괄청구',
  per_store: '가맹(매장) 개별청구',
};

export const PAYER_TYPE_LABEL: Record<EnterprisePayerType, string> = {
  hq: '본사',
  store: '가맹점',
};

export interface BillingConfigForm {
  billingEnabled: boolean;
  billingMode: EnterpriseBillingMode;
  hqMonthlyPrice: number | string;
  storeMonthlyPrice: number | string;
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

/** 관리자 청구설정 검증. billing 켜진 경우 해당 모드의 요금이 0보다 커야 함. */
export function validateBillingConfig(form: BillingConfigForm): ValidationResult {
  const errors: string[] = [];
  if (form.billingEnabled) {
    if (form.billingMode === 'hq_consolidated') {
      const p = Number(form.hqMonthlyPrice);
      if (!Number.isInteger(p) || p <= 0) errors.push('본사 월요금(0보다 큰 정수)을 입력해주세요.');
    } else {
      const p = Number(form.storeMonthlyPrice);
      if (!Number.isInteger(p) || p <= 0) errors.push('가맹 월요금(0보다 큰 정수)을 입력해주세요.');
    }
  }
  return { ok: errors.length === 0, errors };
}

/** 폼 → RPC 파라미터. 미사용 요금은 null 로 정규화. */
export function billingConfigToParams(form: BillingConfigForm) {
  const hq = form.hqMonthlyPrice === '' || form.hqMonthlyPrice == null ? null : Number(form.hqMonthlyPrice);
  const store = form.storeMonthlyPrice === '' || form.storeMonthlyPrice == null ? null : Number(form.storeMonthlyPrice);
  return {
    billing_enabled: !!form.billingEnabled,
    billing_mode: form.billingMode,
    hq_monthly_price: hq,
    store_monthly_price: store,
  };
}
