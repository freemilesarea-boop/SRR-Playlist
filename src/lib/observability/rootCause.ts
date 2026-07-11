// WEB-OBS-4 — Root Cause Analysis & Rollback Advisor (pure, unit-tested, rule-based — NO ML).
//
// Answers "WHY did this incident happen?" from the persistent RUM alone. Every cause, correlation,
// timeline entry, rollback recommendation and explanation is a deterministic function of documented
// thresholds — fully auditable, reproducible, no guessing. **Commit CONTENT is never inspected**: we
// correlate only release-id ↔ metric-change (release == build id == the Sentry release, a git SHA).
// Below the concentration / affected-session gates → INSUFFICIENT_DATA, never a fabricated cause.

import { clamp, safeRatio, percentChange, round } from './math';
import type { Confidence } from './release';
import {
  RC_ROUTE_CONCENTRATION, RC_BROWSER_CONCENTRATION, RC_MIN_AFFECTED_SESSIONS,
  RC_ERROR_SPIKE_REL, RC_ERROR_SPIKE_ABS, RC_CORR_STRONG, RC_CORR_MODERATE,
  RB_BLOCK_CRITICAL_RATE, RB_BLOCK_CHUNK_RATE, RB_ROLLBACK_ERROR_RATE, RB_ROLLBACK_ERROR_SPIKE_REL,
  RB_ROLLBACK_SPIKE_ABS, RB_WATCH_ERROR_RATE, RELEASE_CONF_MIN_SESSIONS, RELEASE_CONF_HIGH_SESSIONS,
  RELEASE_CONF_MEDIUM_SESSIONS, RELEASE_CONF_MIN_EVENTS, RELEASE_CONF_MIN_BROWSERS,
} from './thresholds';

// ── Inputs ────────────────────────────────────────────────────────────────────
export interface DimCount { key: string; sessions: number; count: number; }
export interface BrowserErr { browser: string; errorSessions: number; totalSessions: number; }

/** Per-release error profile — the flat, explicit shape the engine consumes (mapped from the RPC). */
export interface ReleaseErrorProfile {
  release: string;
  sessions: number;
  events: number;
  errorSessions: number;
  errorEvents: number;
  criticalEvents: number;
  chunkSessions: number;
  hydrationSessions: number;
  memoryRiskSessions: number;
  longTaskEvents: number;
  apiP95: number | null;
  lcpP75: number | null;
  browsers: number;
  byBrowser: BrowserErr[];
  byKind: DimCount[];  // chunk-load / react / js / unhandledrejection / resource / other
  byRoute: DimCount[]; // error sessions per route
}

export interface TimelineRelease {
  release: string;
  firstSeen: string | null;
  lastSeen: string | null;
  sessions: number;
  events: number;
  errorEvents: number;
  chunkSessions: number;
}

// ── Confidence (release-level, mirrors releaseQuality) ──────────────────────
export function rootCauseConfidence(sig: { sessions: number; events: number; browsers: number }): Confidence {
  if (sig.sessions < RELEASE_CONF_MIN_SESSIONS || sig.events < RELEASE_CONF_MIN_EVENTS) return 'INSUFFICIENT';
  if (sig.sessions >= RELEASE_CONF_HIGH_SESSIONS && sig.browsers >= RELEASE_CONF_MIN_BROWSERS) return 'HIGH';
  if (sig.sessions >= RELEASE_CONF_MEDIUM_SESSIONS) return 'MEDIUM';
  return 'LOW';
}

function affectedConfidence(sessions: number, browsers: number): Confidence {
  if (sessions < RC_MIN_AFFECTED_SESSIONS) return 'INSUFFICIENT';
  if (sessions >= 50 && browsers >= 2) return 'HIGH';
  if (sessions >= 15) return 'MEDIUM';
  return 'LOW';
}

