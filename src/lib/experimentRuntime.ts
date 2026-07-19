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
