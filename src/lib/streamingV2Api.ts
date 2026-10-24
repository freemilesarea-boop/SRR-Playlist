// Phase ALGO-2A — Streaming v2 Shadow API.
// 기존 trackStream(v1)과 병행하는 shadow 기록. 100% fire-and-forget:
//   · streaming_v2_shadow_enabled=false(기본) 이면 아무것도 하지 않음
//   · 모든 호출 try/catch — throw 없음, console spam 없음
//   · v1 record_stream_event_safe / 재생 / 정산 / 차트에 영향 0
import { supabase } from './supabase';
import { getSessionId, getAnonymousId } from './analytics';

// ── device id (브라우저 영속, anonymous_id 와 별개) ──────────────────
const DEVICE_ID_KEY = 'srr.device.id';
function getDeviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_ID_KEY);
    if (!id) {
      id = (crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36));
      localStorage.setItem(DEVICE_ID_KEY, id);
    }
    return id;
  } catch {
    return 'dev-' + Math.random().toString(36).slice(2);
  }
}

function deviceClass(): string {
  if (typeof navigator === 'undefined') return 'unknown';
  const ua = navigator.userAgent;
  if (/iPad|Tablet/i.test(ua)) return 'tablet';
  if (/Mobi|Android|iPhone/i.test(ua)) return 'mobile';
  return 'desktop';
}

export type V2PlayerType = 'USER' | 'STORE' | 'BRAND' | 'ENTERPRISE' | 'ADMIN_PREVIEW' | 'ARTIST_PREVIEW' | 'SYSTEM';

/** 클라 추정 player_type (서버가 source_page/소유권으로 재검증·하향). */
function resolvePlayerType(): V2PlayerType {
  if (typeof window === 'undefined') return 'SYSTEM';
  const p = window.location.pathname;
  if (p.startsWith('/admin')) return 'ADMIN_PREVIEW';
  if (p.startsWith('/artist')) return 'ARTIST_PREVIEW';
  if (p.startsWith('/brand/player')) return 'BRAND';
  if (p.startsWith('/business/player')) return 'STORE';
  return 'USER';
}

function sourcePage(): string | null {
  return typeof window !== 'undefined' ? window.location.pathname : null;
}
function userAgent(): string | null {
  return typeof navigator !== 'undefined' ? navigator.userAgent : null;
}
function visibility(): string {
  return typeof document !== 'undefined' ? document.visibilityState : 'visible';
}

// ── feature flag (캐시, 실패/미설정 시 OFF) ─────────────────────────
let flagCache: { value: boolean; at: number } | null = null;
const FLAG_TTL_MS = 60_000;
async function shadowEnabled(): Promise<boolean> {
  const now = Date.now();
  if (flagCache && now - flagCache.at < FLAG_TTL_MS) return flagCache.value;
  try {
    const { data } = await supabase.rpc('get_streaming_v2_flag');
    const value = data === true;
    flagCache = { value, at: now };
    return value;
  } catch {
    flagCache = { value: false, at: now };
    return false;
  }
}

// ── 세션 (활성 트랙 1개 기준 module-level) ─────────────────────────
let currentSession: { token: string; trackId: string } | null = null;

export async function startStreamSessionV2(trackId: string, playerType: V2PlayerType): Promise<void> {
  try {
    const { data } = await supabase.rpc('start_stream_session_v2', {
      p_track_id: trackId,
      p_player_type: playerType,
      p_anonymous_id: getAnonymousId(),
      p_device_id: getDeviceId(),
    });
    const token = (data as { session_token?: string } | null)?.session_token;
    if (token) currentSession = { token, trackId };
  } catch {
    /* shadow — 무시 */
  }
}

export async function recordStreamEventV2(input: {
  trackId: string;
  eventType: 'play_started' | 'play_30s' | 'play_completed' | 'play_skipped' | 'heartbeat';
  playlistId?: string | null;
  volume?: number | null;
  muted?: boolean | null;
  listenedSeconds?: number | null;
}): Promise<void> {
  try {
    const token = currentSession?.trackId === input.trackId ? currentSession.token : null;
    await supabase.rpc('record_stream_event_v2', {
      p_track_id: input.trackId,
      p_event_type: input.eventType,
      p_session_token: token,
      p_player_type: resolvePlayerType(),
      p_anonymous_id: getAnonymousId(),
      p_device_id: getDeviceId(),
      p_device_class: deviceClass(),
      p_client_reported_seconds: typeof input.listenedSeconds === 'number' ? input.listenedSeconds : null,
      p_playlist_id: input.playlistId ?? null,
      p_player_volume: typeof input.volume === 'number' ? input.volume : null,
      p_player_muted: typeof input.muted === 'boolean' ? input.muted : null,
      p_visibility_state: visibility(),
      p_network_state: typeof navigator !== 'undefined' && 'onLine' in navigator ? (navigator.onLine ? 'online' : 'offline') : null,
      p_source_page: sourcePage(),
      p_user_agent: userAgent(),
      p_raw_payload: { session_id: getSessionId() },
    });
  } catch {
    /* shadow — 무시 */
  }
}

export async function verifyStreamHeartbeatV2(input: {
  trackId: string; position: number; playing: boolean; volume: number; muted: boolean;
}): Promise<void> {
  if (!currentSession || currentSession.trackId !== input.trackId) return;
  try {
    await supabase.rpc('verify_stream_heartbeat_v2', {
      p_session_token: currentSession.token,
      p_position: input.position,
      p_playing: input.playing,
      p_volume: input.volume,
      p_muted: input.muted,
      p_visibility: visibility(),
    });
  } catch {
    /* shadow — 무시 */
  }
}