// ════════════════════════════════════════════════════════════════════════════
// 1. Root Cause candidates
// ════════════════════════════════════════════════════════════════════════════
export type RootCauseCode =
  | 'RELEASE_ERROR_SPIKE' | 'CHUNK_DEPLOY' | 'HYDRATION_MISMATCH' | 'BROWSER_SPECIFIC'
  | 'ROUTE_CONCENTRATION' | 'API_LATENCY' | 'MEMORY_PRESSURE' | 'LONG_TASK' | 'RUNTIME_ERROR';

export interface RootCause {
  code: RootCauseCode;
  title: string;
  score: number;        // 0..100 likelihood
  confidence: Confidence;
  release: string | null;
  route: string | null;
  api: string | null;
  browser: string | null;
  affectedSessions: number;
  evidence: string[];
}

const RANK_UNIT = 100;

export function analyzeRootCauses(cand: ReleaseErrorProfile, base: ReleaseErrorProfile | null): RootCause[] {
  const out: RootCause[] = [];
  const errRate = safeRatio(cand.errorEvents, cand.events);
  const baseErrRate = base ? safeRatio(base.errorEvents, base.events) : 0;

  // RELEASE_ERROR_SPIKE — candidate error rate up sharply vs baseline (rel AND abs gates).
  if (base && errRate >= baseErrRate * RC_ERROR_SPIKE_REL && errRate - baseErrRate >= RC_ERROR_SPIKE_ABS && cand.errorSessions >= RC_MIN_AFFECTED_SESSIONS) {
    const ratio = clamp((errRate - baseErrRate) / Math.max(errRate, 0.0001), 0, 1);
    out.push({
      code: 'RELEASE_ERROR_SPIKE', title: '릴리스 이후 Error Rate 급증',
      score: Math.round(60 + 40 * ratio), confidence: rootCauseConfidence(cand),
      release: cand.release, route: null, api: null, browser: null, affectedSessions: cand.errorSessions,
      evidence: [`${base.release} ${(baseErrRate * 100).toFixed(2)}% → ${cand.release} ${(errRate * 100).toFixed(2)}%`],
    });
  }

  // CHUNK_DEPLOY — chunk-load failures concentrated in this release (vs baseline ~0).
  if (cand.chunkSessions >= RC_MIN_AFFECTED_SESSIONS) {
    const baseChunk = base?.chunkSessions ?? 0;
    const newness = clamp((cand.chunkSessions - baseChunk) / Math.max(cand.chunkSessions, 1), 0, 1);
    out.push({
      code: 'CHUNK_DEPLOY', title: 'Chunk 로드 실패 (배포 자산 불일치 의심)',
      score: Math.round(70 + 30 * newness), confidence: affectedConfidence(cand.chunkSessions, cand.browsers),
      release: cand.release, route: null, api: null, browser: null, affectedSessions: cand.chunkSessions,
      evidence: [`chunk-load 실패 ${cand.chunkSessions} 세션${base ? ` (baseline ${baseChunk})` : ''}`],
    });
  }

  // HYDRATION_MISMATCH.
  if (cand.hydrationSessions >= RC_MIN_AFFECTED_SESSIONS) {
    out.push({
      code: 'HYDRATION_MISMATCH', title: 'Hydration 불일치',
      score: 62, confidence: affectedConfidence(cand.hydrationSessions, cand.browsers),
      release: cand.release, route: null, api: null, browser: null, affectedSessions: cand.hydrationSessions,
      evidence: [`hydration 오류 ${cand.hydrationSessions} 세션`],
    });
  }

  // BROWSER_SPECIFIC — one browser holds a dominant share of error sessions AND its error rate ≫ fleet.
  const totalErrSessions = cand.byBrowser.reduce((s, b) => s + b.errorSessions, 0);
  const fleetTotal = cand.byBrowser.reduce((s, b) => s + b.totalSessions, 0);
  const fleetErrRate = safeRatio(totalErrSessions, fleetTotal);
  for (const b of cand.byBrowser) {
    const share = safeRatio(b.errorSessions, totalErrSessions);
    const brErrRate = safeRatio(b.errorSessions, b.totalSessions);
    if (b.errorSessions >= RC_MIN_AFFECTED_SESSIONS && share >= RC_BROWSER_CONCENTRATION && brErrRate >= Math.max(0.02, fleetErrRate * 1.5)) {
      out.push({
        code: 'BROWSER_SPECIFIC', title: `${b.browser} 특정 오류 편중`,
        score: Math.round(55 + 40 * share), confidence: affectedConfidence(b.errorSessions, 1),
        release: cand.release, route: null, api: null, browser: b.browser, affectedSessions: b.errorSessions,
        evidence: [`${b.browser} 오류 세션 ${b.errorSessions} (${(share * 100).toFixed(0)}% 집중), rate ${(brErrRate * 100).toFixed(1)}% vs 전체 ${(fleetErrRate * 100).toFixed(1)}%`],
      });
    }
  }

  // ROUTE_CONCENTRATION — errors concentrated on one route.
  const routeTotal = cand.byRoute.reduce((s, r) => s + r.sessions, 0);
  const topRoute = [...cand.byRoute].sort((a, b) => b.sessions - a.sessions)[0];
  if (topRoute && topRoute.sessions >= RC_MIN_AFFECTED_SESSIONS) {
    const share = safeRatio(topRoute.sessions, routeTotal);
    if (share >= RC_ROUTE_CONCENTRATION) {
      out.push({
        code: 'ROUTE_CONCENTRATION', title: `오류가 ${topRoute.key} 라우트에 집중`,
        score: Math.round(50 + 40 * share), confidence: affectedConfidence(topRoute.sessions, cand.browsers),
        release: cand.release, route: topRoute.key, api: null, browser: null, affectedSessions: topRoute.sessions,
        evidence: [`${topRoute.key} 오류 세션 ${topRoute.sessions} (${(share * 100).toFixed(0)}% 집중)`],
      });
    }
  }

  // API_LATENCY — api p95 high and/or regressed vs baseline.
  if (cand.apiP95 != null && cand.apiP95 >= 1500) {
    const rel = base?.apiP95 != null ? percentChange(cand.apiP95, base.apiP95) : null;
    out.push({
      code: 'API_LATENCY', title: 'API 지연(p95) 상승',
      score: rel != null && rel >= 0.3 ? 65 : 52, confidence: rootCauseConfidence(cand),
      release: cand.release, route: null, api: null, browser: null, affectedSessions: cand.sessions,
      evidence: [`API p95 ${Math.round(cand.apiP95)}ms${base?.apiP95 != null ? ` (baseline ${Math.round(base.apiP95)}ms${rel != null ? `, ${(rel * 100).toFixed(0)}%` : ''})` : ''}`],
    });
  }

  // MEMORY_PRESSURE.
  if (cand.memoryRiskSessions >= RC_MIN_AFFECTED_SESSIONS) {
    out.push({
      code: 'MEMORY_PRESSURE', title: '메모리 압박 세션 다발',
      score: 48, confidence: affectedConfidence(cand.memoryRiskSessions, cand.browsers),
      release: cand.release, route: null, api: null, browser: null, affectedSessions: cand.memoryRiskSessions,
      evidence: [`used/limit ≥ 90% 세션 ${cand.memoryRiskSessions}`],
    });
  }

  // RUNTIME_ERROR fallback — generic error presence without a more specific concentration.
  if (out.length === 0 && cand.errorSessions >= RC_MIN_AFFECTED_SESSIONS) {
    out.push({
      code: 'RUNTIME_ERROR', title: '런타임 오류(특정 원인 미집중)',
      score: 40, confidence: affectedConfidence(cand.errorSessions, cand.browsers),
      release: cand.release, route: null, api: null, browser: null, affectedSessions: cand.errorSessions,
      evidence: [`오류 세션 ${cand.errorSessions} — 특정 라우트/브라우저/타입 집중 없음`],
    });
  }

  return out.sort((a, b) => b.score - a.score).slice(0, RANK_UNIT);
}

