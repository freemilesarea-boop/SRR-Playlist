// WEB-OBS-6 — Store Fleet Monitoring engine tests (pure, deterministic).

import { describe, it, expect } from 'vitest';
import {
  computeLiveness, computePlaybackHealth, computeSilence, computeQueueHealth,
  computeSchedulerHealth, computeNetworkHealth, computeRepetition, storeConfidence,
} from './signals';
import { computeStoreHealth } from './storeHealth';
import { computeFleetHealth, detectStoreIncidents, computeFleetBlastRadius } from './fleet';
import { computeStoreRecovery } from './storeRecovery';
import { computeStoreAdvice, computeFleetAdvice, fleetActionSafety } from './fleetAdvisor';
import {
  parseFleetEvent, parseFleetBatch, hashTrackId, positionBucketFor, queueLengthBucketFor,
  reconnectBucketFor, schedulerAgeBucketFor, fleetRoute, FLEET_MAX_BATCH_EVENTS,
} from './eventSchema';
import type { StoreHealthInput, StoreHealthResult } from './types';
import { HEARTBEAT_INTERVAL_SEC } from './thresholds';

function input(over: Partial<StoreHealthInput> = {}): StoreHealthInput {
  return {
    storeId: 's1', lastSeenAgeSec: 30, heartbeats: 20, lastVisibility: 'visible',
    lastPlaybackState: 'playing', frozenStreakAtEnd: 0, stalledEvents: 0, silenceSuspectedEvents: 0,
    queueEmptyEvents: 0, lastQueueBucket: 'many', hasNext: true, disconnectEvents: 0, reconnectEvents: 0,
    schedulerAgeBucket: 'fresh', distinctTracks: 30, maxTrackRepeat: 1, transitions: 40, online: true,
    release: 'r1', browserFamily: 'Chrome', deviceClass: 'desktop', repeatMode: 'off',
    storeName: 'Store 1', brandId: 'b1', brandName: 'Brand 1', regionName: 'R1',
    ...over,
  };
}
function result(over: Partial<StoreHealthInput> = {}): StoreHealthResult {
  return computeStoreHealth(input(over));
}

describe('liveness', () => {
  it('ONLINE within stale gate', () => {
    expect(computeLiveness(input({ lastSeenAgeSec: 60 }))).toBe('ONLINE');
  });
  it('never OFFLINE from one missed heartbeat', () => {
    // one missed beat ≈ 2× interval — still within the stale gate (2.5×), so not even STALE
    expect(computeLiveness(input({ lastSeenAgeSec: HEARTBEAT_INTERVAL_SEC * 2 }))).toBe('ONLINE');
  });
  it('STALE then OFFLINE as age grows', () => {
    expect(computeLiveness(input({ lastSeenAgeSec: HEARTBEAT_INTERVAL_SEC * 4 }))).toBe('STALE');
    expect(computeLiveness(input({ lastSeenAgeSec: HEARTBEAT_INTERVAL_SEC * 10 }))).toBe('OFFLINE');
  });
  it('hidden tab widens the gate (not OFFLINE where a visible tab would be)', () => {
    const age = HEARTBEAT_INTERVAL_SEC * 10;
    expect(computeLiveness(input({ lastSeenAgeSec: age, lastVisibility: 'visible' }))).toBe('OFFLINE');
    // hidden multiplies gates ×2 → offline gate becomes 12×; 10× is only STALE
    expect(computeLiveness(input({ lastSeenAgeSec: age, lastVisibility: 'hidden' }))).toBe('STALE');
  });
  it('INSUFFICIENT_DATA below min heartbeats; UNKNOWN when never seen', () => {
    expect(computeLiveness(input({ heartbeats: 1 }))).toBe('INSUFFICIENT_DATA');
    expect(computeLiveness(input({ lastSeenAgeSec: null }))).toBe('UNKNOWN');
  });
});

