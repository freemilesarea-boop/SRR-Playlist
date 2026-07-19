/**
 * experimentRuntime — Stage 0 Safe Event Emission (Phase AI-EXPERIMENT-1).
 *
 * 원칙: **Event 전송이 Playback 보다 우선하지 않는다** — 모든 호출은 fire-and-forget
 * 이며 어떤 실패도 밖으로 던지지 않는다(재생 로직/Queue/Scheduler 무영향).
 * 재시도 상한 1회, Idempotency Key 로 중복 차단, RPC/테이블 부재(0569 미적용)나
 * Assignment 없음(일반 Store)은 조용한 no-op 이다. Shadow 는 실제 Treatment 로
 * 기록하지 않는다(서버가 재검증).
 */
import { supabase } from '@/lib/supabase';
import type { TrackRow } from '@/types/db';
import {
  adaptTreatmentQueue, evaluateRuntimeGate,
  TREATMENT_TIMEOUT_MS, GATE_LOOKUP_TIMEOUT_MS,
  type RuntimeRoute, type RuntimeFallbackReason,
} from '@/lib/experimentRuntimeRouting';

export interface RuntimeAssignment {
  experiment_id: string;
  stage: string;
  status: string;
  variant: 'control' | 'treatment' | 'shadow_treatment';
  assignment_id: string;
  emergency_stop: boolean;
  algorithm_version: string;
  weight_version: string;
}

let cachedAssignment: RuntimeAssignment | null | undefined;
const emittedKeys = new Set<string>();

/** 세션 내 1회 조회(실패/부재 → null = Control/기존 동작). */
export async function lookupRuntimeAssignment(): Promise<RuntimeAssignment | null> {
  if (cachedAssignment !== undefined) return cachedAssignment;
  try {
    const { data, error } = await supabase.rpc('experiment_runtime_lookup');
    if (error) { cachedAssignment = null; return null; }
    const a = (data as { assignment?: RuntimeAssignment | null } | null)?.assignment ?? null;
    cachedAssignment = a && a.status === 'running' && !a.emergency_stop ? a : null;
    return cachedAssignment;
  } catch {
    cachedAssignment = null;
    return null;
  }
}

/** 테스트/세션 전환용 캐시 리셋. */
export function resetRuntimeAssignmentCache(): void {
  cachedAssignment = undefined;
  emittedKeys.clear();
  cachedGate = undefined;
}

/* ── Internal Treatment Routing(Stage 2, AI-EXPERIMENT-2) ─────────────────
 * 승인된 internal_test Treatment Store 에 한해 Recommendation v2 Runtime Preview
 * 를 기존 Queue 계약으로 변환한다. **모든 실패 경로는 Control 로 종료**하며(Fail
 * Closed), Timeout/오류/부적격/무효 Queue 는 항상 controlTracks 를 반환한다.
 * 일반 Store 는 Gate 조회가 부적격 → 즉시 controlTracks(세션 캐시로 1회만 조회).
 */
interface RuntimeGate {
  eligible: boolean;
  reason: string | null;
  assignment: {
    experiment_id: string; assignment_id: string; variant: string;
    stage: string; algorithm_version: string; weight_version: string;
  } | null;
}
let cachedGate: RuntimeGate | null | undefined;

function withTimeout<T>(p: Promise<T>, ms: number, onTimeout: T): Promise<T> {
  return new Promise<T>((resolve) => {
    let settled = false;
    const timer = setTimeout(() => { if (!settled) { settled = true; resolve(onTimeout); } }, ms);
    p.then((v) => { if (!settled) { settled = true; clearTimeout(timer); resolve(v); } })
      .catch(() => { if (!settled) { settled = true; clearTimeout(timer); resolve(onTimeout); } });
  });
}

/** supabase RPC 를 Timeout 과 함께 실행 — 결과를 {data,error} 로 정규화(실패/초과 → error). */
async function rpcWithTimeout(
  invoke: () => PromiseLike<{ data: unknown; error: unknown }>, ms: number,
): Promise<{ data: unknown; error: unknown }> {
  return withTimeout(
    (async () => { const r = await invoke(); return { data: r.data as unknown, error: r.error as unknown }; })(),
    ms,
    { data: null, error: { message: 'timeout' } },
  );
}