// ════════════════════════════════════════════════════════════════════════════
// 2. Evidence Correlation
// ════════════════════════════════════════════════════════════════════════════
export type CorrStrength = 'STRONG' | 'MODERATE' | 'WEAK' | 'NONE' | 'INSUFFICIENT_DATA';
export interface Correlation { pair: string; strength: CorrStrength; scoreValue: number | null; evidence: string; }

function bandStrength(score: number | null, affected: number): CorrStrength {
  if (score == null) return 'INSUFFICIENT_DATA';
  if (affected < RC_MIN_AFFECTED_SESSIONS) return 'INSUFFICIENT_DATA';
  if (score >= RC_CORR_STRONG) return 'STRONG';
  if (score >= RC_CORR_MODERATE) return 'MODERATE';
  if (score > 0.05) return 'WEAK';
  return 'NONE';
}

export function correlateEvidence(cand: ReleaseErrorProfile, base: ReleaseErrorProfile | null): Correlation[] {
  const out: Correlation[] = [];
  const errRate = safeRatio(cand.errorEvents, cand.events);
  const baseErrRate = base ? safeRatio(base.errorEvents, base.events) : null;

  // Release ↔ Error
  {
    const score = baseErrRate != null && errRate > 0 ? clamp((errRate - baseErrRate) / errRate, 0, 1) : null;
    out.push({ pair: 'Release ↔ Error', strength: bandStrength(score, cand.errorSessions), scoreValue: round(score, 2),
      evidence: baseErrRate != null ? `error rate ${(baseErrRate * 100).toFixed(2)}% → ${(errRate * 100).toFixed(2)}%` : 'baseline 없음' });
  }
  // Browser ↔ Error (top browser share)
  {
    const totalErr = cand.byBrowser.reduce((s, b) => s + b.errorSessions, 0);
    const top = [...cand.byBrowser].sort((a, b) => b.errorSessions - a.errorSessions)[0];
    const score = top && totalErr > 0 ? safeRatio(top.errorSessions, totalErr) : null;
    out.push({ pair: 'Browser ↔ Error', strength: bandStrength(score, top?.errorSessions ?? 0), scoreValue: round(score, 2),
      evidence: top ? `${top.browser}가 오류 세션의 ${((score ?? 0) * 100).toFixed(0)}%` : '데이터 없음' });
  }
  // Chunk ↔ Release
  {
    const baseChunk = base?.chunkSessions ?? 0;
    const score = cand.chunkSessions > 0 ? clamp((cand.chunkSessions - baseChunk) / cand.chunkSessions, 0, 1) : (cand.chunkSessions === 0 ? 0 : null);
    out.push({ pair: 'Chunk ↔ Release', strength: cand.chunkSessions === 0 ? 'NONE' : bandStrength(score, cand.chunkSessions), scoreValue: round(score, 2),
      evidence: `chunk 실패 ${cand.chunkSessions} 세션${base ? ` (baseline ${baseChunk})` : ''}` });
  }
  // Hydration ↔ Browser
  {
    const score = cand.hydrationSessions >= RC_MIN_AFFECTED_SESSIONS ? clamp(cand.hydrationSessions / Math.max(cand.errorSessions, 1), 0, 1) : (cand.hydrationSessions === 0 ? 0 : null);
    out.push({ pair: 'Hydration ↔ Browser', strength: cand.hydrationSessions === 0 ? 'NONE' : bandStrength(score, cand.hydrationSessions), scoreValue: round(score, 2),
      evidence: `hydration ${cand.hydrationSessions} 세션` });
  }
  // Route ↔ API (both concentrated?)
  {
    const routeTotal = cand.byRoute.reduce((s, r) => s + r.sessions, 0);
    const top = [...cand.byRoute].sort((a, b) => b.sessions - a.sessions)[0];
    const routeShare = top && routeTotal > 0 ? safeRatio(top.sessions, routeTotal) : null;
    const apiHot = cand.apiP95 != null && cand.apiP95 >= 1500;
    const score = routeShare != null ? (apiHot ? routeShare : routeShare * 0.5) : null;
    out.push({ pair: 'Route ↔ API', strength: bandStrength(score, top?.sessions ?? 0), scoreValue: round(score, 2),
      evidence: top ? `${top.key} 집중 + API p95 ${cand.apiP95 != null ? `${Math.round(cand.apiP95)}ms` : 'n/a'}` : '데이터 없음' });
  }
  // LongTask ↔ LCP
  {
    const lt = cand.longTaskEvents;
    const lcpBad = cand.lcpP75 != null && cand.lcpP75 > 2500;
    const score = lt > 0 && cand.lcpP75 != null ? (lcpBad ? clamp(lt / Math.max(cand.sessions, 1), 0, 1) : 0.1) : null;
    out.push({ pair: 'LongTask ↔ LCP', strength: bandStrength(score, lt >= RC_MIN_AFFECTED_SESSIONS ? lt : 0), scoreValue: round(score, 2),
      evidence: cand.lcpP75 != null ? `long task ${lt} · LCP p75 ${Math.round(cand.lcpP75)}ms` : 'LCP 데이터 없음' });
  }
  // Device ↔ Memory
  {
    const score = cand.memoryRiskSessions >= RC_MIN_AFFECTED_SESSIONS ? clamp(cand.memoryRiskSessions / Math.max(cand.sessions, 1), 0, 1) : (cand.memoryRiskSessions === 0 ? 0 : null);
    out.push({ pair: 'Device ↔ Memory', strength: cand.memoryRiskSessions === 0 ? 'NONE' : bandStrength(score, cand.memoryRiskSessions), scoreValue: round(score, 2),
      evidence: `memory risk ${cand.memoryRiskSessions} 세션` });
  }
  return out;
}

