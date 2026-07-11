// WEB-OBS-5 — Blast Radius & Impact Analysis (pure, unit-tested, rule-based — NO ML).
//
// "How wide is this?" — quantifies the reach of an incident from the persistent RUM: affected vs
// total SESSIONS (deduped, ≠ users), affected EVENTS, and the primary scope (release/route/browser).
// A single event is never WIDESPREAD; without a known denominator no rate is asserted; a thin browser
// sample never mints a browser-specific verdict. Business impact is NOT invented — it is reported as
// BUSINESS_IMPACT_NOT_AVAILABLE unless the telemetry directly supports it (it does not this phase).

import { safeRatio, round } from './math';
import type { Confidence } from './release';
import {
  BLAST_ISOLATED_MAX, BLAST_LIMITED_MAX, BLAST_MODERATE_MAX, BLAST_WIDESPREAD_MAX,
  BLAST_MIN_AFFECTED_SESSIONS, BLAST_MIN_TOTAL_SESSIONS, BLAST_CRITICAL_SEVERE_SESSIONS,
} from './thresholds';

export type BlastRadiusLevel = 'ISOLATED' | 'LIMITED' | 'MODERATE' | 'WIDESPREAD' | 'CRITICAL' | 'INSUFFICIENT_DATA';

export interface BlastRadiusInput {
  affectedSessions: number;
  totalSessions: number | null; // denominator; null → rate cannot be asserted
  affectedEvents: number;
  totalEvents: number | null;
  affectedRoutes: string[];
  affectedBrowsers: string[];
  affectedDevices: string[];
  affectedReleases: string[];
  /** severe-signal session count (critical + chunk) — drives CRITICAL regardless of rate. */
  severeSessions: number;
  browsers: number; // distinct browsers seen overall (diversity for confidence)
  /** primary concentration scope, precomputed (e.g. "release r2" / "route /player" / "browser Safari"). */
  primaryScope: string | null;
}

export interface BlastRadiusResult {
  affectedSessions: number;
  totalSessions: number | null;
  affectedSessionRate: number | null; // null when denominator missing
  affectedEvents: number;
  affectedRoutes: number;
  affectedBrowsers: number;
  affectedDevices: number;
  affectedReleases: number;
  primaryScope: string | null;
  level: BlastRadiusLevel;
  confidence: Confidence;
  insufficientData: boolean;
  reason: string;
}

function blastConfidence(affected: number, browsers: number): Confidence {
  if (affected < BLAST_MIN_AFFECTED_SESSIONS) return 'INSUFFICIENT';
  if (affected >= 100 && browsers >= 2) return 'HIGH';
  if (affected >= 30) return 'MEDIUM';
  return 'LOW';
}

export function computeBlastRadius(input: BlastRadiusInput): BlastRadiusResult {
  const affected = Math.max(0, input.affectedSessions);
  const total = input.totalSessions;
  const rate = total != null && total > 0 ? safeRatio(affected, total) : null;

  const base: Omit<BlastRadiusResult, 'level' | 'confidence' | 'insufficientData' | 'reason'> = {
    affectedSessions: affected, totalSessions: total, affectedSessionRate: round(rate, 4),
    affectedEvents: Math.max(0, input.affectedEvents),
    affectedRoutes: input.affectedRoutes.length, affectedBrowsers: input.affectedBrowsers.length,
    affectedDevices: input.affectedDevices.length, affectedReleases: input.affectedReleases.length,
    primaryScope: input.primaryScope,
  };

  // Insufficient-data gates: too few affected, or no denominator to size the rate.
  if (affected < BLAST_MIN_AFFECTED_SESSIONS) {
    return { ...base, level: 'INSUFFICIENT_DATA', confidence: 'INSUFFICIENT', insufficientData: true, reason: `영향 세션 부족(${affected}/${BLAST_MIN_AFFECTED_SESSIONS})` };
  }
  if (total == null || total < BLAST_MIN_TOTAL_SESSIONS) {
    return { ...base, level: 'INSUFFICIENT_DATA', confidence: 'INSUFFICIENT', insufficientData: true, reason: total == null ? '전체 세션 denominator 없음 → 비율 확정 불가' : `전체 세션 부족(${total}/${BLAST_MIN_TOTAL_SESSIONS})` };
  }

  const confidence = blastConfidence(affected, input.browsers);
  const r = rate ?? 0;
  let level: BlastRadiusLevel;
  if (input.severeSessions >= BLAST_CRITICAL_SEVERE_SESSIONS || r > BLAST_WIDESPREAD_MAX) level = 'CRITICAL';
  else if (r > BLAST_MODERATE_MAX) level = 'WIDESPREAD';
  else if (r > BLAST_LIMITED_MAX) level = 'MODERATE';
  else if (r > BLAST_ISOLATED_MAX) level = 'LIMITED';
  else level = 'ISOLATED';

  return {
    ...base, level, confidence, insufficientData: false,
    reason: `${affected}/${total} 세션 영향(${(r * 100).toFixed(2)}%)${input.severeSessions >= BLAST_CRITICAL_SEVERE_SESSIONS ? ` · severe ${input.severeSessions} 세션` : ''}`,
  };
}

