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
}

export async function trackStream(payload: StreamPayload) {
  try {
    await supabase.from('stream_events').insert({
      ...payload,
      session_id: getSessionId(),
    });
  } catch {
    /* noop */
  }
}
