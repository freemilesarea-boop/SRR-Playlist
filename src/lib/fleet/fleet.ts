// WEB-OBS-6 — Fleet-level aggregation: overview + health score, store incidents, and fleet blast
// radius (pure, unit-tested). Everything is rule-based. A thin fleet (< FLEET_MIN_STORES) or thin
// per-dimension sample → INSUFFICIENT_DATA / NOT_AVAILABLE, never a fabricated fleet number, and a
// small sample can never assert a BRAND-wide / ENTERPRISE-wide / RELEASE-specific failure.

import { round, safeRatio } from '../observability/math';
import type { Confidence } from '../observability/release';
import type { StoreHealthResult, FleetHealthStatus } from './types';
import {
  FLEET_HEALTH_WEIGHTS, FLEET_BAND_HEALTHY, FLEET_BAND_WATCH, FLEET_BAND_DEGRADED,
  FLEET_OFFLINE_CRITICAL_RATE, FLEET_MIN_STORES,
  INCIDENT_BRAND_MIN_STORES, INCIDENT_BRAND_MIN_AFFECTED_RATE, INCIDENT_RELEASE_MIN_STORES,
  FLEET_BLAST_ISOLATED_MAX, FLEET_BLAST_LIMITED_MAX, FLEET_BLAST_MODERATE_MAX, FLEET_BLAST_WIDESPREAD_MAX,
  FLEET_BLAST_MIN_AFFECTED_STORES, FLEET_BLAST_MIN_TOTAL_STORES, FLEET_BLAST_CRITICAL_SEVERE_STORES,
} from './thresholds';

// ── Fleet overview ──────────────────────────────────────────────────────────
export interface FleetOverview {
  totalStores: number;
  online: number; degraded: number; stale: number; offline: number; unknown: number; insufficient: number;
  playing: number; stalled: number; silenceSuspected: number; queueEmpty: number;
  schedulerStale: number; networkDegraded: number; audioError: number; networkDisconnected: number;
  repetitionAnomaly: number;
  healthScore: number | null;
  status: FleetHealthStatus;
  confidence: Confidence;
  insufficientData: boolean;
  worstStores: StoreHealthResult[];
  reason: string;
}

function fleetConfidence(n: number): Confidence {
  if (n < FLEET_MIN_STORES) return 'INSUFFICIENT';
  if (n >= 200) return 'HIGH';
  if (n >= 40) return 'MEDIUM';
  return 'LOW';
}

function scoreRank(s: StoreHealthResult): number {
  // worst first: offline/insufficient rank lowest, then by ascending score
  if (s.liveness === 'OFFLINE') return -1;
  if (s.healthScore == null) return 1_000; // insufficient — not "worst", push to the end after real scores
  return s.healthScore;
}