// ── Impact Analysis (technical + scoped session/route/browser/release; business = not available) ──
export type BusinessImpactAvailability = 'BUSINESS_IMPACT_NOT_AVAILABLE';

export interface ImpactInput {
  affectedSessions: number;
  totalSessions: number | null;
  errorEvents: number;
  criticalErrors: number;
  chunkFailures: number;
  hydrationErrors: number;
  slowApiEvents: number;
  timeoutEvents: number | null;   // null when not separable from telemetry
  memoryRiskSessions: number;
  affectedRoutes: string[];
  playerRouteAffected: boolean;
  adminRouteAffected: boolean;
  affectedBrowsers: string[];
  affectedReleases: string[];
}

export interface ImpactResult {
  technical: {
    affectedSessions: number; errorEvents: number; criticalErrors: number; chunkFailures: number;
    hydrationErrors: number; slowApiEvents: number; timeoutEvents: number | null; memoryRiskSessions: number;
  };
  sessionImpact: { affected: number; total: number | null; rate: number | null };
  routeImpact: { routes: number; playerRouteAffected: boolean; adminRouteAffected: boolean };
  browserImpact: string[];
  releaseImpact: string[];
  businessImpact: BusinessImpactAvailability;
  businessImpactNote: string;
}

/** Technical + scoped impact only. Business/revenue/store/settlement impact is NOT derivable from
 *  runtime telemetry and is deliberately reported as BUSINESS_IMPACT_NOT_AVAILABLE. */
export function computeImpact(input: ImpactInput): ImpactResult {
  return {
    technical: {
      affectedSessions: input.affectedSessions, errorEvents: input.errorEvents, criticalErrors: input.criticalErrors,
      chunkFailures: input.chunkFailures, hydrationErrors: input.hydrationErrors, slowApiEvents: input.slowApiEvents,
      timeoutEvents: input.timeoutEvents, memoryRiskSessions: input.memoryRiskSessions,
    },
    sessionImpact: { affected: input.affectedSessions, total: input.totalSessions, rate: input.totalSessions && input.totalSessions > 0 ? round(safeRatio(input.affectedSessions, input.totalSessions), 4) : null },
    routeImpact: { routes: input.affectedRoutes.length, playerRouteAffected: input.playerRouteAffected, adminRouteAffected: input.adminRouteAffected },
    browserImpact: input.affectedBrowsers,
    releaseImpact: input.affectedReleases,
    businessImpact: 'BUSINESS_IMPACT_NOT_AVAILABLE',
    businessImpactNote: '런타임 텔레메트리는 매출/매장/정산/재생누락을 직접 지원하지 않습니다. 세션·라우트·릴리스·브라우저 영향만 제공합니다.',
  };
}

/** Session count is NOT a user count — a single user can produce many sessions. Exposed as a labelled
 *  helper so the UI never silently equates the two. */
export function sessionsAreNotUsers(): string {
  return 'Session 수는 사용자 수가 아닙니다(익명 세션 id, 사용자당 다중 세션 가능).';
}
