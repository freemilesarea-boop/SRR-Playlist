// Phase BRAND-PLAYER-UX-2 — 브랜드 사이니지 설정(전환효과/시간 + presentation 표시옵션) 순수 로직.
// 서버(0452 admin_upsert_brand_signage_settings / _brand_signage_json)의 정규화 규칙과 1:1 대응한다.
// UI(admin) 저장 전 프리뷰, Player 소비, 테스트 모두 이 단일 함수 집합만 사용 → source of truth.
import { normalizeSlideIndex } from '@/lib/brandSlideshow';
import type { SignageSettings, SignageTransitionEffect } from '@/types/brand';

/** 지원 전환 효과. slide/zoom/kenburns 등 미지원 효과는 노출/허용하지 않는다. */
export const SIGNAGE_TRANSITION_EFFECTS: readonly SignageTransitionEffect[] = ['none', 'fade'] as const;

/** 전환 애니메이션 시간(ms) 허용 범위 — 이미지 유지 시간(display_duration_seconds)과 별개. */
export const MIN_TRANSITION_MS = 0;
export const MAX_TRANSITION_MS = 2000;
export const DEFAULT_TRANSITION_MS = 500;
export const DEFAULT_TRANSITION_EFFECT: SignageTransitionEffect = 'fade';

/** 행이 없거나(레거시 브랜드) 값이 손상됐을 때 사용하는 기본 설정. 서버 _brand_signage_json default 와 동일. */
export const DEFAULT_SIGNAGE_SETTINGS: SignageSettings = {
  transition_effect: DEFAULT_TRANSITION_EFFECT,
  transition_duration_ms: DEFAULT_TRANSITION_MS,
  show_brand_name: false,
  show_now_playing: false,
  show_clock: false,
  show_slide_dots: false,
};

/** none/fade 만 허용, 그 외(대소문자·공백·미지원 효과·null)는 fade. */
export function normalizeTransitionEffect(v: unknown): SignageTransitionEffect {
  const s = typeof v === 'string' ? v.trim().toLowerCase() : '';
  return s === 'none' || s === 'fade' ? s : DEFAULT_TRANSITION_EFFECT;
}

/** 0~2000 clamp(정수). null/undefined/빈문자열/NaN 은 기본값 500. 유효한 숫자 0 은 그대로 보존. */
export function normalizeTransitionMs(v: unknown): number {
  if (v === null || v === undefined || v === '') return DEFAULT_TRANSITION_MS;
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return DEFAULT_TRANSITION_MS;
  return Math.min(Math.max(Math.round(n), MIN_TRANSITION_MS), MAX_TRANSITION_MS);
}

/** 표시 옵션은 명시적 true 일 때만 켬 — 누락/null/문자열 등은 전부 off(default). */
function normalizeToggle(v: unknown): boolean {
  return v === true;
}

/**
 * 임의의(서버/캐시/레거시/null) signage 값을 안전한 SignageSettings 로 정규화.
 * - 객체가 아니면 전부 default.
 * - effect none/fade 외 → fade, duration 0~2000 clamp(비유효 → 500), 토글은 true 일 때만 on.
 */
export function normalizeSignageSettings(raw: unknown): SignageSettings {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return {
    transition_effect: normalizeTransitionEffect(o.transition_effect),
    transition_duration_ms: normalizeTransitionMs(o.transition_duration_ms),
    show_brand_name: normalizeToggle(o.show_brand_name),
    show_now_playing: normalizeToggle(o.show_now_playing),
    show_clock: normalizeToggle(o.show_clock),
    show_slide_dots: normalizeToggle(o.show_slide_dots),
  };
}

/**
 * 현재 인덱스 기준 "미리 로드 + DOM 유지" 대상인 다음 이미지 인덱스 목록.
 * - 기본 next 1장. includeSecond=true 면 next+1 까지(총 2장) — 전부 100장을 한 번에 로드하지 않는다.
 * - [0,count) 정규화 + 현재 인덱스 제외 + 중복 제거(예: count=2 면 1장으로 축소).
 * - count<=1 이면 순환/미리 로드 불필요 → 빈 배열.
 */
export function slidePreloadIndexes(current: number, count: number, includeSecond = false): number[] {
  if (count <= 1) return [];
  const cur = normalizeSlideIndex(current, count);
  const out: number[] = [];
  const push = (i: number) => {
    const n = normalizeSlideIndex(i, count);
    if (n !== cur && !out.includes(n)) out.push(n);
  };
  push(cur + 1);
  if (includeSecond) push(cur + 2);
  return out;
}

/** 이미지 장수별 진행 표시 방식. 2장 미만 없음, 20장 이상 카운터, 그 사이 도트. */
export const SLIDE_DOTS_MIN = 2;
export const SLIDE_COUNTER_THRESHOLD = 20;
export type SlideProgressMode = 'none' | 'dots' | 'counter';
export function slideProgressMode(count: number): SlideProgressMode {
  if (count < SLIDE_DOTS_MIN) return 'none';
  return count >= SLIDE_COUNTER_THRESHOLD ? 'counter' : 'dots';
}

/** 시계 표시 포맷 — HH:mm(24h, 초 없음). 인자로 Date 를 받아 테스트 가능. */
export function formatClockHhMm(d: Date): string {
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}
