/**
 * artistPlanApi.ts — X6.10 Phase 2
 *
 * 아티스트 플랜 (general_artist / student_artist / legacy_student / admin) 의
 * 단일 진입점 API. UI 권한 분기 / 한도 / 표시 라벨 일관성을 위해 사용.
 */
import { supabase } from './supabase';

export type ArtistPlanType =
  | 'general_artist'
  | 'student_artist'
  | 'admin'
  | 'legacy_student'
  | null;

export type PaymentPlanType = 'individual' | 'business' | 'artist_general' | 'artist_student';

export interface ArtistPlanInfo {
  plan_type: ArtistPlanType;
  plan_label: string;
  monthly_quota: number;
  can_create_playlist: boolean;
  can_apply_curator: boolean;
  is_verified_pro: boolean;
  is_legacy: boolean;
  // X6.22 — 결제 금액 단일 진입점 (서버 get_my_artist_plan 가 결정)
  monthly_price: number;
  payment_plan_type: PaymentPlanType;
}

/** 현재 로그인 사용자의 아티스트 플랜 정보. 로그인 안 됐으면 null. */
export async function fetchMyArtistPlan(): Promise<ArtistPlanInfo | null> {
  const { data, error } = await supabase.rpc('get_my_artist_plan');
  if (error) {
    if (import.meta.env.DEV) console.warn('[artistPlan] fetch failed', error);
    return null;
  }
  const row = (data as ArtistPlanInfo[] | null)?.[0];
  return row ?? null;
}

/**
 * 코드 → 플랜 힌트 (가입 폼 즉시 안내용).
 *
 * 보안 정책 (X6.12):
 *   - 공개 코드만 클라이언트에 매핑 (PDWSFU = 일반 아티스트).
 *   - 비공개 코드 (예: 수강생 전용) 는 절대 클라이언트 번들에 포함하지 않음.
 *     사용자가 직접 입력하면 verify_sales_agent_code RPC 가 서버에서 plan_type 을
 *     해석해 반환 → 클라이언트는 결과만 표시.
 */
export interface CodePlanHint {
  plan_type: Exclude<ArtistPlanType, null>;
  plan_label: string;
  monthly_quota: number;
  description: string;
  highlights: string[];
}

const PUBLIC_PLAN_HINTS: Record<string, CodePlanHint> = {
  // 공개 가능한 일반 아티스트 코드만 노출.
  PDWSFU: {
    plan_type: 'general_artist',
    plan_label: '일반 아티스트',
    monthly_quota: 5,
    description: '월 6,900원 · 월 5곡 유통',
    highlights: [
      '월 6,900원',
      '월 5곡 유통',
      '최대 10일 이내 발매',
      '기본 검수 · 기본 정산',
      '플레이리스트 제작 불가',
      '큐레이터 신청 불가',
    ],
  },
};

/**
 * 입력된 코드가 공개 매핑 (PDWSFU) 에 있는지만 확인.
 * 매칭되지 않으면 null — 비공개 코드일 가능성이 있으므로 서버 검증으로 처리.
 */
export function getCodePlanHint(code: string): CodePlanHint | null {
  return PUBLIC_PLAN_HINTS[code.trim().toUpperCase()] ?? null;
}

/** 서버에서 받은 plan_type 으로 표시용 라벨/한도 생성 (코드 자체는 알 필요 없음). */
export function planHintFromServer(
  planType: Exclude<ArtistPlanType, null>,
  serverLabel?: string,
  serverQuota?: number,
): { plan_label: string; monthly_quota: number; is_pro: boolean } {
  const isPro = planType === 'student_artist';
  return {
    plan_label: serverLabel ?? (isPro ? '수강생 아티스트 PRO' : '일반 아티스트'),
    monthly_quota: serverQuota ?? (isPro ? 50 : 5),
    is_pro: isPro,
  };
}

export const PLAN_BADGE_TONE: Record<string, string> = {
  general_artist: 'bg-zinc-500/15 text-zinc-300 ring-zinc-500/30',
  student_artist: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30',
  admin: 'bg-violet-500/15 text-violet-300 ring-violet-500/30',
  legacy_student: 'bg-amber-500/15 text-amber-300 ring-amber-500/30',
  legacy: 'bg-ink/5 text-ink-mute ring-line/20',
};

export function planBadgeTone(plan: ArtistPlanType): string {
  return PLAN_BADGE_TONE[plan ?? 'legacy'] ?? PLAN_BADGE_TONE.legacy;
}
