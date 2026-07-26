/**
 * aiRuntimeResolver.ts — Phase AI-RUNTIME-CONNECTION-1
 *
 * PURE runtime queue resolution logic (no network, no DOM, fully unit-testable).
 *
 * 역할: 이미 확보된 Static Playlist Tracks(TrackRow[])를, 승인된 Store 에서만,
 *   AI Candidate 순서로 안전하게 "재정렬(re-rank)"한다. 새 곡을 가져오지 않는다.
 *
 *   Static Playlist Tracks → AI Fit/Guardrail Re-ranking → Runtime Queue
 *
 * 안전 규칙:
 *   • Candidate Source 는 반드시 Static Playlist 내부 Track 으로 제한(track_id join).
 *     → audio_url 없는 Track / 존재하지 않는 Track / blocked Track 삽입 불가능.
 *   • runtime_score = fit_score − penalty_score. 새 Score Formula 없음(DB 값만 사용).
 *   • Tie-break: 원래 order_index → track_id. Randomness 없음.
 *   • 결과가 비면 즉시 Static Fallback. 재생 중단/Queue empty 금지.
 *   • Network / mode gate / persistence 는 여기 없음 — service 레이어 담당.
 */
import type { TrackRow } from '@/types/db';

// =============================================================================
// Types
// =============================================================================

export type AiRuntimeMode = 'off' | 'preview' | 'shadow';

export interface AiRuntimeModeInfo {
  storeId: string | null;
  mode: AiRuntimeMode;
  enabled: boolean;
  approved: boolean;
  maxAiTracks: number;
  minimumFitScore: number;
  source: string;
}

/** get_store_ai_runtime_queue / _ai_build_store_queue_core (0463) 의 queue item. */
export interface RuntimeCandidateItem {
  track_id: string;
  fit_score: number;
  fit_status: string; // active | review_needed | excluded | unscored
  guardrail_penalty: number;
}

export type RuntimeQueueSource = 'static' | 'ai_preview' | 'static_fallback';

export interface RuntimeCandidateSummary {
  staticCount: number;
  candidateCount: number;
  usedCount: number;
  droppedCount: number; // static tracks not present in the final AI queue
}

export interface RuntimeQueueResult {
  source: RuntimeQueueSource;
  tracks: TrackRow[];
  /** whether the caller's setQueue should apply the legacy daily-seeded shuffle. */
  seedShuffle: boolean;
  fallbackUsed: boolean;
  fallbackReason: string | null;
  summary: RuntimeCandidateSummary;
}

export interface ShadowComparison {
  staticCount: number;
  candidateCount: number;
  blockedCount: number;   // static tracks dropped by AI (blocked/excluded/below-min)
  penalizedCount: number; // candidates carrying a guardrail penalty
  topTrackDiffers: boolean;
  orderDiffCount: number; // positions where static vs AI track id differ
}

export const DEFAULT_MAX_AI_TRACKS = 50;

// =============================================================================
// Mode parsing (defensive, fail-closed to OFF)
// =============================================================================

function toNum(v: unknown, fallback: number): number {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : fallback;
}

/** get_store_ai_runtime_mode 의 jsonb 응답을 안전 파싱. 알 수 없으면 OFF. */
export function parseRuntimeMode(raw: unknown): AiRuntimeModeInfo {
  const off = (source: string): AiRuntimeModeInfo => ({
    storeId: null, mode: 'off', enabled: false, approved: false,
    maxAiTracks: DEFAULT_MAX_AI_TRACKS, minimumFitScore: 0, source,
  });
  if (!raw || typeof raw !== 'object') return off('malformed');
  const o = raw as Record<string, unknown>;
  const rawMode = o.mode;
  const mode: AiRuntimeMode =
    rawMode === 'preview' || rawMode === 'shadow' ? rawMode : 'off';
  return {
    storeId: typeof o.store_id === 'string' ? o.store_id : null,
    mode,
    enabled: o.enabled === true,
    approved: o.approved === true,
    maxAiTracks: Math.max(1, Math.round(toNum(o.max_ai_tracks, DEFAULT_MAX_AI_TRACKS))),
    minimumFitScore: toNum(o.minimum_fit_score, 0),
    source: typeof o.source === 'string' ? o.source : 'unknown',
  };
}

// =============================================================================
// Candidate item parsing
// =============================================================================

/** RPC jsonb → RuntimeCandidateItem[]. 형식 위반 항목은 조용히 제거. */
export function parseCandidateItems(raw: unknown): RuntimeCandidateItem[] {
  const arr =
    Array.isArray(raw) ? raw
    : raw && typeof raw === 'object' && Array.isArray((raw as { queue?: unknown }).queue)
      ? (raw as { queue: unknown[] }).queue
      : [];
  const out: RuntimeCandidateItem[] = [];
  for (const x of arr) {
    if (!x || typeof x !== 'object') continue;
    const o = x as Record<string, unknown>;
    if (typeof o.track_id !== 'string' || !o.track_id) continue;
    out.push({
      track_id: o.track_id,
      fit_score: toNum(o.fit_score, 0),
      fit_status: typeof o.fit_status === 'string' ? o.fit_status : 'unscored',
      guardrail_penalty: toNum(o.guardrail_penalty, 0),
    });
  }
  return out;
}

// =============================================================================
// Scoring / ordering (pure, deterministic)
// =============================================================================

