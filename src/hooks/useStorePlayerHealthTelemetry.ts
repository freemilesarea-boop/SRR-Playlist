/**
 * useStorePlayerHealthTelemetry — WEB-OBS-6 Store Fleet Monitoring emit.
 *
 * A NEW, additive observer hook mounted on the store player page ALONGSIDE the existing
 * useStoreHeartbeat. It reads the zustand player/health stores ONLY — it never touches Player.tsx,
 * the audio element, the queue, the scheduler, crossfade, or any playback logic. It emits a low-cost
 * periodic heartbeat + a few derived discrete events to the WEB-OBS-6 fleet channel.
 *
 * Hard guarantees:
 *   • Fully FAIL-OPEN: every path is wrapped so a telemetry failure can never affect playback. No
 *     infinite retry — a failed flush drops the batch (bounded buffer).
 *   • OPT-IN: does nothing unless VITE_FLEET_TELEMETRY_ENABLED is set (getFleetConfig().telemetryEnabled).
 *   • Store id is a convenience arg; the server derives/validates store_id = auth.uid().
 *   • Signals only from the stores. Audio-internal signals (readyState/networkState/error-code/recovery/
 *     sinkId) are NOT captured (that would require a forbidden Player.tsx change) — reported as NO_DATA.
 */
import { useEffect, useRef } from 'react';
import { usePlayerStore } from '@/store/playerStore';
import { usePlaybackHealthStore } from '@/store/playbackHealthStore';
import { ingestStorePlayerHealth } from '@/lib/api/fleetApi';
import { getFleetConfig } from '@/lib/fleet/config';
import { BUILD_ID } from '@/lib/bootRecovery';
import {
  hashTrackId, positionBucketFor, queueLengthBucketFor, reconnectBucketFor, fleetRoute,
  PROGRESS_MIN_DELTA_SEC, STALL_MIN_FROZEN_HEARTBEATS, SILENCE_MIN_FROZEN_HEARTBEATS, TRACK_END_GUARD_SEC,
  type FleetHealthEvent, type FleetEventType, type FleetEnvironment, type FleetBrowserFamily,
  type FleetOsFamily, type FleetDeviceClass, type PlaybackState, type VisibilityState,
} from '@/lib/fleet';

interface Options { storeId: string | null; enabled: boolean; }

function randomToken(): string {
  try {
    const buf = new Uint8Array(12);
    (globalThis.crypto ?? (globalThis as { msCrypto?: Crypto }).msCrypto)?.getRandomValues(buf);
    let s = ''; for (const b of buf) s += (b % 36).toString(36);
    if (s.length >= 12) return s.slice(0, 16);
  } catch { /* fall through */ }
  let seed = 0; try { seed = Math.floor(performance.now() * 1000); } catch { /* noop */ }
  let s = ''; while (s.length < 16) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; s += (seed % 36).toString(36); }
  return s.slice(0, 16);
}

function resolveEnvironment(): FleetEnvironment {
  try {
    const e = (import.meta.env.VITE_APP_ENV as string | undefined)?.toLowerCase();
    if (e === 'production' || e === 'preview' || e === 'development') return e;
    if (import.meta.env.PROD) return 'production';
    if (import.meta.env.DEV) return 'development';
  } catch { /* noop */ }
  return 'unknown';
}