/**
 * 우산 함수 — Player 가 v1 trackStream 직후 병행 호출.
 * flag OFF 이면 즉시 no-op. play_started 시 세션을 먼저 시작.
 */
export async function safeRecordStreamV2(input: {
  trackId: string;
  eventType: 'play_started' | 'play_30s' | 'play_completed' | 'play_skipped';
  playlistId?: string | null;
  volume?: number | null;
  muted?: boolean | null;
  listenedSeconds?: number | null;
}): Promise<void> {
  try {
    if (!(await shadowEnabled())) return;
    if (input.eventType === 'play_started') {
      await startStreamSessionV2(input.trackId, resolvePlayerType());
    }
    await recordStreamEventV2(input);
  } catch {
    /* shadow — 절대 throw 하지 않음 */
  }
}

/** Player heartbeat interval 에서 호출. flag OFF/세션 없음 시 no-op. */
export async function safeHeartbeatV2(input: {
  trackId: string; position: number; playing: boolean; volume: number; muted: boolean;
}): Promise<void> {
  try {
    if (!currentSession || currentSession.trackId !== input.trackId) return;
    if (!(await shadowEnabled())) return;
    await verifyStreamHeartbeatV2(input);
  } catch {
    /* shadow — 무시 */
  }
}

// ── 관리자 overview (Streaming v2 Panel) ────────────────────────────
export interface StreamV2ReconRow {
  day: string;
  v1_milestone_30s: number; v1_eligible: number;
  v2_raw: number; v2_play_30s: number; v2_verified: number; v2_eligible: number; v2_settlement_eligible: number;
  diff_settlement_vs_v1: number;
}
export interface StreamV2OverviewFilters {
  playerType?: string | null;
  trackId?: string | null;
  storeId?: string | null;
  brandId?: string | null;
}

export interface StreamV2Overview {
  window_days: number;
  filters?: { player_type: string | null; track_id: string | null; store_id: string | null; brand_id: string | null };
  funnel: { raw: number; play_30s: number; verified: number; eligible: number; settlement_eligible: number };
  v1?: { eligible_for_payout: number };
  difference?: { settlement_minus_v1: number; rate_pct: number | null; zone: 'normal' | 'watch' | 'investigate' | 'n/a' };
  rejected_breakdown: Record<string, number>;
  player_type_breakdown: Record<string, number>;
  fraud_watch: number;
  disputed: number;
  reconciliation: StreamV2ReconRow[];
}

export async function adminStreamV2Overview(days = 7, filters: StreamV2OverviewFilters = {}): Promise<StreamV2Overview> {
  const { data, error } = await supabase.rpc('admin_stream_v2_overview', {
    p_days: days,
    p_player_type: filters.playerType ?? null,
    p_track_id: filters.trackId ?? null,
    p_store_id: filters.storeId ?? null,
    p_brand_id: filters.brandId ?? null,
  });
  if (error) throw error;
  return data as StreamV2Overview;
}

// ── Replay / Timeline ────────────────────────────────────────────────
export interface StreamV2ReplayEvent {
  created_at: string;
  event_type: string;
  player_type: string;
  verified_seconds: number | null;
  heartbeat_verified: boolean;
  player_volume: number | null;
  player_muted: boolean | null;
  visibility_state: string | null;
  background_state?: string | null;
  ineligible_reason: string | null;
  eligible_reason?: string | null;
  fraud_score: number | null;
  dispute_status: string;
  eligible_snapshot: boolean;
}

export async function adminStreamV2Replay(opts: { sessionToken?: string | null; trackId?: string | null; limit?: number }): Promise<StreamV2ReplayEvent[]> {
  const { data, error } = await supabase.rpc('admin_stream_v2_replay', {
    p_session_token: opts.sessionToken ?? null,
    p_track_id: opts.trackId ?? null,
    p_limit: opts.limit ?? 200,
  });
  if (error) throw error;
  return (data ?? []) as StreamV2ReplayEvent[];
}

// ── Health Score ─────────────────────────────────────────────────────
export type StreamV2HealthScope = 'global' | 'store' | 'brand' | 'user';
export interface StreamV2Health {
  scope: string;
  id?: string | null;
  window_days: number;
  play_30s_count: number;
  raw_count?: number;
  overall_health: number;
  verified_rate: number;
  eligible_rate: number;
  heartbeat_success_rate: number;
  fraud_rate: number;
  rejected_rate: number;
  top_rejection_reasons?: Record<string, number>;
}

export async function adminStreamV2Health(scope: StreamV2HealthScope = 'global', id: string | null = null, days = 7): Promise<StreamV2Health> {
  const { data, error } = await supabase.rpc('admin_stream_v2_health', { p_scope: scope, p_id: id, p_days: days });
  if (error) throw error;
  return data as StreamV2Health;
}

// ── Calibration Report (ALGO-2E — verification timing / player_type 보정 진단) ──
export interface StreamV2CalibrationMismatch {
  session_token: string; event_player_type: string; session_player_type: string | null;
  canonical: string; verified_seconds: number | null;
}
export interface StreamV2Calibration {
  window_days: number;
  play_30s_count: number;
  session_verified_count: number;
  heartbeat_coverage_pct: number;
  session_verified_rate_pct: number;
  completed_after_30s_count: number;
  player_type_mismatch_count: number;
  verified_before: number; verified_after: number; verified_delta: number;
  eligible_before: number; eligible_after: number; eligible_delta: number;
  top_mismatch_examples: StreamV2CalibrationMismatch[];
  notes: string;
}

export async function adminStreamV2Calibration(days = 7): Promise<StreamV2Calibration> {
  const { data, error } = await supabase.rpc('admin_stream_v2_calibration_report', { p_days: days });
  if (error) throw error;
  return data as StreamV2Calibration;
}