describe('playback health', () => {
  it('PLAYING when progressing', () => {
    expect(computePlaybackHealth(input())).toBe('PLAYING');
  });
  it('STALLED then SILENCE_SUSPECTED as frozen streak grows', () => {
    expect(computePlaybackHealth(input({ frozenStreakAtEnd: 2 }))).toBe('STALLED');
    expect(computePlaybackHealth(input({ frozenStreakAtEnd: 3 }))).toBe('SILENCE_SUSPECTED');
  });
  it('paused is never asserted as a fault', () => {
    expect(computePlaybackHealth(input({ lastPlaybackState: 'paused' }))).toBe('PAUSED_EXPECTED');
  });
  it('QUEUE_EMPTY when queue empty; OFFLINE when offline', () => {
    expect(computePlaybackHealth(input({ lastQueueBucket: 'empty' }))).toBe('QUEUE_EMPTY');
    expect(computePlaybackHealth(input({ online: false }))).toBe('OFFLINE');
  });
  it('INSUFFICIENT_DATA below min heartbeats', () => {
    expect(computePlaybackHealth(input({ heartbeats: 1 }))).toBe('INSUFFICIENT_DATA');
  });
});

describe('silence — never confirmed, only suspected', () => {
  it('SILENCE_SUSPECTED on sustained frozen progress while playing', () => {
    expect(computeSilence(input({ frozenStreakAtEnd: 3 }))).toBe('SILENCE_SUSPECTED');
  });
  it('PLAYBACK_PROGRESSING when advancing', () => {
    expect(computeSilence(input({ frozenStreakAtEnd: 0 }))).toBe('PLAYBACK_PROGRESSING');
  });
  it('never returns AUDIO_CONFIRMED (no analyser)', () => {
    const states = ['playing', 'paused', 'stopped', 'unknown'] as const;
    for (const st of states) for (let f = 0; f < 6; f++) {
      expect(computeSilence(input({ lastPlaybackState: st, frozenStreakAtEnd: f }))).not.toBe('AUDIO_CONFIRMED');
    }
  });
  it('NO_DATA below min heartbeats; UNKNOWN when not playing', () => {
    expect(computeSilence(input({ heartbeats: 1 }))).toBe('NO_DATA');
    expect(computeSilence(input({ lastPlaybackState: 'paused' }))).toBe('UNKNOWN');
  });
});

describe('queue / scheduler / network', () => {
  it('queue health from bucket', () => {
    expect(computeQueueHealth(input({ lastQueueBucket: 'empty' }))).toBe('EMPTY');
    expect(computeQueueHealth(input({ lastQueueBucket: 'low' }))).toBe('LOW');
    expect(computeQueueHealth(input({ lastQueueBucket: 'many' }))).toBe('HEALTHY');
  });
  it('scheduler usually NO_DATA (no real refresh signal)', () => {
    expect(computeSchedulerHealth(input({ schedulerAgeBucket: 'unknown' }))).toBe('NO_DATA');
    expect(computeSchedulerHealth(input({ schedulerAgeBucket: 'stale' }))).toBe('STALE');
    expect(computeSchedulerHealth(input({ schedulerAgeBucket: 'fresh' }))).toBe('HEALTHY');
  });
  it('network health: disconnected / reconnect loop / recovered', () => {
    expect(computeNetworkHealth(input({ online: false }))).toBe('DISCONNECTED');
    expect(computeNetworkHealth(input({ reconnectEvents: 5 }))).toBe('DEGRADED');
    expect(computeNetworkHealth(input({ disconnectEvents: 1, reconnectEvents: 1 }))).toBe('RECOVERED');
    expect(computeNetworkHealth(input())).toBe('HEALTHY');
  });
});

describe('repetition — intended repeat excluded, small playlist insufficient', () => {
  it('repeat=one is NORMAL (intended)', () => {
    expect(computeRepetition(input({ repeatMode: 'one', maxTrackRepeat: 20 }))).toBe('NORMAL');
  });
  it('small playlist → INSUFFICIENT_DATA', () => {
    expect(computeRepetition(input({ distinctTracks: 3, transitions: 20, maxTrackRepeat: 6 }))).toBe('INSUFFICIENT_DATA');
    expect(computeRepetition(input({ transitions: 4 }))).toBe('INSUFFICIENT_DATA');
  });
  it('warning then anomaly', () => {
    expect(computeRepetition(input({ maxTrackRepeat: 3 }))).toBe('REPEAT_WARNING');
    expect(computeRepetition(input({ maxTrackRepeat: 5 }))).toBe('REPEAT_ANOMALY');
  });
});