function detectBrowser(ua: string): FleetBrowserFamily {
  if (/edg\//i.test(ua)) return 'Edge';
  if (/samsungbrowser/i.test(ua)) return 'Samsung';
  if (/(chrome|crios)\//i.test(ua)) return 'Chrome';
  if (/(firefox|fxios)\//i.test(ua)) return 'Firefox';
  if (/safari/i.test(ua) && /version\//i.test(ua)) return 'Safari';
  return 'Other';
}
function detectOs(ua: string): FleetOsFamily {
  if (/windows/i.test(ua)) return 'Windows';
  if (/iphone|ipad|ipod/i.test(ua)) return 'iOS';
  if (/android/i.test(ua)) return 'Android';
  if (/macintosh|mac os x/i.test(ua)) return 'macOS';
  if (/linux/i.test(ua)) return 'Linux';
  return 'Other';
}
function detectDeviceClass(): FleetDeviceClass {
  try {
    const w = window.innerWidth || 1024;
    const touch = 'ontouchstart' in window || (navigator.maxTouchPoints ?? 0) > 0;
    if (w < 640 && touch) return 'mobile';
    if (w < 1024 && touch) return 'tablet';
    return 'desktop';
  } catch { return 'unknown'; }
}
function visibility(): VisibilityState {
  try { return document.visibilityState === 'visible' ? 'visible' : 'hidden'; } catch { return 'unknown'; }
}

export function useStorePlayerHealthTelemetry({ storeId, enabled }: Options): void {
  const online = usePlaybackHealthStore((s) => s.online);
  const sessionRef = useRef<string>('');
  const seqRef = useRef(0);
  const bufRef = useRef<FleetHealthEvent[]>([]);
  const frozenRef = useRef(0);
  const lastPosRef = useRef(0);
  const lastTrackRef = useRef<string | null>(null);
  const recentTracksRef = useRef<string[]>([]);
  const reconnectRef = useRef(0);
  const disconnectRef = useRef(0);
  const stalledEmittedRef = useRef(false);
  const silenceEmittedRef = useRef(false);
  const dupEmittedRef = useRef<Set<string>>(new Set());

  const cfg = getFleetConfig();
  const active = enabled && !!storeId && cfg.telemetryEnabled;

  useEffect(() => {
    if (!active) return;
    if (!sessionRef.current) sessionRef.current = randomToken();
    const buffer = bufRef.current; // stable ref array — capture for the cleanup flush (lint)
    let cancelled = false;
    let ua = ''; try { ua = navigator.userAgent; } catch { /* noop */ }
    const browser = detectBrowser(ua); const os = detectOs(ua); const deviceClass = detectDeviceClass();
    const env = resolveEnvironment();
    let route = 'other'; try { route = fleetRoute(window.location?.pathname); } catch { /* noop */ }

    const base = (event_type: FleetEventType, extra: Partial<FleetHealthEvent> = {}): FleetHealthEvent => {
      const st = usePlayerStore.getState();
      const trackId = st.queue[st.index]?.id ?? null;
      const playbackState: PlaybackState = st.playing ? 'playing' : trackId ? 'paused' : 'stopped';
      return {
        event_id: `${sessionRef.current}${(seqRef.current).toString(36)}${randomToken().slice(0, 4)}`.slice(0, 64),
        event_type, event_version: 1, player_session_id: sessionRef.current, sequence: seqRef.current++,
        occurred_at: Date.now(), release: BUILD_ID || 'unknown', environment: env, route,
        browser_family: browser, os_family: os, device_class: deviceClass, visibility_state: visibility(),
        playback_state: playbackState, current_track_hash: hashTrackId(trackId),
        position_bucket: positionBucketFor(st.currentTime ?? null, st.duration ?? null),
        queue_length_bucket: queueLengthBucketFor(Math.max(0, st.queue.length - 1 - st.index)),
        has_next: st.index < st.queue.length - 1 || st.repeat !== 'off',
        scheduler_age_bucket: 'unknown', // no runtime scheduler-refresh signal exists (documented)
        reconnect_bucket: reconnectBucketFor(reconnectRef.current),
        online: (typeof navigator !== 'undefined' ? navigator.onLine : true) && usePlaybackHealthStore.getState().online,
        ...extra,
      };
    };

    const push = (e: FleetHealthEvent) => {
      try {
        buffer.push(e);
        if (buffer.length >= cfg.maxBatch) void flush();
      } catch { /* fail-open */ }
    };

    const flush = async () => {
      if (cancelled) return;
      const batch = buffer.splice(0, cfg.maxBatch);
      if (batch.length === 0) return;
      try { await ingestStorePlayerHealth(batch, storeId); } catch { /* fail-open: drop the batch, never retry-storm */ }
    };

    const tick = () => {
      try {
        const st = usePlayerStore.getState();
        const playing = st.playing;
        const pos = st.currentTime ?? 0;
        const dur = st.duration ?? 0;
        const trackId = st.queue[st.index]?.id ?? null;
        const trackHash = hashTrackId(trackId);

        // progress-based freeze detection (only while playing, not at end-of-track)
        const nearEnd = dur > 0 && pos >= dur - TRACK_END_GUARD_SEC;
        if (playing && !nearEnd && Math.abs(pos - lastPosRef.current) < PROGRESS_MIN_DELTA_SEC) {
          frozenRef.current += 1;
        } else {
          frozenRef.current = 0; stalledEmittedRef.current = false; silenceEmittedRef.current = false;
        }
        lastPosRef.current = pos;

        // heartbeat
        push(base('player_heartbeat'));

        // derived discrete events (each once per streak)
        if (playing && frozenRef.current >= SILENCE_MIN_FROZEN_HEARTBEATS && !silenceEmittedRef.current) {
          silenceEmittedRef.current = true; push(base('silence_suspected'));
        } else if (playing && frozenRef.current >= STALL_MIN_FROZEN_HEARTBEATS && !stalledEmittedRef.current) {
          stalledEmittedRef.current = true; push(base('playback_stalled'));
        }
        if (st.queue.length === 0) push(base('queue_empty'));

        // track transition + duplicate detection (repeat='one' intended loop is excluded)
        if (trackHash && trackHash !== lastTrackRef.current) {
          lastTrackRef.current = trackHash;
          push(base('track_transition'));
          const hist = recentTracksRef.current;
          hist.push(trackHash); if (hist.length > 20) hist.shift();
          if (st.repeat !== 'one') {
            const count = hist.filter((h) => h === trackHash).length;
            if (count >= 3 && !dupEmittedRef.current.has(trackHash)) {
              dupEmittedRef.current.add(trackHash);
              if (dupEmittedRef.current.size > 50) dupEmittedRef.current.clear();
              push(base('duplicate_track_detected'));
            }
          }
        }
        void flush();
      } catch { /* fail-open */ }
    };

    // network transitions → discrete events
    const onOnline = () => { try { reconnectRef.current += 1; push(base('network_reconnected')); void flush(); } catch { /* noop */ } };
    const onOffline = () => { try { disconnectRef.current += 1; push(base('network_disconnected')); void flush(); } catch { /* noop */ } };
    const onVisibility = () => { if (visibility() === 'hidden') void flush(); };

    try {
      window.addEventListener('online', onOnline);
      window.addEventListener('offline', onOffline);
      document.addEventListener('visibilitychange', onVisibility);
      window.addEventListener('pagehide', () => { try { push(base('session_ended')); void flush(); } catch { /* noop */ } });
    } catch { /* noop */ }

    push(base('session_started'));
    tick();
    const id = window.setInterval(tick, cfg.heartbeatEnabled ? cfg.heartbeatIntervalMs : cfg.heartbeatIntervalMs);

    return () => {
      cancelled = true;
      window.clearInterval(id);
      try {
        window.removeEventListener('online', onOnline);
        window.removeEventListener('offline', onOffline);
        document.removeEventListener('visibilitychange', onVisibility);
      } catch { /* noop */ }
      // best-effort final flush (fire-and-forget)
      try { void ingestStorePlayerHealth(buffer.splice(0), storeId); } catch { /* noop */ }
    };
    // storeId/active drive the effect; player state is read via getState() to avoid re-arming the interval.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, storeId]);

  // keep `online` referenced so the subscription re-renders drive nothing harmful (lint: used)
  void online;
}
