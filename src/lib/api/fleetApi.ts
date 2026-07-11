// WEB-OBS-6 — Store Fleet API. Wraps the security-definer fleet RPCs (super-admin only) and composes
// the pure engines client-side (like observabilityApi). Also exposes the authenticated ingest call
// used by the client emit hook. All verdicts are rule-based; NOTHING is executed; no remote control.

import { supabase } from '@/lib/supabase';
import {
  computeStoreHealth, computeFleetHealth, detectStoreIncidents, computeFleetBlastRadius,
  computeFleetAdvice, computeStoreAdvice, computeStoreRecovery,
  SILENCE_MIN_FROZEN_HEARTBEATS, STALL_MIN_FROZEN_HEARTBEATS,
  type StoreHealthInput, type StoreHealthResult, type FleetOverview, type FleetBlastRadius,
  type StoreIncident, type FleetAdvice, type StoreRecoveryResult,
  type FleetHealthEvent, type PlaybackState, type VisibilityState, type QueueLengthBucket,
  type SchedulerAgeBucket, type FleetBrowserFamily, type FleetDeviceClass,
} from '@/lib/fleet';

export type FleetWindow = '1h' | '24h' | '7d' | '30d';

// ── Ingest (authenticated store session) ────────────────────────────────────
/** Send a batch of player-health events. Server derives store_id = auth.uid() (client value ignored/validated). */
export async function ingestStorePlayerHealth(events: FleetHealthEvent[], storeId: string | null): Promise<{ ok: boolean; accepted?: number }> {
  const { data, error } = await supabase.rpc('ingest_store_player_health', {
    p_events: events as unknown as Record<string, unknown>[],
    p_store_id: storeId,
  });
  if (error) return { ok: false };
  const res = (data ?? {}) as { ok?: boolean; accepted?: number };
  return { ok: res.ok === true, accepted: res.accepted };
}

// ── Admin query row shape (from admin_store_fleet_overview) ──────────────────
interface FleetOverviewRow {
  store_id: string;
  last_seen_age_sec: number | null;
  heartbeats: number;
  stalled_recent: number; silence_recent: number; stalled_events: number; silence_events: number;
  queue_empty_recent: number; disconnect_events: number; reconnect_events: number; transitions: number;
  last_visibility: string; last_playback_state: string; last_queue_bucket: string; has_next: boolean;
  scheduler_age_bucket: string; release: string; browser_family: string; device_class: string; online: boolean;
  max_track_repeat: number; distinct_tracks: number;
  store_name: string | null; brand_id: string | null; brand_name: string | null;
  enterprise_region_id: string | null; region_name: string | null;
}

function rowToInput(r: FleetOverviewRow): StoreHealthInput {
  const frozenStreakAtEnd = r.silence_recent > 0 ? SILENCE_MIN_FROZEN_HEARTBEATS : r.stalled_recent > 0 ? STALL_MIN_FROZEN_HEARTBEATS : 0;
  return {
    storeId: r.store_id,
    lastSeenAgeSec: r.last_seen_age_sec,
    heartbeats: r.heartbeats ?? 0,
    lastVisibility: (r.last_visibility as VisibilityState) ?? 'unknown',
    lastPlaybackState: (r.last_playback_state as PlaybackState) ?? 'unknown',
    frozenStreakAtEnd,
    stalledEvents: r.stalled_events ?? 0,
    silenceSuspectedEvents: r.silence_events ?? 0,
    queueEmptyEvents: r.queue_empty_recent ?? 0,
    lastQueueBucket: (r.last_queue_bucket as QueueLengthBucket) ?? 'unknown',
    hasNext: r.has_next === true,
    disconnectEvents: r.disconnect_events ?? 0,
    reconnectEvents: r.reconnect_events ?? 0,
    schedulerAgeBucket: (r.scheduler_age_bucket as SchedulerAgeBucket) ?? 'unknown',
    distinctTracks: r.distinct_tracks ?? 0,
    maxTrackRepeat: r.max_track_repeat ?? 0,
    transitions: r.transitions ?? 0,
    online: r.online !== false,
    release: r.release ?? 'unknown',
    browserFamily: (r.browser_family as FleetBrowserFamily) ?? 'Other',
    deviceClass: (r.device_class as FleetDeviceClass) ?? 'unknown',
    repeatMode: 'unknown',
    storeName: r.store_name, brandId: r.brand_id, brandName: r.brand_name, regionName: r.region_name,
  };
}

export interface FleetIntelBundle {
  window: FleetWindow;
  totalStores: number;
  stores: StoreHealthResult[];
  overview: FleetOverview;
  incidents: StoreIncident[];
  blastRadius: FleetBlastRadius;
  advice: FleetAdvice;
}

/** Fetch the fleet overview and compose all engines client-side. Fail-open: returns null on error. */
export async function getStoreFleetIntel(
  window: FleetWindow = '24h', environment: string | null = null, release: string | null = null, brand: string | null = null,
): Promise<FleetIntelBundle | null> {
  const { data, error } = await supabase.rpc('admin_store_fleet_overview', {
    p_window: window, p_environment: environment, p_release: release, p_brand: brand,
  });
  if (error) throw error;
  const res = (data ?? {}) as { ok?: boolean; total_stores?: number; stores?: FleetOverviewRow[] };
  if (!res.ok) return null;
  const rows = res.stores ?? [];
  const stores = rows.map((r) => computeStoreHealth(rowToInput(r)));
  const overview = computeFleetHealth(stores);
  const incidents = detectStoreIncidents(stores);
  const blastRadius = computeFleetBlastRadius({ stores, storeAttributionAvailable: true });
  const advice = computeFleetAdvice(overview, blastRadius);
  return { window, totalStores: res.total_stores ?? stores.length, stores, overview, incidents, blastRadius, advice };
}

// ── Store detail + recovery ─────────────────────────────────────────────────
interface StoreDetailRow {
  ok?: boolean;
  store_id?: string;
  observation_window_minutes?: number;
  earlier?: { healthy: number; unhealthy: number } | null;
  recent?: { healthy: number; unhealthy: number } | null;
  recent_series?: number[] | null;
  event_counts?: Record<string, number> | null;
}

export interface StoreDetail {
  storeId: string;
  eventCounts: Record<string, number>;
  recovery: StoreRecoveryResult;
  advice: FleetAdvice | null;
}

export async function getStorePlayerHealthDetail(storeId: string, store: StoreHealthResult | null, window: FleetWindow = '24h'): Promise<StoreDetail | null> {
  const { data, error } = await supabase.rpc('admin_store_player_health', { p_store_id: storeId, p_window: window });
  if (error) throw error;
  const res = (data ?? {}) as StoreDetailRow;
  if (!res.ok) return null;
  const earlier = res.earlier ?? { healthy: 0, unhealthy: 0 };
  const recent = res.recent ?? { healthy: 0, unhealthy: 0 };
  const series = res.recent_series ?? [];
  let trailing = 0;
  for (let i = series.length - 1; i >= 0; i--) { if (series[i] === 0) trailing++; else break; }
  const recovery = computeStoreRecovery({
    earlier: { healthyHeartbeats: earlier.healthy, unhealthyHeartbeats: earlier.unhealthy },
    recent: { healthyHeartbeats: recent.healthy, unhealthyHeartbeats: recent.unhealthy },
    observationWindowMinutes: res.observation_window_minutes ?? 0,
    recentSeries: series, trailingHealthyStreak: trailing,
  });
  return { storeId, eventCounts: res.event_counts ?? {}, recovery, advice: store ? computeStoreAdvice(store) : null };
}