// ════════════════════════════════════════════════════════════════════════════
// 3. Commit Correlation (release-id ↔ metric change — NO commit content)
// ════════════════════════════════════════════════════════════════════════════
export interface CommitCorrelation {
  release: string;          // == build id (git SHA); NOT the commit message
  firstSeen: string | null; // ≈ first telemetry after deploy
  errorRate: number;
  errorRateDeltaVsPrev: number | null;
  note: string;
}

/** Correlate each release to its error-rate change vs the previous (older) release. Content never read. */
export function commitCorrelation(timeline: readonly TimelineRelease[]): CommitCorrelation[] {
  const ordered = [...timeline].sort((a, b) => (a.firstSeen ?? '').localeCompare(b.firstSeen ?? ''));
  return ordered.map((r, i) => {
    const errorRate = safeRatio(r.errorEvents, r.events);
    const prev = i > 0 ? ordered[i - 1] : null;
    const prevRate = prev ? safeRatio(prev.errorEvents, prev.events) : null;
    const delta = prevRate != null ? round(errorRate - prevRate, 4) : null;
    return {
      release: r.release, firstSeen: r.firstSeen, errorRate: round(errorRate, 4) ?? 0,
      errorRateDeltaVsPrev: delta,
      note: delta == null ? '이전 릴리스 없음(delta 계산 불가)' : delta > 0 ? `이전 릴리스 대비 error +${(delta * 100).toFixed(2)}pp` : `이전 릴리스 대비 error ${(delta * 100).toFixed(2)}pp`,
    };
  });
}

