import { describe, it, expect } from 'vitest';
import { planBrandPricingSave } from '@/lib/brandPricing';

describe('planBrandPricingSave', () => {
  it('A. 신규 브랜드 생성 — 절대 propagation 하지 않음', () => {
    const p = planBrandPricingSave({ mode: 'create', originalPrice: null, newPrice: 6900, scope: 'active_contracts' });
    expect(p).toEqual({
      priceChanged: false,
      callPricingRpc: false,
      applyToActiveContracts: false,
      showConfirmModal: false,
    });
  });

  it('B. 기존 브랜드 수정 — 기본값만 변경 (registry_only)', () => {
    const p = planBrandPricingSave({ mode: 'edit', originalPrice: 4900, newPrice: 6900, scope: 'registry_only' });
    expect(p.priceChanged).toBe(true);
    expect(p.callPricingRpc).toBe(true);
    expect(p.applyToActiveContracts).toBe(false); // 기존 계약 미반영
    expect(p.showConfirmModal).toBe(false);
  });

  it('C. 기존 브랜드 수정 — 활성 계약에도 적용 (확인 모달 필요)', () => {
    const p = planBrandPricingSave({ mode: 'edit', originalPrice: 4900, newPrice: 6900, scope: 'active_contracts' });
    expect(p.priceChanged).toBe(true);
    expect(p.callPricingRpc).toBe(true);
    expect(p.applyToActiveContracts).toBe(true);
    expect(p.showConfirmModal).toBe(true); // 위험 옵션 → 확인 필요
  });

  it('D. 동일 가격 저장 — 어떤 scope든 pricing RPC/propagation 호출 없음', () => {
    const same1 = planBrandPricingSave({ mode: 'edit', originalPrice: 4900, newPrice: 4900, scope: 'registry_only' });
    const same2 = planBrandPricingSave({ mode: 'edit', originalPrice: 4900, newPrice: 4900, scope: 'active_contracts' });
    for (const p of [same1, same2]) {
      expect(p.priceChanged).toBe(false);
      expect(p.callPricingRpc).toBe(false);
      expect(p.applyToActiveContracts).toBe(false);
      expect(p.showConfirmModal).toBe(false);
    }
  });

  it('edit + active_contracts 이지만 가격 미변경이면 propagation 안 함 (동의 옵션만으론 변경 금지)', () => {
    const p = planBrandPricingSave({ mode: 'edit', originalPrice: 6900, newPrice: 6900, scope: 'active_contracts' });
    expect(p.applyToActiveContracts).toBe(false);
    expect(p.callPricingRpc).toBe(false);
  });

  it('originalPrice 불명(null)+edit이면 변경으로 간주', () => {
    const p = planBrandPricingSave({ mode: 'edit', originalPrice: null, newPrice: 6900, scope: 'registry_only' });
    expect(p.priceChanged).toBe(true);
    expect(p.callPricingRpc).toBe(true);
  });
});
