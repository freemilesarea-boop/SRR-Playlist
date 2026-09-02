/**
 * 0495 — 계좌 변경 신청 관련 순수 로직 회귀 테스트.
 *
 * 변경 감지/상태 되돌림 자체는 DB 함수(submit_artist_payout_account_v2)가 하고
 * 마이그레이션 적용 시 트랜잭션 안에서 검증했다. 여기서는 프론트가 그 결과를
 * 잘못 읽지 않도록 하는 부분만 잠근다.
 */
import { describe, it, expect } from 'vitest';
import {
  PAYOUT_CHANGE_FIELD_LABEL,
  payoutChangeFieldLabels,
} from './artistApi';

describe('payoutChangeFieldLabels', () => {
  it('변경 항목을 한글로 보여준다', () => {
    expect(payoutChangeFieldLabels(['account_number'])).toBe('계좌번호');
    expect(payoutChangeFieldLabels(['bank_name', 'account_holder'])).toBe('은행 · 예금주');
  });

  it('빈 값이면 대시 — 가짜로 "변경 없음" 같은 말을 지어내지 않는다', () => {
    expect(payoutChangeFieldLabels([])).toBe('—');
    expect(payoutChangeFieldLabels(null)).toBe('—');
    expect(payoutChangeFieldLabels(undefined)).toBe('—');
  });

  it('모르는 필드는 그대로 노출한다 — 조용히 삼키면 관리자가 변경 사실을 놓친다', () => {
    expect(payoutChangeFieldLabels(['some_new_field'])).toBe('some_new_field');
  });

  it('DB 가 기록할 수 있는 모든 필드에 라벨이 있다', () => {
    // submit_artist_payout_account_v2 가 changed_fields 에 넣는 값 전체(0495).
    const emitted = [
      'account_number',
      'bank_name',
      'account_holder',
      'legal_name',
      'tax_withholding_type',
      'resident_registration_number',
    ];
    for (const f of emitted) {
      expect(PAYOUT_CHANGE_FIELD_LABEL[f]).toBeTruthy();
    }
  });
});
