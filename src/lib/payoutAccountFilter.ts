/**
 * payoutAccountFilter — '정산 계좌' 화면의 상태 필터 (순수 로직).
 *
 * 계좌 인증(verification_status)과 지급 요건(PII 완비)은 별개다. 둘을 섞어 보면
 * "인증은 됐는데 지급이 안 나가는" 상태가 눈에 안 띈다 — 실제로 그 24건이
 * 2026-06 부터 방치됐다(8/31 #525 · #527). 그래서 두 축을 조합한 상태를 명시적으로
 * 이름 붙여 필터로 노출한다.
 *
 * 판정은 서버가 내려주는 값만 쓴다(is_pii_complete = 실명·주민번호·계좌·원천징수 동의
 * 4개가 모두 있음). 홈 처리 대기 줄의 payout_incomplete(0489)와 같은 기준이라
 * 홈 숫자와 이 목록이 어긋나지 않는다.
 *
 * React/JSX 없음 — 유닛 테스트 대상.
 */

/** 계좌 목록 상태 필터. */
export type PayoutAccountFilter = 'all' | 'pending' | 'incomplete' | 'ready' | 'rejected';

/** 필터 판정에 필요한 최소 필드(AdminPayoutRow 의 부분집합). */
export interface PayoutAccountStatusFields {
  verification_status: string;
  is_pii_complete: boolean;
}

export const PAYOUT_ACCOUNT_FILTERS: Array<{ key: PayoutAccountFilter; label: string }> = [
  { key: 'all', label: '전체' },
  { key: 'pending', label: '확인 대기' },
  { key: 'incomplete', label: '정보 미완비' },
  { key: 'ready', label: '지급 가능' },
  { key: 'rejected', label: '거절' },
];

/**
 * 'incomplete' — 인증은 끝났지만 지급 요건 미충족(= 지급 보류). 이 화면의 존재 이유.
 * 'ready'      — 인증 + 요건 완비. 지급이 실제로 나갈 수 있는 상태.
 * 미인증(pending/rejected)은 요건 완비 여부와 무관하게 각자의 칸에만 들어간다 —
 * 아직 인증 단계라 '지급 보류'로 부를 상태가 아니다.
 */
export function matchesPayoutAccountFilter(
  row: PayoutAccountStatusFields,
  filter: PayoutAccountFilter,
): boolean {
  switch (filter) {
    case 'pending':    return row.verification_status === 'pending';
    case 'incomplete': return row.verification_status === 'verified' && !row.is_pii_complete;
    case 'ready':      return row.verification_status === 'verified' && row.is_pii_complete;
    case 'rejected':   return row.verification_status === 'rejected';
    case 'all':        return true;
    default:           return true;
  }
}

/** 필터별 건수. 배지/칩에 그대로 쓴다. */
export function countByPayoutAccountFilter<T extends PayoutAccountStatusFields>(
  rows: readonly T[],
): Record<PayoutAccountFilter, number> {
  const out = {} as Record<PayoutAccountFilter, number>;
  for (const f of PAYOUT_ACCOUNT_FILTERS) {
    out[f.key] = rows.filter((r) => matchesPayoutAccountFilter(r, f.key)).length;
  }
  return out;
}