/** Treatment Gate 조회(세션 1회 캐시). 실패/부적격 → null(=Control). */
async function lookupTreatmentGate(): Promise<RuntimeGate | null> {
  if (cachedGate !== undefined) return cachedGate;
  try {
    const res = await rpcWithTimeout(() => supabase.rpc('experiment_treatment_gate'), GATE_LOOKUP_TIMEOUT_MS);
    if (res.error || !res.data) { cachedGate = null; return null; }
    cachedGate = res.data as RuntimeGate;
    return cachedGate;
  } catch {
    cachedGate = null;
    return null;
  }
}

export interface RuntimeQueueInput {
  storeId: string;
  playlistId: string | null;
  sessionId: string | null;
  controlTracks: TrackRow[];
  currentTrackId: string | null;
  recentTrackIds: string[];
  targetCount: number;
}

export interface RuntimeQueueResult {
  tracks: TrackRow[];
  route: RuntimeRoute;
  fallbackReason: RuntimeFallbackReason | null;
  experimentId: string | null;
  assignmentId: string | null;
  algorithmVersion: string | null;
  weightVersion: string | null;
  durationMs: number;
}

const nowMs = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/**
 * Queue 결정 — Control(기존 v1) 또는 Treatment(v2 Runtime Preview).
 * 반환 tracks 는 **항상 재생 가능**하며, 실패 시 controlTracks 와 동일하다.
 * Runtime Event 는 fire-and-forget 로 관측 기록한다(Playback 무영향).
 */
export async function resolveStoreQueue(input: RuntimeQueueInput): Promise<RuntimeQueueResult> {
  const started = nowMs();
  const control = (reason: RuntimeFallbackReason | null, route: RuntimeRoute = 'fallback_control'): RuntimeQueueResult => ({
    tracks: input.controlTracks, route, fallbackReason: reason,
    experimentId: null, assignmentId: null, algorithmVersion: null, weightVersion: null,
    durationMs: Math.round(nowMs() - started),
  });

  try {
    const gate = await lookupTreatmentGate();
    const decision = evaluateRuntimeGate({
      lookupFailed: gate == null,
      eligible: gate?.eligible ?? false,
      reason: gate?.reason ?? null,
      variant: gate?.assignment?.variant ?? null,
    });
    if (decision.route !== 'treatment' || !gate?.assignment) {
      // 일반 Store 포함 — 조용히 Control. 관측 이벤트는 Assignment 있는 경우만 남긴다.
      if (gate?.assignment) void recordRuntimeEvent(gate.assignment.experiment_id, gate.assignment.assignment_id, 'fallback_control', decision.fallbackReason, input.sessionId, null, input.controlTracks.length);
      return control(decision.fallbackReason);
    }

    const a = gate.assignment;
    // v2 Runtime Preview — Timeout 초과 시 Control.
    const res = await rpcWithTimeout(() => supabase.rpc('experiment_treatment_recommend', {
      p_payload: {
        experiment_id: a.experiment_id, assignment_id: a.assignment_id,
        playlist_id: input.playlistId, current_track_id: input.currentTrackId,
        recent_track_ids: input.recentTrackIds, target_count: input.targetCount,
      } as never,
    }), TREATMENT_TIMEOUT_MS);

    if (res.error || !res.data) {
      void recordRuntimeEvent(a.experiment_id, a.assignment_id, 'fallback_control', 'treatment_timeout', input.sessionId, null, input.controlTracks.length);
      return control('treatment_timeout');
    }
    const payload = res.data as { route?: string; reason?: string; tracks?: Array<Record<string, unknown>> };
    if (payload.route !== 'treatment' || !Array.isArray(payload.tracks)) {
      const reason = (payload.reason as RuntimeFallbackReason) ?? 'treatment_error';
      void recordRuntimeEvent(a.experiment_id, a.assignment_id, 'fallback_control', reason, input.sessionId, null, input.controlTracks.length);
      return control(reason);
    }

    const adapted = adaptTreatmentQueue(payload.tracks, {
      experimentId: a.experiment_id, assignmentId: a.assignment_id,
      algorithmVersion: a.algorithm_version, weightVersion: a.weight_version,
      currentTrackId: input.currentTrackId, recentTrackIds: input.recentTrackIds,
      targetCount: input.targetCount,
    });
    if (!adapted.valid) {
      void recordRuntimeEvent(a.experiment_id, a.assignment_id, 'fallback_control', 'queue_adapter_failed', input.sessionId, false, input.controlTracks.length);
      return control('queue_adapter_failed');
    }

    // RuntimeQueueTrack → TrackRow(9 필수 필드만) — Player 계약 유지, 실험 Metadata 미강제.
    const tracks: TrackRow[] = adapted.tracks.map((t) => ({
      id: t.id, title: t.title, artist: t.artist, genre: t.genre, mood: t.mood,
      audio_url: t.audio_url, cover_url: t.cover_url, duration: t.duration, created_at: t.created_at,
    }));
    const durationMs = Math.round(nowMs() - started);
    void recordRuntimeEvent(a.experiment_id, a.assignment_id, 'treatment', null, input.sessionId, true, tracks.length, durationMs);
    return {
      tracks, route: 'treatment', fallbackReason: null,
      experimentId: a.experiment_id, assignmentId: a.assignment_id,
      algorithmVersion: a.algorithm_version, weightVersion: a.weight_version, durationMs,
    };
  } catch {
    return control('treatment_error');
  }
}