export function computeFleetHealth(stores: StoreHealthResult[]): FleetOverview {
  const total = stores.length;
  const count = (pred: (s: StoreHealthResult) => boolean) => stores.filter(pred).length;

  const offline = count((s) => s.liveness === 'OFFLINE');
  const stale = count((s) => s.liveness === 'STALE');
  const online = count((s) => s.liveness === 'ONLINE');
  const unknown = count((s) => s.liveness === 'UNKNOWN');
  const insufficient = count((s) => s.status === 'INSUFFICIENT_DATA');
  const degraded = count((s) => s.status === 'DEGRADED');
  const stalled = count((s) => s.playback === 'STALLED');
  const silenceSuspected = count((s) => s.playback === 'SILENCE_SUSPECTED' || s.silence === 'SILENCE_SUSPECTED');
  const queueEmpty = count((s) => s.queue === 'EMPTY');
  const schedulerStale = count((s) => s.scheduler === 'STALE');
  const networkDegraded = count((s) => s.network === 'DEGRADED');
  const networkDisconnected = count((s) => s.network === 'DISCONNECTED');
  const playing = count((s) => s.playback === 'PLAYING' || s.playback === 'HEALTHY');
  const repetitionAnomaly = count((s) => s.repetition === 'REPEAT_ANOMALY');

  const worstStores = [...stores].sort((a, b) => scoreRank(a) - scoreRank(b)).slice(0, 5);
  const confidence = fleetConfidence(total);

  const base: Omit<FleetOverview, 'healthScore' | 'status' | 'reason'> = {
    totalStores: total, online, degraded, stale, offline, unknown, insufficient,
    playing, stalled, silenceSuspected, queueEmpty, schedulerStale, networkDegraded,
    audioError: 0, networkDisconnected, repetitionAnomaly, confidence, insufficientData: total < FLEET_MIN_STORES,
    worstStores,
  };

  if (total < FLEET_MIN_STORES) {
    return { ...base, healthScore: null, status: 'INSUFFICIENT_DATA', reason: `telemetry 매장 부족(${total}/${FLEET_MIN_STORES})` };
  }

  // Denominator = stores with a usable (non-insufficient) verdict.
  const scored = stores.filter((s) => s.status !== 'INSUFFICIENT_DATA');
  const denom = scored.length || total;
  const rate = (n: number) => safeRatio(n, denom);
  const rates: Record<keyof typeof FLEET_HEALTH_WEIGHTS, number> = {
    offlineRate: rate(offline),
    staleRate: rate(stale),
    stalledRate: rate(stalled),
    silenceSuspectedRate: rate(silenceSuspected),
    queueEmptyRate: rate(queueEmpty),
    networkDegradedRate: rate(networkDegraded + networkDisconnected),
    recoveryFailedRate: 0, // recovery events deferred (see docs) → no penalty
    repetitionRiskRate: rate(repetitionAnomaly),
    releaseRegressionRate: 0, // computed by the release-compare RPC, not the overview
  };
  let penalty = 0;
  let wSum = 0;
  (Object.keys(FLEET_HEALTH_WEIGHTS) as Array<keyof typeof FLEET_HEALTH_WEIGHTS>).forEach((k) => {
    penalty += FLEET_HEALTH_WEIGHTS[k] * rates[k];
    wSum += FLEET_HEALTH_WEIGHTS[k];
  });
  const score = round((1 - penalty / wSum) * 100, 1) ?? 0;

  const offlineRate = rate(offline);
  let status: FleetHealthStatus;
  if (offlineRate >= FLEET_OFFLINE_CRITICAL_RATE) status = 'CRITICAL';
  else if (score >= FLEET_BAND_HEALTHY) status = 'HEALTHY';
  else if (score >= FLEET_BAND_WATCH) status = 'WATCH';
  else if (score >= FLEET_BAND_DEGRADED) status = 'DEGRADED';
  else status = 'CRITICAL';

  return { ...base, healthScore: score, status, reason: `${scored.length}개 매장 평가 · offline ${(offlineRate * 100).toFixed(1)}%` };
}

// ── Store incidents ─────────────────────────────────────────────────────────
export type StoreIncidentType =
  | 'STORE_OFFLINE' | 'PLAYER_STALE' | 'PLAYBACK_STALLED' | 'SILENCE_SUSPECTED' | 'QUEUE_EMPTY'
  | 'SCHEDULER_STALE' | 'NETWORK_DISCONNECTED' | 'RECONNECT_LOOP' | 'DUPLICATE_TRACK_ANOMALY'
  | 'RELEASE_SPECIFIC_PLAYER_FAILURE' | 'BROWSER_SPECIFIC_PLAYER_FAILURE' | 'BRAND_WIDE_FAILURE';

export type IncidentSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

export interface StoreIncident {
  incidentKey: string;
  type: StoreIncidentType;
  severity: IncidentSeverity;
  scope: 'store' | 'brand' | 'release' | 'browser';
  storeId: string | null;
  storeName: string | null;
  brandId: string | null;
  brandName: string | null;
  release: string | null;
  browser: string | null;
  affectedStores: number;
  evidence: string[];
  confidence: Confidence;
  suggestedAction: string;
}

