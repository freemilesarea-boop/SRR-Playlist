import { supabase } from './supabase';

const SESSION_KEY = 'srr-session-id';
const SESSION_AT_KEY = 'srr-session-at';
const SESSION_TTL_MS = 30 * 60 * 1000; // 30분

/** 세션 ID — 30분 유휴 시 갱신, 그 외 동일 세션 */
export function getSessionId(): string {
  try {
    const now = Date.now();
    const last = Number(localStorage.getItem(SESSION_AT_KEY) ?? '0');
    let id = localStorage.getItem(SESSION_KEY);
    if (!id || now - last > SESSION_TTL_MS) {
      id = crypto.randomUUID();
      localStorage.setItem(SESSION_KEY, id);
    }
    localStorage.setItem(SESSION_AT_KEY, String(now));
    return id;
  } catch {
    // localStorage 막힌 환경 — 메모리 폴백
    return 'anon-' + Math.random().toString(36).slice(2);
  }
}

function detectDeviceType(): string {
  if (typeof navigator === 'undefined') return 'unknown';
  const ua = navigator.userAgent;
  if (/Mobi|Android|iPhone|iPad/i.test(ua)) {
    if (/iPad|Tablet/i.test(ua)) return 'tablet';
    return 'mobile';
  }
  return 'desktop';
}

let lastVisitPath: string | null = null;
let lastVisitAt = 0;

/** 페이지 방문 기록 — 같은 path 5초 이내 중복은 무시 */
export async function trackVisit(path: string, userId: string | null) {
  const now = Date.now();
  if (lastVisitPath === path && now - lastVisitAt < 5000) return;
  lastVisitPath = path;
  lastVisitAt = now;

  try {
    await supabase.from('visitor_events').insert({
      user_id: userId,
      session_id: getSessionId(),
      path,
      referrer: typeof document !== 'undefined' ? document.referrer || null : null,
      user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
      device_type: detectDeviceType(),
    });
  } catch {
    /* analytics 실패는 사용자 경험에 영향 주지 않음 */
  }
}

interface StreamPayload {
  user_id: string | null;
  track_id: string;
  playlist_id: string | null;
  listened_seconds: number;
  completed: boolean;
  event_type: 'start' | 'milestone_30s' | 'complete';
  /** 0089 — 플레이어 내부 볼륨 0.0~1.0 (muted/low_volume 검사 입력) */
  player_volume?: number | null;
  /** 0089 — 플레이어 muted 상태. volume=0 도 muted 로 간주됨 */
  player_muted?: boolean | null;
}

/**
 * 0078 — anonymous_id (브라우저 단위 영속). 비로그인 사용자 dedup 용.
 * 동일 브라우저는 같은 anonymous_id 를 재사용한다. session_id 와는 별개.
 */
const ANON_ID_KEY = 'srr.anonymous.id';
export function getAnonymousId(): string {
  try {
    let id = localStorage.getItem(ANON_ID_KEY);
    if (!id) {
      id = (crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36));
      localStorage.setItem(ANON_ID_KEY, id);
    }
    return id;
  } catch {
    return 'anon-' + Math.random().toString(36).slice(2);
  }
}

/**
 * 0078 — 서버측 가드 + dedup RPC 경유 스트림 이벤트 적립.
 * record_stream_event_safe 가 다음을 처리:
 *   · 봇 UA 차단 / 5초 미만 milestone 차단 / 30초 dedup
 *   · eligible_for_payout 자동 판정 (admin/artist 화면, 본인 재생, 미공개 트랙 모두 false)
 *
 * 클라이언트는 단순 호출만. 실패해도 사용자 경험 영향 없음 (silent).
 */
export async function trackStream(payload: StreamPayload) {
  try {
    const sourcePage = typeof window !== 'undefined' ? window.location.pathname : null;
    const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : null;
    await supabase.rpc('record_stream_event_safe', {
      p_track_id: payload.track_id,
      p_session_id: getSessionId(),
      p_event_type: payload.event_type,
      p_listened_seconds: payload.listened_seconds,
      p_completed: payload.completed,
      p_playlist_id: payload.playlist_id,
      p_anonymous_id: getAnonymousId(),
      p_source_page: sourcePage,
      p_user_agent: userAgent,
      p_player_volume: typeof payload.player_volume === 'number' ? payload.player_volume : null,
      p_player_muted: typeof payload.player_muted === 'boolean' ? payload.player_muted : null,
    });
  } catch {
    /* analytics 실패는 사용자 경험에 영향 주지 않음 */
  }
}

/**
 * 0102 — 플레이리스트 청취 조회수 기록 (10분 이상 청취 시 서버가 1 view 집계).
 * stream_events 정산과 완전 분리. 실패해도 silent.
 */
export async function recordPlaylistQualifiedView(
  playlistType: 'catalog' | 'user',
  playlistId: string,
  listenedSeconds: number,
): Promise<{ counted: boolean; total_views?: number } | null> {
  try {
    const { data } = await supabase.rpc('record_playlist_qualified_view', {
      p_playlist_type: playlistType,
      p_playlist_id: playlistId,
      p_listened_seconds: Math.floor(listenedSeconds),
      p_session_id: getSessionId(),
      p_anonymous_id: getAnonymousId(),
    });
    return (data as { counted: boolean; total_views?: number }) ?? null;
  } catch {
    return null;
  }
}
