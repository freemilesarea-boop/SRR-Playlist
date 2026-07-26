/**
 * aiRuntimePreview.ts — Phase AI-PIPELINE-CONNECTION-1
 *
 * "AI 런타임 프리뷰"(관리자 전용, READ-ONLY) 를 위한 순수 로직 + 기능 플래그.
 *
 * 배경: 현재 파이프라인은  Store Fit → (DB 저장) → END  에서 끊겨 있다.
 *   이 단계는 한 칸만 더 연결한 READ-ONLY 프리뷰다:
 *     Store Fit → Candidate Pool → AI Candidate Queue
 *   실 재생(live playback)·큐·스케줄러·로테이션에는 전혀 손대지 않는다.
 *
 * 플래그 정책: 기본 OFF. 관리자가 명시적으로 켜야만 프리뷰 도구가 노출된다.
 *   (localStorage 기반 — 서버 상태·개인정보 저장 없음. 접근은 try/catch 로 안전 처리.)
 *
 * DB: supabase/migrations/0463_ai_candidate_pool_preview.sql
 *   RPC: admin_ai_store_candidate_pool / admin_ai_build_store_queue (admin-gated, read-only)
 */

// =============================================================================
// Types — mirror the read-only RPC JSON payloads (0463)
// =============================================================================

/** 후보 분류. 서버(_ai_store_candidate_pool_core)의 classification 과 1:1. */
export type CandidateClassification = 'eligible' | 'penalized' | 'blocked';

export interface CandidatePoolTrack {
  track_id: string;
  title: string | null;
  artist: string | null;
  order_index: number | null;
  fit_score: number | null;
  fit_status: string;
  guardrail_blocked: boolean;
  guardrail_penalty: number;
  guardrail_severity: string | null;
  classification: CandidateClassification;
}

export interface CandidatePoolCounts {
  eligible: number;
  penalized: number;
  blocked: number;
  total: number;
}

export interface CandidatePoolResult {
  store_id: string;
  playlist_id: string;
  store_business_category: string | null;
  store_type_canonical: string | null;
  counts: CandidatePoolCounts;
  tracks: CandidatePoolTrack[];
  computed_at: string;
}

export interface StoreQueueItem {
  position: number;
  track_id: string;
  title: string | null;
  artist: string | null;
  fit_score: number;
  fit_status: string;
  guardrail_penalty: number;
}

export interface StoreQueueResult {
  store_id: string;
  playlist_id: string;
  store_type_canonical: string | null;
  queue_length: number;
  queue: StoreQueueItem[];
  computed_at: string;
}

// =============================================================================
// Feature flag (OFF by default)
// =============================================================================

export const AI_PREVIEW_FLAG_KEY = 'ai.runtime.preview.enabled';

/** localStorage 를 안전하게 얻는다(SSR/차단 환경 대비). 없으면 null. */
function safeStorage(explicit?: Storage): Storage | null {
  if (explicit) return explicit;
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

/** 프리뷰 기능이 켜져 있는가. 기본 OFF — 오직 문자열 '1' 만 ON 으로 인정. */
export function isAiRuntimePreviewEnabled(storage?: Storage): boolean {
  const s = safeStorage(storage);
  if (!s) return false;
  try {
    return s.getItem(AI_PREVIEW_FLAG_KEY) === '1';
  } catch {
    return false;
  }
}

/** 프리뷰 기능 ON/OFF 저장. */
export function setAiRuntimePreviewEnabled(on: boolean, storage?: Storage): void {
  const s = safeStorage(storage);
  if (!s) return;
  try {
    if (on) s.setItem(AI_PREVIEW_FLAG_KEY, '1');
    else s.removeItem(AI_PREVIEW_FLAG_KEY);
  } catch {
    /* ignore quota / unavailable */
  }
}

// =============================================================================
// Pure presentation helpers (unit-testable, no DOM / no network)
// =============================================================================

const CLASSIFICATION_LABEL: Record<CandidateClassification, string> = {
  eligible: '재생 가능',
  penalized: '감점',
  blocked: '차단',
};

/** 분류 → 한글 라벨. 알 수 없는 값은 원문 passthrough(잘못된 추측 금지). */
export function classificationLabel(c: string): string {
  return CLASSIFICATION_LABEL[c as CandidateClassification] ?? c;
}

/**
 * 분류 → Tailwind 톤 클래스(배지용). 알 수 없는 값은 중립 톤.
 * adminTones.badge 규격(alpha /25, 고대비 text-*-100)에 맞춰 대비를 유지한다.
 */
export function classificationTone(c: string): string {
  switch (c) {
    case 'eligible':
      return 'bg-emerald-500/25 text-emerald-100 ring-1 ring-emerald-400/50';
    case 'penalized':
      return 'bg-amber-500/25 text-amber-100 ring-1 ring-amber-400/50';
    case 'blocked':
      return 'bg-rose-500/25 text-rose-100 ring-1 ring-rose-400/50';
    default:
      return 'bg-ink/15 text-ink-mute ring-1 ring-line/20';
  }
}

/** fit_score 표기. null/undefined → '—', 그 외는 정수 반올림 문자열. */
export function formatFitScore(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '—';
  return String(Math.round(n));
}

/** 재생 가능 비율(0~1). total 0 이면 0. 방어적으로 clamp. */
export function poolEligibleRatio(counts: CandidatePoolCounts): number {
  if (!counts || counts.total <= 0) return 0;
  const r = counts.eligible / counts.total;
  if (r < 0) return 0;
  if (r > 1) return 1;
  return r;
}

/** 카운트 요약 문자열. 예: "재생 가능 1 · 감점 1 · 차단 1 (총 3)". */
export function summarizePoolCounts(counts: CandidatePoolCounts): string {
  const e = counts?.eligible ?? 0;
  const p = counts?.penalized ?? 0;
  const b = counts?.blocked ?? 0;
  const t = counts?.total ?? e + p + b;
  return `재생 가능 ${e} · 감점 ${p} · 차단 ${b} (총 ${t})`;
}