// ════════════════════════════════════════════════════════════════════════════
// 4. Release Timeline
// ════════════════════════════════════════════════════════════════════════════
export type TimelineHealth = 'healthy' | 'degraded' | 'critical' | 'unknown';
export interface TimelineEntry {
  release: string; deployAt: string | null; lastSeen: string | null;
  sessions: number; events: number; errorRate: number; chunkSessions: number; health: TimelineHealth;
}

export function buildTimeline(timeline: readonly TimelineRelease[]): TimelineEntry[] {
  return [...timeline]
    .sort((a, b) => (b.firstSeen ?? '').localeCompare(a.firstSeen ?? '')) // newest first
    .map((r) => {
      const errorRate = safeRatio(r.errorEvents, r.events);
      const chunkRate = safeRatio(r.chunkSessions, r.sessions);
      const health: TimelineHealth = r.events < 20 ? 'unknown'
        : chunkRate >= RB_BLOCK_CHUNK_RATE || errorRate >= RB_ROLLBACK_ERROR_RATE ? 'critical'
          : errorRate >= RB_WATCH_ERROR_RATE ? 'degraded' : 'healthy';
      return { release: r.release, deployAt: r.firstSeen, lastSeen: r.lastSeen, sessions: r.sessions, events: r.events, errorRate: round(errorRate, 4) ?? 0, chunkSessions: r.chunkSessions, health };
    });
}