function perStoreIncident(s: StoreHealthResult): StoreIncident | null {
  const mk = (type: StoreIncidentType, severity: IncidentSeverity, evidence: string[], action: string): StoreIncident => ({
    incidentKey: `store:${s.storeId}:${type}`, type, severity, scope: 'store',
    storeId: s.storeId, storeName: s.storeName, brandId: s.brandId, brandName: s.brandName,
    release: s.release, browser: s.browserFamily, affectedStores: 1, evidence,
    confidence: s.confidence, suggestedAction: action,
  });
  if (s.confidence === 'INSUFFICIENT') return null; // never mint an incident on thin data
  if (s.liveness === 'OFFLINE') return mk('STORE_OFFLINE', 'CRITICAL', [`last seen ${s.lastSeenAgeSec ?? '?'}s ago`], '매장 네트워크/기기 전원 확인 안내(원격 제어 없음)');
  if (s.playback === 'SILENCE_SUSPECTED') return mk('SILENCE_SUSPECTED', 'HIGH', ['재생 상태이나 진행 정체(확정 아님)'], '매장에 실제 소리 출력/볼륨/출력장치 확인 안내');
  if (s.playback === 'STALLED') return mk('PLAYBACK_STALLED', 'HIGH', ['재생 진행 정체'], '플레이어 세션/네트워크 확인 안내');
  if (s.queue === 'EMPTY') return mk('QUEUE_EMPTY', 'MEDIUM', ['Queue 비어 있음'], 'Scheduler/Queue 재생성 상태 확인');
  if (s.network === 'DISCONNECTED') return mk('NETWORK_DISCONNECTED', 'HIGH', ['오프라인 보고'], '매장 인터넷 회선 확인 안내');
  if (s.network === 'DEGRADED') return mk('RECONNECT_LOOP', 'MEDIUM', ['재연결 반복'], '매장 회선 품질 확인 안내');
  if (s.repetition === 'REPEAT_ANOMALY') return mk('DUPLICATE_TRACK_ANOMALY', 'LOW', ['동일 곡 비정상 반복'], 'Playlist 크기/Scheduler 결과 확인');
  if (s.liveness === 'STALE') return mk('PLAYER_STALE', 'MEDIUM', [`last seen ${s.lastSeenAgeSec ?? '?'}s ago`], '플레이어 상태 관찰 — Offline 여부 재평가');
  if (s.scheduler === 'STALE') return mk('SCHEDULER_STALE', 'LOW', ['동일 playlist 장기 유지(약한 신호)'], 'Scheduler 갱신 여부 확인(신호 제한적)');
  return null;
}

export function detectStoreIncidents(stores: StoreHealthResult[]): StoreIncident[] {
  const perStore = stores.map(perStoreIncident).filter((x): x is StoreIncident => x != null);
  const out: StoreIncident[] = [...perStore];

  const affected = new Set(perStore.map((i) => i.storeId));
  const isAffected = (s: StoreHealthResult) => affected.has(s.storeId);

  // Brand-wide: a brand with enough telemetry stores AND ≥ INCIDENT_BRAND_MIN_AFFECTED_RATE affected.
  const byBrand = new Map<string, { name: string | null; total: StoreHealthResult[]; aff: number }>();
  for (const s of stores) {
    if (!s.brandId) continue;
    const g = byBrand.get(s.brandId) ?? { name: s.brandName, total: [], aff: 0 };
    g.total.push(s); if (isAffected(s)) g.aff += 1;
    byBrand.set(s.brandId, g);
  }
  for (const [brandId, g] of byBrand) {
    if (g.total.length < INCIDENT_BRAND_MIN_STORES) continue;
    const rate = safeRatio(g.aff, g.total.length);
    if (rate >= INCIDENT_BRAND_MIN_AFFECTED_RATE) {
      out.push({
        incidentKey: `brand:${brandId}:BRAND_WIDE_FAILURE`, type: 'BRAND_WIDE_FAILURE', severity: 'CRITICAL', scope: 'brand',
        storeId: null, storeName: null, brandId, brandName: g.name, release: null, browser: null,
        affectedStores: g.aff, evidence: [`${g.aff}/${g.total.length} 매장 영향(${(rate * 100).toFixed(0)}%)`],
        confidence: g.total.length >= 10 ? 'MEDIUM' : 'LOW', suggestedAction: '브랜드 공통 원인(정책/릴리스/회선) 조사 — 확정 전 표본 확인',
      });
    }
  }

  // Release-specific: a release with enough stores, all/most affected.
  const byRelease = new Map<string, { total: StoreHealthResult[]; aff: number }>();
  for (const s of stores) {
    const g = byRelease.get(s.release) ?? { total: [], aff: 0 };
    g.total.push(s); if (isAffected(s)) g.aff += 1;
    byRelease.set(s.release, g);
  }
  for (const [release, g] of byRelease) {
    if (g.total.length < INCIDENT_RELEASE_MIN_STORES) continue;
    const rate = safeRatio(g.aff, g.total.length);
    if (rate >= INCIDENT_BRAND_MIN_AFFECTED_RATE) {
      out.push({
        incidentKey: `release:${release}:RELEASE_SPECIFIC_PLAYER_FAILURE`, type: 'RELEASE_SPECIFIC_PLAYER_FAILURE',
        severity: 'HIGH', scope: 'release', storeId: null, storeName: null, brandId: null, brandName: null,
        release, browser: null, affectedStores: g.aff, evidence: [`release ${release}: ${g.aff}/${g.total.length} 매장 영향`],
        confidence: g.total.length >= 10 ? 'MEDIUM' : 'LOW', suggestedAction: '릴리스 상관 조사 — Release Gate/Root Cause 확인',
      });
    }
  }

  return out;
}