describe('store confidence — hidden downgraded, sparse insufficient', () => {
  it('hidden never HIGH', () => {
    expect(storeConfidence(input({ heartbeats: 100, lastVisibility: 'hidden' }))).toBe('LOW');
  });
  it('sparse → INSUFFICIENT', () => {
    expect(storeConfidence(input({ heartbeats: 1 }))).toBe('INSUFFICIENT');
  });
});

describe('store health rollup', () => {
  it('healthy store scores high, HEALTHY band', () => {
    const r = result();
    expect(r.healthScore).not.toBeNull();
    expect(r.healthScore!).toBeGreaterThanOrEqual(90);
    expect(r.status).toBe('HEALTHY');
  });
  it('offline store → OFFLINE band regardless of score', () => {
    const r = result({ lastSeenAgeSec: HEARTBEAT_INTERVAL_SEC * 12, online: false });
    expect(r.status).toBe('OFFLINE');
  });
  it('insufficient telemetry → INSUFFICIENT_DATA, null score', () => {
    const r = result({ heartbeats: 1 });
    expect(r.status).toBe('INSUFFICIENT_DATA');
    expect(r.healthScore).toBeNull();
  });
  it('stalled store is degraded/critical', () => {
    const r = result({ frozenStreakAtEnd: 3 });
    expect(['DEGRADED', 'CRITICAL']).toContain(r.status);
  });
});

describe('fleet health', () => {
  it('INSUFFICIENT_DATA below min stores', () => {
    const o = computeFleetHealth([result(), result()]);
    expect(o.status).toBe('INSUFFICIENT_DATA');
    expect(o.healthScore).toBeNull();
  });
  it('healthy fleet is HEALTHY', () => {
    const stores = Array.from({ length: 10 }, (_, i) => result({ storeId: `s${i}` }));
    const o = computeFleetHealth(stores);
    expect(o.status).toBe('HEALTHY');
    expect(o.totalStores).toBe(10);
    expect(o.online).toBe(10);
  });
  it('high offline rate forces CRITICAL; average never hides it (worst stores surfaced)', () => {
    const good = Array.from({ length: 6 }, (_, i) => result({ storeId: `g${i}` }));
    const bad = Array.from({ length: 4 }, (_, i) => result({ storeId: `b${i}`, lastSeenAgeSec: HEARTBEAT_INTERVAL_SEC * 12, online: false }));
    const o = computeFleetHealth([...good, ...bad]);
    expect(o.offline).toBe(4);
    expect(o.status).toBe('CRITICAL'); // 40% offline > critical rate
    expect(o.worstStores[0].liveness).toBe('OFFLINE');
  });
});

describe('store incidents — small sample cannot mint brand-wide', () => {
  it('per-store offline incident', () => {
    const incidents = detectStoreIncidents([result({ lastSeenAgeSec: HEARTBEAT_INTERVAL_SEC * 12, online: false })]);
    expect(incidents.some((i) => i.type === 'STORE_OFFLINE')).toBe(true);
  });
  it('two offline stores in a tiny brand do NOT assert BRAND_WIDE_FAILURE', () => {
    const stores = [
      result({ storeId: 'a', brandId: 'bx', lastSeenAgeSec: HEARTBEAT_INTERVAL_SEC * 12, online: false }),
      result({ storeId: 'b', brandId: 'bx', lastSeenAgeSec: HEARTBEAT_INTERVAL_SEC * 12, online: false }),
    ];
    const incidents = detectStoreIncidents(stores);
    expect(incidents.some((i) => i.type === 'BRAND_WIDE_FAILURE')).toBe(false);
  });
  it('brand-wide failure only with enough stores and high affected rate', () => {
    const stores = Array.from({ length: 5 }, (_, i) => result({ storeId: `s${i}`, brandId: 'bx', lastSeenAgeSec: HEARTBEAT_INTERVAL_SEC * 12, online: false }));
    const incidents = detectStoreIncidents(stores);
    expect(incidents.some((i) => i.type === 'BRAND_WIDE_FAILURE')).toBe(true);
  });
  it('never mints an incident on insufficient confidence', () => {
    const incidents = detectStoreIncidents([result({ heartbeats: 1, online: false })]);
    expect(incidents.length).toBe(0);
  });
});

