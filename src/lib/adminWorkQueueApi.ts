/**
 * adminWorkQueueApi — ADMIN-HOME-WORKQUEUE-1
 *
 * 관리자 홈 상단 "처리 대기" 줄의 데이터 소스.
 * 0489 admin_work_queue_counts() 한 번 호출로 모든 대기 건수를 가져온다
 * (탭마다 따로 열어보지 않아도 오늘 할 일이 홈에서 보이게).
 *
 * 각 카운트는 해당 탭이 이미 쓰는 판정 조건을 DB 쪽에서 그대로 재현한다 —
 * 홈 숫자와 탭 목록이 어긋나지 않게 하기 위함. 자세한 출처는 0489 주석 참조.
 */
import { supabase } from './supabase';

export interface AdminWorkQueueCounts {
  /** 음원 검수 대기 (track-review) */
  track_review: number;
  /** 아티스트 승인 대기 (artists) */
  artist_approval: number;
  /** 정산 정보 신청 대기 (정산 계좌 → 신청 대기) */
  payout_intake: number;
  /** 계좌 확인 대기 (정산 계좌 → 계좌 목록) */
  payout_verify: number;
  /** 계좌는 verified 인데 지급 요건 미완비 — 어느 탭에도 카운트가 없던 사각지대 */
  payout_incomplete: number;
  /**
   * 계좌 변경 신청 대기 (정산 계좌 → 변경 신청, 0495).
   * payout_verify 에 포함되는 값이지만 따로 센다 — 신규 등록과 달리
   * "이미 승인된 계좌가 바뀐 것" 이라 정산이 이미 잡혀 있을 수 있다.
   */
  payout_change: number;
  /** 지급 대기 정산월 (super admin 만 채워짐) */
  settlement_month: string | null;
  settlement_pending: number;
  settlement_held: number;
  settlement_amount: number;
  /** 문의 미처리 (open + in_progress) */
  inquiry_open: number;
  inquiry_urgent: number;
  store_offline: number;
  store_error: number;
  is_super_admin: boolean;
  computed_at: string;
}

const EMPTY: AdminWorkQueueCounts = {
  track_review: 0,
  artist_approval: 0,
  payout_intake: 0,
  payout_verify: 0,
  payout_incomplete: 0,
  payout_change: 0,
  settlement_month: null,
  settlement_pending: 0,
  settlement_held: 0,
  settlement_amount: 0,
  inquiry_open: 0,
  inquiry_urgent: 0,
  store_offline: 0,
  store_error: 0,
  is_super_admin: false,
  computed_at: '',
};

/**
 * 대기 건수 조회. 홈 진입마다 호출되므로 실패해도 홈을 깨지 않는다 —
 * null 을 돌려주고 호출측이 줄 자체를 감춘다(0 으로 위장하지 않음: 가짜 수치 금지).
 */
export async function fetchAdminWorkQueueCounts(): Promise<AdminWorkQueueCounts | null> {
  try {
    const { data, error } = await supabase.rpc('admin_work_queue_counts');
    if (error || !data) return null;
    return { ...EMPTY, ...(data as Partial<AdminWorkQueueCounts>) };
  } catch {
    return null;
  }
}
