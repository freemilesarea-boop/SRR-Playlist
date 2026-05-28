import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';

interface LockState {
  /** 본인이 lock 을 가지고 있는지 (편집 안전) */
  lockedByMe: boolean;
  /** 다른 사람이 lock 중일 때 그 정보 */
  otherUser: {
    id: string;
    nickname: string;
    sinceAt: string;
    heartbeatAt: string;
  } | null;
  /** 초기 acquire 시도 중 */
  loading: boolean;
  /** 에러 메시지 */
  error: string | null;
}

const HEARTBEAT_INTERVAL_MS = 30_000;

/**
 * 플레이리스트 협업 advisory lock — DEUDDA D11.
 *
 * 마운트 시: acquire_or_check_lock 호출
 *   - 본인 lock 확보 → lockedByMe=true
 *   - 다른 사용자 active lock → otherUser 정보 반환, lockedByMe=false
 *   - 다른 사용자 stale (>5min) → 자동 takeover, lockedByMe=true
 * 30초마다: 같은 RPC 호출 (heartbeat 갱신 + 외부 변경 감지)
 * 언마운트 시: release_playlist_lock
 * 페이지 닫기 시: navigator.sendBeacon 으로 release 시도 (best-effort)
 *
 * forceTakeover(): 다른 사용자 lock 무시하고 강제 takeover (사용자 명시 선택)
 */
export function usePlaylistLock(playlistId: string) {
  const [state, setState] = useState<LockState>({
    lockedByMe: false,
    otherUser: null,
    loading: true,
    error: null,
  });
  const aliveRef = useRef(true);

  // 한 번의 RPC 호출 + state 갱신
  async function checkLock(): Promise<void> {
    if (!playlistId) return;
    try {
      const { data, error } = await supabase.rpc('acquire_or_check_lock', {
        p_playlist_id: playlistId,
      });
      if (error) throw error;
      if (!aliveRef.current) return;
      const row = (data ?? [])[0] as
        | {
            locked_by_me: boolean;
            other_user_id: string | null;
            other_nickname: string | null;
            other_since_at: string | null;
            other_heartbeat_at: string | null;
            other_is_stale: boolean | null;
          }
        | undefined;
      if (!row) {
        setState({ lockedByMe: false, otherUser: null, loading: false, error: null });
        return;
      }
      setState({
        lockedByMe: row.locked_by_me,
        otherUser:
          !row.locked_by_me && row.other_user_id
            ? {
                id: row.other_user_id,
                nickname: row.other_nickname ?? '다른 사용자',
                sinceAt: row.other_since_at ?? '',
                heartbeatAt: row.other_heartbeat_at ?? '',
              }
            : null,
        loading: false,
        error: null,
      });
    } catch (e) {
      if (!aliveRef.current) return;
      setState((s) => ({
        ...s,
        loading: false,
        error: e instanceof Error ? e.message : String(e),
      }));
    }
  }

  async function forceTakeover() {
    if (!playlistId) return;
    try {
      const { error } = await supabase.rpc('force_takeover_playlist_lock', {
        p_playlist_id: playlistId,
      });
      if (error) throw error;
      await checkLock();
    } catch (e) {
      setState((s) => ({ ...s, error: e instanceof Error ? e.message : String(e) }));
    }
  }

  useEffect(() => {
    aliveRef.current = true;
    setState({ lockedByMe: false, otherUser: null, loading: true, error: null });
    void checkLock();

    // 30초 heartbeat
    const tick = window.setInterval(() => {
      void checkLock();
    }, HEARTBEAT_INTERVAL_MS);

    // 페이지 닫기 시 best-effort release
    function onBeforeUnload() {
      // sendBeacon 으로 직접 RPC 호출 — supabase auth header 안 보내지므로 anon endpoint 가
      // 직접 RPC 호출 가능한지 확인 필요. 안전을 위해 fetch keepalive 사용.
      try {
        const url = `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/rpc/release_playlist_lock`;
        const sessionStr = localStorage.getItem('sb-' + extractRef() + '-auth-token');
        const token = sessionStr ? extractAccessToken(sessionStr) : null;
        if (token) {
          fetch(url, {
            method: 'POST',
            keepalive: true,
            headers: {
              apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
              Authorization: `Bearer ${token}`,
              'content-type': 'application/json',
            },
            body: JSON.stringify({ p_playlist_id: playlistId }),
          }).catch(() => {});
        }
      } catch {
        /* noop */
      }
    }
    window.addEventListener('beforeunload', onBeforeUnload);

    return () => {
      aliveRef.current = false;
      window.clearInterval(tick);
      window.removeEventListener('beforeunload', onBeforeUnload);
      // 정상 unmount 시 release (실패해도 5분 후 stale 처리됨)
      try {
        void supabase
          .rpc('release_playlist_lock', { p_playlist_id: playlistId })
          .then(() => {})
          .then(undefined, () => {});
      } catch {
        /* noop */
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playlistId]);

  return { ...state, refresh: checkLock, forceTakeover };
}

/** localStorage 의 supabase 세션 key 에서 project ref 추출 (sb-<ref>-auth-token) */
function extractRef(): string {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  if (!url) return '';
  return url.replace(/^https?:\/\//, '').split('.')[0];
}

function extractAccessToken(sessionJson: string): string | null {
  try {
    const parsed = JSON.parse(sessionJson) as { access_token?: string };
    return parsed.access_token ?? null;
  } catch {
    return null;
  }
}
