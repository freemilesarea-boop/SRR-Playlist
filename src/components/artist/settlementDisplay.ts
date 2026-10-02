/**
 * 정산 화면이 공유하는 상수와 순수 함수.
 * 컴포넌트와 같은 파일에서 export 하면 fast refresh 가 깨져서 분리해 둔다.
 */
import type { MySettlementRow, SettlementStatus } from '@/lib/artistSettlementApi';

export function fmtKrw(n: number): string {
  return `₩${n.toLocaleString()}`;
}
export function fmtMonth(s: string): string {
  return s.slice(0, 7);
}

// 0388 — 아티스트 노출 허용 status (관리자 확정 완료된 상태만).
// 'pending' (계산 중) 은 정책상 노출 금지 — 서버 RPC + RLS 가 1차 차단,
// 이 필터링은 2중 방어선.
export const ALLOWED_ARTIST_STATUSES: ReadonlySet<SettlementStatus> = new Set<SettlementStatus>([
  'carried_over', 'payable', 'paid', 'held', 'disputed',
]);

export const STATUS_TONE: Record<SettlementStatus, string> = {
  pending: 'bg-ink/10 text-ink-dim',  // 노출 안 됨 — 안전 default
  carried_over: 'bg-amber-100 text-amber-900 dark:bg-amber-500/25 dark:text-amber-200',
  payable: 'bg-sky-100 text-sky-900 dark:bg-sky-500/25 dark:text-sky-200',
  paid: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-500/25 dark:text-emerald-300',
  held: 'bg-yellow-100 text-yellow-900 dark:bg-yellow-500/25 dark:text-yellow-200',
  disputed: 'bg-red-100 text-red-900 dark:bg-red-500/25 dark:text-red-300',
};

export const STATUS_LABEL: Record<SettlementStatus, string> = {
  pending: '확정 대기',                 // 노출되지 않지만, 만약 통과 시 "실시간" 단어 사용 금지
  carried_over: '5만원 미만 → 이월',
  payable: '지급 예정',
  paid: '지급 완료',
  held: '보류',
  disputed: '분쟁',
};

/**
 * 개요 화면의 '최근 확정 정산액' 카드용.
 * 서버가 내려준 행 중 가장 최근 달을 그대로 고른다 — 예상액을 추정하지 않는다.
 */
export function latestSettlement(rows: MySettlementRow[]): MySettlementRow | null {
  if (rows.length === 0) return null;
  return [...rows].sort((a, b) => b.settlement_month.localeCompare(a.settlement_month))[0];
}

/** 정산 행에서 '실제로 받는 금액' 을 고른다. 최소지급액 미달이면 지급이 아니라 이월이다. */
export function payoutOrCarry(r: MySettlementRow): { label: string; amount: number } {
  return r.meets_min_payout
    ? { label: '최종 지급액', amount: r.final_payout_amount }
    : { label: '다음달 이월', amount: r.carried_over_amount };
}