// ════════════════════════════════════════════════════════════════════════════
// 5. Rollback Advisor (recommendation ONLY — never performs a rollback)
// ════════════════════════════════════════════════════════════════════════════
export type RollbackStatus = 'NO_ACTION' | 'WATCH' | 'ROLLBACK_RECOMMENDED' | 'BLOCK_RELEASE';
export interface RollbackAdvice {
  status: RollbackStatus;
  confidence: Confidence;
  reasons: string[];
  release: string | null;
}

export function rollbackAdvisor(cand: ReleaseErrorProfile, base: ReleaseErrorProfile | null): RollbackAdvice {
  const confidence = rootCauseConfidence(cand);
  const errRate = safeRatio(cand.errorEvents, cand.events);
  const criticalRate = safeRatio(cand.criticalEvents, cand.events);
  const chunkRate = safeRatio(cand.chunkSessions, cand.sessions);
  const baseErrRate = base ? safeRatio(base.errorEvents, base.events) : null;
  const reasons: string[] = [];

  if (confidence === 'INSUFFICIENT') {
    return { status: 'NO_ACTION', confidence, release: cand.release,
      reasons: [`표본 부족(sessions ${cand.sessions}/${RELEASE_CONF_MIN_SESSIONS}, events ${cand.events}/${RELEASE_CONF_MIN_EVENTS}) → INSUFFICIENT_DATA`] };
  }

  // BLOCK_RELEASE — severe, do-not-promote signals.
  if (criticalRate >= RB_BLOCK_CRITICAL_RATE) reasons.push(`critical error ${(criticalRate * 100).toFixed(2)}% ≥ ${(RB_BLOCK_CRITICAL_RATE * 100).toFixed(0)}%`);
  if (chunkRate >= RB_BLOCK_CHUNK_RATE) reasons.push(`chunk 실패 세션 ${(chunkRate * 100).toFixed(2)}% ≥ ${(RB_BLOCK_CHUNK_RATE * 100).toFixed(0)}%`);
  if (reasons.length > 0) return { status: 'BLOCK_RELEASE', confidence, reasons, release: cand.release };

  // ROLLBACK_RECOMMENDED — already-live error storm or a sharp spike vs baseline.
  const spike = baseErrRate != null && errRate >= baseErrRate * RB_ROLLBACK_ERROR_SPIKE_REL && errRate - baseErrRate >= RB_ROLLBACK_SPIKE_ABS;
  if (errRate >= RB_ROLLBACK_ERROR_RATE) reasons.push(`error rate ${(errRate * 100).toFixed(2)}% ≥ ${(RB_ROLLBACK_ERROR_RATE * 100).toFixed(0)}%`);
  if (spike) reasons.push(`baseline 대비 ${(errRate / (baseErrRate || 1)).toFixed(1)}× 급증 (+${((errRate - (baseErrRate ?? 0)) * 100).toFixed(2)}pp)`);
  if (reasons.length > 0) return { status: 'ROLLBACK_RECOMMENDED', confidence, reasons, release: cand.release };

  // WATCH.
  if (errRate >= RB_WATCH_ERROR_RATE) return { status: 'WATCH', confidence, release: cand.release, reasons: [`error rate ${(errRate * 100).toFixed(2)}% ≥ ${(RB_WATCH_ERROR_RATE * 100).toFixed(0)}%`] };

  return { status: 'NO_ACTION', confidence, release: cand.release, reasons: ['임계 초과 신호 없음'] };
}