/** Runtime Event 관측 기록(fire-and-forget · 실패 silent). */
async function recordRuntimeEvent(
  experimentId: string, assignmentId: string, route: RuntimeRoute,
  fallbackReason: RuntimeFallbackReason | null, sessionId: string | null,
  queueContractValid: boolean | null, resultCount: number, treatmentDurationMs?: number,
): Promise<void> {
  try {
    await supabase.rpc('experiment_record_runtime_event', {
      p_payload: {
        experiment_id: experimentId, assignment_id: assignmentId, route,
        fallback_reason: fallbackReason, session_id: sessionId,
        queue_contract_valid: queueContractValid, result_count: resultCount,
        treatment_duration_ms: treatmentDurationMs ?? null,
      } as never,
    });
  } catch { /* Playback 무영향 */ }
}

export interface QueueExposureInput {
  storeId: string;
  playlistId: string | null;
  sessionId: string | null;
  trackIds: string[];
  source: 'scheduler' | 'playlist' | 'auto_continue';
  dayKey: string; // 재노출 dedup 용(예: YYYY-MM-DD + slot)
}

/** Idempotency Key — 동일 세션/일자/큐 위치 중복 차단(결정론). */
export function buildExposureKey(input: QueueExposureInput, trackId: string, position: number): string {
  return `q|${input.storeId}|${input.dayKey}|${input.playlistId ?? 'none'}|${trackId}|${position}`;
}

/**
 * Queue 구성 노출 기록(Stage 0). 상한 50곡, 실패 silent, 재시도 1회.
 * Assignment 가 없으면(일반 Store) 아무 것도 기록하지 않는다.
 */
export async function emitQueueExposures(input: QueueExposureInput): Promise<void> {
  try {
    const assignment = await lookupRuntimeAssignment();
    if (!assignment) return; // 일반 Store — 기존 동작 그대로, 기록 없음.
    const tracks = input.trackIds.slice(0, 50);
    for (let i = 0; i < tracks.length; i++) {
      const key = buildExposureKey(input, tracks[i], i);
      if (emittedKeys.has(key)) continue;
      emittedKeys.add(key);
      const payload = {
        idempotency_key: key,
        experiment_id: assignment.experiment_id,
        track_id: tracks[i],
        source: input.source,
        algorithm_version: assignment.algorithm_version,
        weight_version: assignment.weight_version,
        playlist_id: input.playlistId,
        queue_position: i,
        session_id: input.sessionId,
        exposed_at: new Date().toISOString(),
      };
      let attempt = 0;
      // 재시도 상한 1(총 2회) — 그 이상은 조용히 포기(Playback 우선).
      while (attempt < 2) {
        try {
          const { error } = await supabase.rpc('experiment_record_exposure', { p_payload: payload as never });
          if (!error) break;
          attempt += 1;
        } catch {
          attempt += 1;
        }
      }
    }
  } catch {
    // 어떤 실패도 Playback 에 전파하지 않는다.
  }
}