/** runtime_score = fit_score − penalty_score (DB 값만 사용). */
export function runtimeScore(item: Pick<RuntimeCandidateItem, 'fit_score' | 'guardrail_penalty'>): number {
  return toNum(item.fit_score, 0) - toNum(item.guardrail_penalty, 0);
}

function hasUsableAudio(t: TrackRow): boolean {
  return typeof t.audio_url === 'string' && t.audio_url.trim().length > 0;
}

// =============================================================================
// Compose the AI-re-ranked runtime queue (PREVIEW application)
// =============================================================================

export interface ComposeOpts {
  minimumFitScore?: number;
  maxAiTracks?: number;
  /** currently-playing track id — kept out of dup counting; never forces restart. */
  currentTrackId?: string | null;
  /** minimum AI queue length below which we fall back to static (default 1 → never empty). */
  minQueueLength?: number;
}

/**
 * Static TrackRow[] 를 Candidate 순서로 재정렬한 Runtime Queue 를 만든다.
 * Candidate 는 이미 (0463 core) blocked 제외 + fit desc 정렬 상태.
 * 여기서 추가로: track_id join(Static 범위 강제), min_fit, audio 검증, dedupe, max cap.
 * 결과가 비거나 최소 길이 미달이면 Static Fallback.
 */
export function composeRuntimeQueue(
  staticTracks: TrackRow[],
  candidates: RuntimeCandidateItem[],
  opts: ComposeOpts = {},
): RuntimeQueueResult {
  const staticList = Array.isArray(staticTracks) ? staticTracks : [];
  const minFit = toNum(opts.minimumFitScore, 0);
  const maxTracks = Math.max(1, Math.round(toNum(opts.maxAiTracks, DEFAULT_MAX_AI_TRACKS)));
  const minLen = Math.max(1, Math.round(toNum(opts.minQueueLength, 1)));

  const staticFallback = (reason: string): RuntimeQueueResult => ({
    source: 'static_fallback',
    tracks: staticList,
    seedShuffle: true, // legacy path unchanged
    fallbackUsed: true,
    fallbackReason: reason,
    summary: {
      staticCount: staticList.length,
      candidateCount: candidates?.length ?? 0,
      usedCount: staticList.length,
      droppedCount: 0,
    },
  });

  if (staticList.length === 0) return staticFallback('empty_static');
  if (!Array.isArray(candidates) || candidates.length === 0) return staticFallback('empty_candidates');

  // Static 범위 강제: track_id → TrackRow. audio 없는 Track 은 애초에 후보 불가.
  const byId = new Map<string, TrackRow>();
  for (const t of staticList) {
    if (t && typeof t.id === 'string' && hasUsableAudio(t)) byId.set(t.id, t);
  }

  const used = new Set<string>();
  const tracks: TrackRow[] = [];
  for (const c of candidates) {
    if (tracks.length >= maxTracks) break;
    if (c.fit_status === 'excluded') continue;           // blocked/excluded
    if (runtimeScore(c) < minFit) continue;              // below threshold (fit − penalty)
    const row = byId.get(c.track_id);
    if (!row) continue;                                  // not in this playlist / no audio
    if (used.has(row.id)) continue;                      // dedupe
    used.add(row.id);
    tracks.push(row);
  }

  if (tracks.length < minLen) return staticFallback('insufficient_candidates');

  return {
    source: 'ai_preview',
    tracks,
    seedShuffle: false, // PREVIEW: AI order 후 shuffle 재적용 금지 (§7)
    fallbackUsed: false,
    fallbackReason: null,
    summary: {
      staticCount: staticList.length,
      candidateCount: candidates.length,
      usedCount: tracks.length,
      droppedCount: staticList.length - tracks.length,
    },
  };
}

/** OFF / SHADOW: 실제 재생 Queue 는 Static 그대로. */
export function staticRuntimeQueue(staticTracks: TrackRow[]): RuntimeQueueResult {
  const list = Array.isArray(staticTracks) ? staticTracks : [];
  return {
    source: 'static',
    tracks: list,
    seedShuffle: true,
    fallbackUsed: false,
    fallbackReason: null,
    summary: { staticCount: list.length, candidateCount: 0, usedCount: list.length, droppedCount: 0 },
  };
}

// =============================================================================
// Shadow comparison (telemetry only — no PII, no raw track dump)
// =============================================================================

export function computeShadowComparison(
  staticTracks: TrackRow[],
  candidates: RuntimeCandidateItem[],
  opts: ComposeOpts = {},
): ShadowComparison {
  const staticList = Array.isArray(staticTracks) ? staticTracks : [];
  const ai = composeRuntimeQueue(staticList, candidates, opts);
  const aiTracks = ai.source === 'ai_preview' ? ai.tracks : [];
  const staticIds = staticList.map((t) => t.id);
  const aiIds = aiTracks.map((t) => t.id);

  let orderDiff = 0;
  const n = Math.max(staticIds.length, aiIds.length);
  for (let i = 0; i < n; i++) {
    if (staticIds[i] !== aiIds[i]) orderDiff++;
  }

  return {
    staticCount: staticList.length,
    candidateCount: candidates?.length ?? 0,
    blockedCount: Math.max(0, staticList.length - aiTracks.length),
    penalizedCount: (candidates ?? []).filter((c) => toNum(c.guardrail_penalty, 0) > 0).length,
    topTrackDiffers: staticIds.length > 0 && aiIds.length > 0 && staticIds[0] !== aiIds[0],
    orderDiffCount: orderDiff,
  };
}