describe('fleet blast radius — store/session distinction & attribution', () => {
  it('NOT_AVAILABLE without store attribution', () => {
    const b = computeFleetBlastRadius({ stores: [], storeAttributionAvailable: false });
    expect(b.level).toBe('NOT_AVAILABLE');
  });
  it('INSUFFICIENT_DATA below min total stores', () => {
    const stores = Array.from({ length: 3 }, (_, i) => result({ storeId: `s${i}`, online: false, lastSeenAgeSec: HEARTBEAT_INTERVAL_SEC * 12 }));
    const b = computeFleetBlastRadius({ stores, storeAttributionAvailable: true });
    expect(b.level).toBe('INSUFFICIENT_DATA');
  });
  it('rate-based level over a real fleet', () => {
    const good = Array.from({ length: 18 }, (_, i) => result({ storeId: `g${i}` }));
    const bad = Array.from({ length: 2 }, (_, i) => result({ storeId: `b${i}`, online: false, lastSeenAgeSec: HEARTBEAT_INTERVAL_SEC * 12 }));
    const b = computeFleetBlastRadius({ stores: [...good, ...bad], storeAttributionAvailable: true });
    expect(b.totalStores).toBe(20);
    expect(b.affectedStores).toBe(2);
    expect(['ISOLATED', 'LIMITED', 'MODERATE']).toContain(b.level);
  });
});

describe('store recovery — one beat is never RECOVERED, operator close required', () => {
  it('NOT_STARTED below window', () => {
    const r = computeStoreRecovery({ earlier: { healthyHeartbeats: 5, unhealthyHeartbeats: 5 }, recent: { healthyHeartbeats: 5, unhealthyHeartbeats: 0 }, observationWindowMinutes: 10, recentSeries: [0, 0, 0], trailingHealthyStreak: 3 });
    expect(r.status).toBe('NOT_STARTED');
    expect(r.operatorCloseRequired).toBe(true);
  });
  it('RECOVERED needs a trailing healthy streak + low unhealthy rate', () => {
    const r = computeStoreRecovery({ earlier: { healthyHeartbeats: 2, unhealthyHeartbeats: 8 }, recent: { healthyHeartbeats: 10, unhealthyHeartbeats: 0 }, observationWindowMinutes: 60, recentSeries: [0, 0, 0, 0, 0], trailingHealthyStreak: 5 });
    expect(r.status).toBe('RECOVERED');
    expect(r.operatorCloseRequired).toBe(true);
  });
  it('recurrence re-opens as REGRESSED', () => {
    const r = computeStoreRecovery({ earlier: { healthyHeartbeats: 2, unhealthyHeartbeats: 8 }, recent: { healthyHeartbeats: 5, unhealthyHeartbeats: 3 }, observationWindowMinutes: 60, recentSeries: [1, 0, 0, 1, 1], trailingHealthyStreak: 0 });
    expect(r.status).toBe('REGRESSED');
  });
  it('INSUFFICIENT_DATA when a side is thin', () => {
    const r = computeStoreRecovery({ earlier: { healthyHeartbeats: 1, unhealthyHeartbeats: 1 }, recent: { healthyHeartbeats: 10, unhealthyHeartbeats: 0 }, observationWindowMinutes: 60, recentSeries: [0, 0, 0], trailingHealthyStreak: 3 });
    expect(r.status).toBe('INSUFFICIENT_DATA');
  });
});

