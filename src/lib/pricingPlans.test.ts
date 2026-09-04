import { describe, it, expect } from 'vitest';
import {
  storeCardState, storeMonthlyPrice, storeCheckoutBlockedReason,
  hqCardState, hqAwaitingPriceSetup, hqCanPayNow, canApplyHq, validateHqApplyForm,
  isBusinessNumberChecksumValid, isBusinessVerificationUsable,
  franchiseCardState, franchiseCanPayNow, franchiseAlreadyPaying, franchisePaymentNotice,
  normalizeJoinCode,
  type PricingContext, type HqApplyForm,
} from './pricingPlans';

function ctx(over: Partial<PricingContext> = {}): PricingContext {
  return { signed_in: true, account_type: 'individual', membership_tier: 'free', store_monthly_price: 6900, ...over };
}

describe('매장 가입 카드', () => {
  it('구독이 없으면 결제 가능', () => {
    expect(storeCardState(ctx())).toBe('available');
  });

  it('business 구독이 있으면 이용 중', () => {
    expect(storeCardState(ctx({
      subscription: { plan_type: 'business', status: 'active', price: 6900, current_period_end: '2099-01-01', cancel_requested_at: null },
    }))).toBe('active');
  });

  it('membership_tier=business 만으로도 이용 중으로 본다', () => {
    expect(storeCardState(ctx({ membership_tier: 'business' }))).toBe('active');
  });

  it('일반 요금제 이용 중이면 전환(upgrade)', () => {
    expect(storeCardState(ctx({
      membership_tier: 'individual',
      subscription: { plan_type: 'individual', status: 'active', price: 4900, current_period_end: '2099-01-01', cancel_requested_at: null },
    }))).toBe('upgrade');
  });

  it('아티스트 요금제 구독자는 매장 카드에서 upgrade 로 표시 — 이용 중으로 잠기지 않는다', () => {
    expect(storeCardState(ctx({
      account_type: 'artist', membership_tier: 'individual',
      subscription: { plan_type: 'artist_general', status: 'active', price: 6900, current_period_end: '2099-01-01', cancel_requested_at: null },
    }))).toBe('upgrade');
  });

  it('가격은 서버 값을 쓰고, 없으면 기본값', () => {
    expect(storeMonthlyPrice(ctx({ store_monthly_price: 7900 }))).toBe(7900);
    expect(storeMonthlyPrice(ctx({ store_monthly_price: 0 }))).toBe(6900);
    expect(storeMonthlyPrice(null)).toBe(6900);
  });

  it('엔터프라이즈 소속이면 단독 매장 결제를 막는다 (이중청구 방지)', () => {
    expect(storeCheckoutBlockedReason(ctx({ store: { store_name: 'A점', enterprise_name: '카공시대' } })))
      .toContain('카공시대');
    expect(storeCheckoutBlockedReason(ctx({
      hq: { enterprise_account_id: 'x', enterprise_name: 'B', status: 'invited', join_code: 'DD-AAAAAA', billing_mode: 'per_store', billing_enabled: true, store_monthly_price: 6900, hq_monthly_price: null },
    }))).not.toBeNull();
    expect(storeCheckoutBlockedReason(ctx())).toBeNull();
  });
});

describe('엔터프라이즈 본사 카드', () => {
  const hq = {
    enterprise_account_id: 'ea1', enterprise_name: '카공시대',
    status: 'invited' as const, join_code: 'DD-7K2M9Q',
    billing_mode: 'per_store' as const, billing_enabled: true,
    store_monthly_price: 6900, hq_monthly_price: null,
  };

  it('본사 기록이 없으면 신청 전', () => expect(hqCardState(ctx())).toBe('none'));
  it('invited 는 승인 대기', () => expect(hqCardState(ctx({ hq }))).toBe('pending'));
  it('active 는 승인 완료', () => expect(hqCardState(ctx({ hq: { ...hq, status: 'active' } }))).toBe('active'));
  it('suspended 는 blocked', () => expect(hqCardState(ctx({ hq: { ...hq, status: 'suspended' } }))).toBe('blocked'));

  it('본사 일괄청구인데 요금 미확정이면 안내 대상', () => {
    expect(hqAwaitingPriceSetup(ctx({ hq: { ...hq, billing_mode: 'hq_consolidated', billing_enabled: false } }))).toBe(true);
    expect(hqAwaitingPriceSetup(ctx({ hq }))).toBe(false);
  });

  it('본사가 결제 주체일 때만 결제 CTA', () => {
    expect(hqCanPayNow(ctx({ enterprise_payment: { should_pay: true, payer_type: 'hq', amount: 50000 } }))).toBe(true);
    expect(hqCanPayNow(ctx({ enterprise_payment: { should_pay: true, payer_type: 'store', amount: 6900 } }))).toBe(false);
    expect(hqCanPayNow(ctx({ enterprise_payment: { should_pay: false } }))).toBe(false);
  });

  it('아티스트/이미 가맹인 계정은 본사 신청 불가', () => {
    expect(canApplyHq(ctx())).toBe(true);
    expect(canApplyHq(ctx({ account_type: 'artist' }))).toBe(false);
    expect(canApplyHq(ctx({ store: { store_name: 'A', enterprise_name: 'B' } }))).toBe(false);
    expect(canApplyHq(ctx({ hq }))).toBe(false);
    expect(canApplyHq({ signed_in: false })).toBe(false);
  });
});

