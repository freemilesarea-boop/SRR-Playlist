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

export interface ArtistPlanInfo {
  plan_type: ArtistPlanType;
  plan_label: string;
  monthly_quota: number;
  can_create_playlist: boolean;
  can_apply_curator: boolean;
  is_verified_pro: boolean;
  is_legacy: boolean;
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

/** 코드 → 플랜 매핑 (가입 폼에서 코드 입력 즉시 플랜 안내) */
export interface CodePlanHint {
  plan_type: Exclude<ArtistPlanType, null>;
  plan_label: string;
  monthly_quota: number;
  description: string;
  highlights: string[];
}

const CODE_PLAN_MAP: Record<string, CodePlanHint> = {
  C69947: {
    plan_type: 'student_artist',
    plan_label: '수강생 아티스트 PRO',
    monthly_quota: 50,
    description: '수강생 전용 PRO 플랜 · 월 50곡 유통',
    highlights: [
      '월 50곡 유통',
      'VERIFIED 뱃지',
      '플레이리스트 제작 가능',
      '큐레이터 신청 가능',
      '우선 검수',
    ],
  },
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

export function getCodePlanHint(code: string): CodePlanHint | null {
  return CODE_PLAN_MAP[code.trim().toUpperCase()] ?? null;
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