describe('advisor — recommendation only, NEVER executed, no remote control', () => {
  it('every action is automated:false, requiresApproval:true, remoteControl:false', () => {
    const cats = ['MONITOR_RECOVERY', 'VERIFY_STORE_NETWORK', 'VERIFY_AUDIO_OUTPUT', 'CONTACT_STORE', 'HOLD_RELEASE', 'PREPARE_ROLLBACK', 'ESCALATE_INFRA'] as const;
    for (const c of cats) {
      const s = fleetActionSafety(c);
      expect(s.automated).toBe(false);
      expect(s.requiresApproval).toBe(true);
      expect(s.remoteControl).toBe(false);
    }
  });
  it('offline store → CONTACT_STORE (guidance, not remote action)', () => {
    const a = computeStoreAdvice(result({ lastSeenAgeSec: HEARTBEAT_INTERVAL_SEC * 12, online: false }));
    expect(a.recommendedAction).toBe('CONTACT_STORE');
    expect(a.safety.remoteControl).toBe(false);
  });
  it('silence suspected → VERIFY_AUDIO_OUTPUT', () => {
    const a = computeStoreAdvice(result({ frozenStreakAtEnd: 3 }));
    expect(a.recommendedAction).toBe('VERIFY_AUDIO_OUTPUT');
  });
  it('insufficient confidence → MONITOR_RECOVERY (no confident action)', () => {
    const a = computeStoreAdvice(result({ heartbeats: 1 }));
    expect(a.recommendedAction).toBe('MONITOR_RECOVERY');
  });
  it('fleet advice on thin fleet is MONITOR_RECOVERY', () => {
    const o = computeFleetHealth([result(), result()]);
    const b = computeFleetBlastRadius({ stores: [result(), result()], storeAttributionAvailable: true });
    expect(computeFleetAdvice(o, b).recommendedAction).toBe('MONITOR_RECOVERY');
  });
});

describe('event schema — privacy & sanitization', () => {
  it('hashes track ids non-reversibly (never echoes raw id)', () => {
    const h = hashTrackId('11111111-2222-3333-4444-555555555555');
    expect(h).not.toBeNull();
    expect(h).not.toContain('1111');
    expect(h!.length).toBeLessThanOrEqual(16);
    expect(hashTrackId(null)).toBeNull();
  });
  it('buckets position / queue / reconnect / scheduler', () => {
    expect(positionBucketFor(0, 100)).toBe('start');
    expect(positionBucketFor(99, 100)).toBe('end');
    expect(positionBucketFor(null, null)).toBe('unknown');
    expect(queueLengthBucketFor(0)).toBe('empty');
    expect(queueLengthBucketFor(50)).toBe('many');
    expect(reconnectBucketFor(9)).toBe('loop');
    expect(schedulerAgeBucketFor(null)).toBe('unknown');
    expect(schedulerAgeBucketFor(20)).toBe('stale');
  });
  it('normalizes routes to fleet routes only', () => {
    expect(fleetRoute('/store/player')).toBe('/store/player');
    expect(fleetRoute('/brand/abc/player')).toBe('/brand/player');
    expect(fleetRoute('/admin/whatever')).toBe('other');
  });
  it('parseFleetEvent drops unknown fields and coerces enums; rejects missing ids', () => {
    const ev = parseFleetEvent({
      event_id: 'e1', player_session_id: 'p1', event_type: 'player_heartbeat',
      playback_state: 'nonsense', position_bucket: 'mid', current_track_hash: 'abc', online: true,
      secret_token: 'should-be-dropped', store_id: 'should-be-ignored',
    });
    expect(ev).not.toBeNull();
    expect(ev!.playback_state).toBe('unknown'); // bad enum coerced
    expect((ev as unknown as Record<string, unknown>).secret_token).toBeUndefined();
    expect((ev as unknown as Record<string, unknown>).store_id).toBeUndefined(); // no store id on the wire
    expect(parseFleetEvent({ event_type: 'player_heartbeat' })).toBeNull(); // missing ids
  });
  it('parseFleetBatch caps the batch size', () => {
    const many = Array.from({ length: 100 }, (_, i) => ({ event_id: `e${i}`, player_session_id: 'p', event_type: 'player_heartbeat' }));
    expect(parseFleetBatch(many).length).toBe(FLEET_MAX_BATCH_EVENTS);
    expect(parseFleetBatch({ events: many }).length).toBe(FLEET_MAX_BATCH_EVENTS);
  });
});