// ── Fleet blast radius ──────────────────────────────────────────────────────
export type FleetBlastLevel = 'ISOLATED' | 'LIMITED' | 'MODERATE' | 'WIDESPREAD' | 'CRITICAL' | 'INSUFFICIENT_DATA' | 'NOT_AVAILABLE';

export interface FleetBlastRadius {
  affectedStores: number;
  totalStores: number | null;
  affectedStoreRate: number | null;
  severeStores: number;
  primaryScope: string | null;
  brandsAffected: number;
  releasesAffected: number;
  browsersAffected: number;
  level: FleetBlastLevel;
  confidence: Confidence;
  reason: string;
}

export interface FleetBlastInput {
  stores: StoreHealthResult[];
  /** true only when store_id attribution is present in telemetry (it is, server-derived). */
  storeAttributionAvailable: boolean;
}

export function computeFleetBlastRadius(input: FleetBlastInput): FleetBlastRadius {
  const empty = (level: FleetBlastLevel, reason: string): FleetBlastRadius => ({
    affectedStores: 0, totalStores: input.stores.length || null, affectedStoreRate: null, severeStores: 0,
    primaryScope: null, brandsAffected: 0, releasesAffected: 0, browsersAffected: 0, level,
    confidence: 'INSUFFICIENT', reason,
  });
  if (!input.storeAttributionAvailable) return empty('NOT_AVAILABLE', 'Store attribution 없음 → Blast Radius 제공 불가');

  const stores = input.stores;
  const affectedList = stores.filter((s) => s.status === 'CRITICAL' || s.status === 'OFFLINE' || s.status === 'DEGRADED');
  const affected = affectedList.length;
  const total = stores.length;
  const severe = stores.filter((s) => s.liveness === 'OFFLINE' || s.playback === 'STALLED' || s.playback === 'SILENCE_SUSPECTED').length;
  const brands = new Set(affectedList.map((s) => s.brandId).filter(Boolean)).size;
  const releases = new Set(affectedList.map((s) => s.release)).size;
  const browsers = new Set(affectedList.map((s) => s.browserFamily)).size;

  const base = { affectedStores: affected, totalStores: total, severeStores: severe, brandsAffected: brands, releasesAffected: releases, browsersAffected: browsers };
  if (affected < FLEET_BLAST_MIN_AFFECTED_STORES) {
    return { ...base, affectedStoreRate: total > 0 ? round(safeRatio(affected, total), 4) : null, primaryScope: null, level: 'INSUFFICIENT_DATA', confidence: 'INSUFFICIENT', reason: `영향 매장 부족(${affected}/${FLEET_BLAST_MIN_AFFECTED_STORES})` };
  }
  if (total < FLEET_BLAST_MIN_TOTAL_STORES) {
    return { ...base, affectedStoreRate: round(safeRatio(affected, total), 4), primaryScope: null, level: 'INSUFFICIENT_DATA', confidence: 'INSUFFICIENT', reason: `전체 매장 부족(${total}/${FLEET_BLAST_MIN_TOTAL_STORES})` };
  }

  const rate = safeRatio(affected, total);
  const primaryScope = brands === 1 ? `brand ${affectedList[0].brandName ?? affectedList[0].brandId}` : releases === 1 ? `release ${affectedList[0].release}` : browsers === 1 ? `browser ${affectedList[0].browserFamily}` : null;
  let level: FleetBlastLevel;
  if (severe >= FLEET_BLAST_CRITICAL_SEVERE_STORES || rate > FLEET_BLAST_WIDESPREAD_MAX) level = 'CRITICAL';
  else if (rate > FLEET_BLAST_MODERATE_MAX) level = 'WIDESPREAD';
  else if (rate > FLEET_BLAST_LIMITED_MAX) level = 'MODERATE';
  else if (rate > FLEET_BLAST_ISOLATED_MAX) level = 'LIMITED';
  else level = 'ISOLATED';
  const confidence: Confidence = total >= 200 ? 'HIGH' : total >= 40 ? 'MEDIUM' : 'LOW';

  return { ...base, affectedStoreRate: round(rate, 4), primaryScope, level, confidence, reason: `${affected}/${total} 매장 영향(${(rate * 100).toFixed(1)}%)` };
}