// ════════════════════════════════════════════════════════════════════════════
// 6. Incident Explanation (rule-templated from evidence — no guessing)
// ════════════════════════════════════════════════════════════════════════════
export function explainIncident(causes: readonly RootCause[], rollback: RollbackAdvice, confidence: Confidence): string[] {
  if (confidence === 'INSUFFICIENT' || causes.length === 0) {
    return ['표본이 부족하여 원인을 단정할 수 없습니다 (INSUFFICIENT_DATA).'];
  }
  const lines = causes.slice(0, 3).map((c) => `${c.title} — ${c.evidence[0] ?? ''} (confidence ${c.confidence}).`);
  lines.push(`종합 Confidence: ${confidence}.`);
  const rb: Record<RollbackStatus, string> = {
    NO_ACTION: 'Rollback 권고: 조치 불필요(NO_ACTION).',
    WATCH: 'Rollback 권고: 관찰(WATCH).',
    ROLLBACK_RECOMMENDED: 'Rollback 권고: 롤백 권장(ROLLBACK_RECOMMENDED) — 표시만, 실제 롤백은 수행되지 않습니다.',
    BLOCK_RELEASE: 'Rollback 권고: 배포 차단(BLOCK_RELEASE) — 표시만, 실제 조치는 수행되지 않습니다.',
  };
  lines.push(rb[rollback.status]);
  return lines;
}

// ════════════════════════════════════════════════════════════════════════════
// 7. Service Dependency Graph (static topology — display only, no service change)
// ════════════════════════════════════════════════════════════════════════════
export interface ServiceNode { id: string; label: string; group: 'client' | 'edge' | 'data' | 'admin'; }
export interface ServiceEdge { from: string; to: string; }

export const SERVICE_NODES: ServiceNode[] = [
  { id: 'app', label: 'App Shell', group: 'client' },
  { id: 'player', label: 'Player', group: 'client' },
  { id: 'queue', label: 'Queue', group: 'client' },
  { id: 'streaming', label: 'Streaming', group: 'client' },
  { id: 'admin', label: 'Admin', group: 'admin' },
  { id: 'telemetry', label: 'Telemetry', group: 'client' },
  { id: 'api', label: 'API (RPC/REST)', group: 'edge' },
  { id: 'auth', label: 'Auth', group: 'edge' },
  { id: 'storage', label: 'Storage', group: 'data' },
  { id: 'scheduler', label: 'Scheduler', group: 'data' },
];

export const SERVICE_EDGES: ServiceEdge[] = [
  { from: 'app', to: 'player' }, { from: 'app', to: 'telemetry' }, { from: 'app', to: 'api' }, { from: 'app', to: 'auth' },
  { from: 'player', to: 'queue' }, { from: 'player', to: 'streaming' }, { from: 'player', to: 'storage' },
  { from: 'streaming', to: 'api' }, { from: 'queue', to: 'api' }, { from: 'admin', to: 'api' },
  { from: 'api', to: 'storage' }, { from: 'api', to: 'scheduler' }, { from: 'telemetry', to: 'api' },
];

export interface ServiceGraphView { nodes: Array<ServiceNode & { impacted: boolean }>; edges: ServiceEdge[]; }

/** Highlight the nodes implicated by the surfaced causes. Purely presentational. */
export function serviceGraph(causes: readonly RootCause[]): ServiceGraphView {
  const impacted = new Set<string>();
  for (const c of causes) {
    if (c.code === 'API_LATENCY') { impacted.add('api'); impacted.add('storage'); }
    if (c.code === 'CHUNK_DEPLOY') { impacted.add('app'); }
    if (c.code === 'HYDRATION_MISMATCH') { impacted.add('app'); }
    if (c.code === 'ROUTE_CONCENTRATION' && c.route?.includes('player')) { impacted.add('player'); impacted.add('streaming'); }
    if (c.code === 'MEMORY_PRESSURE') { impacted.add('player'); }
    if (c.code === 'RELEASE_ERROR_SPIKE' || c.code === 'RUNTIME_ERROR' || c.code === 'BROWSER_SPECIFIC') { impacted.add('app'); }
  }
  return { nodes: SERVICE_NODES.map((n) => ({ ...n, impacted: impacted.has(n.id) })), edges: SERVICE_EDGES };
}