describe('본사 신청 폼 검증', () => {
  const good: HqApplyForm = {
    enterpriseName: '카공시대', businessNumber: '234-52-00922', businessName: '루베르',
    representativeName: '홍길동', businessOpenDate: '2020-01-02', businessAddress: '서울',
    managerName: '김담당', managerPhone: '010-1234-5678', billingMode: 'per_store',
  };

  it('정상 폼은 오류 없음', () => expect(validateHqApplyForm(good)).toEqual([]));
  it('본사명 누락', () => expect(validateHqApplyForm({ ...good, enterpriseName: ' ' })).toContain('본사(브랜드)명을 입력해주세요.'));
  it('사업자번호 체크섬 불일치', () => expect(validateHqApplyForm({ ...good, businessNumber: '123-45-67890' }).length).toBe(1));
  it('개업일자 형식', () => expect(validateHqApplyForm({ ...good, businessOpenDate: '2020/01/02' }).length).toBe(1));
  it('연락처 자릿수', () => expect(validateHqApplyForm({ ...good, managerPhone: '010' }).length).toBe(1));
});

describe('사업자등록번호 체크섬 (서버 _kr_business_number_valid 와 동일해야 한다)', () => {
  it('유효한 번호', () => {
    expect(isBusinessNumberChecksumValid('234-52-00922')).toBe(true);
    expect(isBusinessNumberChecksumValid('2345200922')).toBe(true);
  });
  it('무효한 번호', () => {
    expect(isBusinessNumberChecksumValid('123-45-67890')).toBe(false);
    expect(isBusinessNumberChecksumValid('000-00-00000')).toBe(false);   // 체크섬은 통과하지만 명시적으로 막는다
    expect(isBusinessNumberChecksumValid('234-52-00923')).toBe(false);
    expect(isBusinessNumberChecksumValid('234-52-0092')).toBe(false);
    expect(isBusinessNumberChecksumValid('')).toBe(false);
  });
});

describe('사업자 인증 상태', () => {
  it('verified / manual_review 만 신청 가능 — pending·rejected 는 불가', () => {
    expect(isBusinessVerificationUsable({ verification_status: 'verified', business_verified: true, business_number: '1', business_name: null })).toBe(true);
    expect(isBusinessVerificationUsable({ verification_status: 'manual_review', business_verified: false, business_number: '1', business_name: null })).toBe(true);
    expect(isBusinessVerificationUsable({ verification_status: 'pending', business_verified: false, business_number: '1', business_name: null })).toBe(false);
    expect(isBusinessVerificationUsable({ verification_status: 'rejected', business_verified: false, business_number: '1', business_name: null })).toBe(false);
    expect(isBusinessVerificationUsable(null)).toBe(false);
  });
});

describe('엔터프라이즈 가맹 카드', () => {
  it('연결 전/후 상태', () => {
    expect(franchiseCardState(ctx())).toBe('none');
    expect(franchiseCardState(ctx({ store: { store_name: 'A점', enterprise_name: '카공시대' } }))).toBe('joined');
    expect(franchiseCardState(ctx({ account_type: 'artist' }))).toBe('blocked');
  });

  it('가맹점이 결제 주체일 때만 결제 CTA', () => {
    expect(franchiseCanPayNow(ctx({ enterprise_payment: { should_pay: true, payer_type: 'store', amount: 6900 } }))).toBe(true);
    expect(franchiseCanPayNow(ctx({ enterprise_payment: { should_pay: true, payer_type: 'hq', amount: 6900 } }))).toBe(false);
  });

  it('이미 결제 등록된 가맹점 안내', () => {
    const c = ctx({ store: { store_name: 'A점', enterprise_name: 'B' }, enterprise_payment: { should_pay: false, already_active: true } });
    expect(franchiseAlreadyPaying(c)).toBe(true);
    expect(franchisePaymentNotice(c)).toContain('정기결제가 등록');
  });

  it('본사 일괄청구면 가맹점은 결제 안내를 받지 않는다', () => {
    const c = ctx({ store: { store_name: 'A점', enterprise_name: 'B' }, enterprise_payment: { should_pay: false } });
    expect(franchisePaymentNotice(c)).toContain('별도 결제는 필요하지 않습니다');
  });

  it('결제 대상이면 안내 문구 없이 결제 버튼만', () => {
    const c = ctx({ store: { store_name: 'A점', enterprise_name: 'B' }, enterprise_payment: { should_pay: true, payer_type: 'store', amount: 6900 } });
    expect(franchisePaymentNotice(c)).toBeNull();
  });
});

describe('본사 코드 정규화', () => {
  it('공백 제거 + 대문자 (서버 매칭 기준과 동일)', () => {
    expect(normalizeJoinCode('  dd-7k2m9q ')).toBe('DD-7K2M9Q');
    expect(normalizeJoinCode('')).toBe('');
  });
});
