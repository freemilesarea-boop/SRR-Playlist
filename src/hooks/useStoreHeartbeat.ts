/**
 * useStoreHeartbeat — Enterprise Phase 1-3.
 *
 * 매장 운영 관제용 60s heartbeat. 모든 business 모드 사용자 대상.
 * franchise 연결 여부 무관 (X6.89.1 의 franchise-only 게이트 제거).
 *
 * - StorePlayerPage mount 시 시작 / unmount 시 정리
 * - 60s interval (Player lifecycle 에 종속)
 * - heartbeat 실패는 silent (재생을 막지 않음)
 * - 중복 호출 방지: 다른 hook (예: useFranchisePolicySync) 은 heartbeat 안 보냄
 */
import { useEffect, useRef } from 'react';
import { storeHeartbeat, type StorePlayerStatus } from '@/lib/api/storeMonitoringApi';
import { usePlayerStore } from '@/store/playerStore';

const HEARTBEAT_INTERVAL_MS = 60_000;
const APP_VERSION = (import.meta.env.VITE_APP_VERSION as string | undefined) ?? '0.1.0';

interface UseStoreHeartbeatOptions {
  storeId: string | null;
  /** false 면 hook 동작 비활성 (개인 사용자/관리자 페이지 등) */
  enabled: boolean;
}

export function useStoreHeartbeat({ storeId, enabled }: UseStoreHeartbeatOptions): void {
  const playing = usePlayerStore((s) => s.playing);
  const currentTrackId = usePlayerStore((s) => s.queue[s.index]?.id);
  const volume = usePlayerStore((s) => s.volume);
  const lastTrackIdRef = useRef<string | null>(null);
  const trackStartedAtRef = useRef<string | null>(null);

  // 트랙 변경 시 started_at 갱신
  useEffect(() => {
    if (currentTrackId && currentTrackId !== lastTrackIdRef.current) {
      lastTrackIdRef.current = currentTrackId;
      trackStartedAtRef.current = new Date().toISOString();
    }
  }, [currentTrackId]);

  // Heartbeat — Player mount 시 시작, unmount 시 정리
  useEffect(() => {
    if (!enabled || !storeId) return;
    let cancelled = false;

    const send = (status: StorePlayerStatus) => {
      if (cancelled) return;
      void storeHeartbeat({
        storeId,
        appVersion: APP_VERSION,
        playerStatus: status,
        currentTrackId: currentTrackId ?? null,
        currentTrackStartedAt: trackStartedAtRef.current,
        // volume 은 0~1 float → 0~100 int 변환
        volume: Math.round((volume ?? 0) * 100),
        // device / connection 은 browser API 로 추정 (보장 안 됨 → silent fallback)
        deviceModel: getDeviceModel(),
        deviceOs: getDeviceOs(),
        connectionType: getConnectionType(),
        // battery / wifi_ssid / device_identifier 는 브라우저에서 미제공 → null
        batteryLevel: null,
        wifiSsid: null,
        deviceIdentifier: null,
        playbackError: null,
      });
    };

    // 즉시 1회 + 60s interval
    const status: StorePlayerStatus = playing ? 'playing' : currentTrackId ? 'paused' : 'stopped';
    send(status);
    const id = window.setInterval(() => {
      const st = usePlayerStore.getState();
      const s: StorePlayerStatus = st.playing ? 'playing' : st.queue[st.index]?.id ? 'paused' : 'stopped';
      send(s);
    }, HEARTBEAT_INTERVAL_MS);

    return () => { cancelled = true; window.clearInterval(id); };
    // playing/currentTrackId/volume 은 deps 에 안 넣음 — 60s 주기로 store.getState() 직접 조회
    // (deps 에 넣으면 매 변경마다 interval 재생성 → 잦은 호출)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, storeId]);
}

// =============================================================================
// Browser hints — best-effort, 실패 시 null
// =============================================================================

function getDeviceModel(): string | null {
  try {
    const ua = navigator.userAgent;
    if (/iPhone|iPad|iPod/.test(ua)) return 'iOS Device';
    if (/Android/.test(ua)) return 'Android Device';
    if (/Macintosh/.test(ua)) return 'Mac';
    if (/Windows/.test(ua)) return 'Windows PC';
    if (/Linux/.test(ua)) return 'Linux PC';
    return null;
  } catch { return null; }
}

function getDeviceOs(): string | null {
  try {
    const ua = navigator.userAgent;
    if (/Windows NT 10/.test(ua)) return 'Windows 10/11';
    if (/Windows/.test(ua)) return 'Windows';
    if (/Mac OS X (\d+[._]\d+)/.test(ua)) {
      const m = ua.match(/Mac OS X (\d+[._]\d+)/);
      return m ? `macOS ${m[1].replace('_', '.')}` : 'macOS';
    }
    if (/Android (\d+)/.test(ua)) {
      const m = ua.match(/Android (\d+)/);
      return m ? `Android ${m[1]}` : 'Android';
    }
    if (/OS (\d+_\d+)/.test(ua)) {
      const m = ua.match(/OS (\d+_\d+)/);
      return m ? `iOS ${m[1].replace('_', '.')}` : 'iOS';
    }
    return null;
  } catch { return null; }
}

function getConnectionType(): string | null {
  try {
    // navigator.connection 은 일부 브라우저만 (Chrome/Edge) 지원
    const conn = (navigator as Navigator & { connection?: { effectiveType?: string; type?: string } }).connection;
    if (!conn) return null;
    return conn.type ?? conn.effectiveType ?? null;
  } catch { return null; }
}
