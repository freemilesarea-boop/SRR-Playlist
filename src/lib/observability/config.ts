// WEB-OBS-2 — Observability dashboard feature flags & kill switches.
//
// These control ONLY the admin-facing observability dashboard and its client-side derivations. They
// have ZERO effect on telemetry collection/transport (WEB-OPT-11 / WEB-OBS-1) — turning the whole
// dashboard off never stops data from being collected or ingested. Every flag has a SAFE default and
// non-secret value; a missing/mistyped env var can never break boot or the rest of the admin app.
//
// Failure isolation: the dashboard is lazy-loaded and self-contained. A query failure renders an
// inline error+retry inside the panel — it must never bubble to the global ErrorBoundary or the app
// boot path, and polling must never retry infinitely (see the dashboard's bounded backoff).

function envStr(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
}

function envBool(v: unknown, dflt: boolean): boolean {
  const s = envStr(v)?.toLowerCase();
  if (s === undefined) return dflt;
  if (s === 'false' || s === '0' || s === 'off' || s === 'no') return false;
  if (s === 'true' || s === '1' || s === 'on' || s === 'yes') return true;
  return dflt;
}

function envInt(v: unknown, dflt: number, min: number, max: number): number {
  const s = envStr(v);
  if (s === undefined) return dflt;
  const n = Number(s);
  if (!Number.isFinite(n)) return dflt;
  return Math.round(Math.min(max, Math.max(min, n)));
}

export interface ObservabilityConfig {
  /** Master switch for the observability dashboard surface. OFF → panel shows a disabled notice. */
  dashboardEnabled: boolean;
  /** Compute & show incident candidates. OFF → Incidents tab shows a disabled notice. */
  incidentDetectionEnabled: boolean;
  /** Compute & show release comparison. OFF → Releases tab shows a disabled notice. */
  releaseComparisonEnabled: boolean;
  /** Allow the auto-refresh toggle to poll. OFF → manual refresh only (no interval ever armed). */
  autoRefreshEnabled: boolean;
  /** Auto-refresh interval (ms), bounded. */
  autoRefreshMs: number;
  /** Minimum distinct sessions before health/regression verdicts are shown (else INSUFFICIENT_DATA). */
  minSessions: number;
  /** Minimum events before health verdicts are shown. */
  minSamples: number;
  /** WEB-OBS-3 — show the Release Gate tab (quality/readiness/gate). OFF → tab shows disabled notice. */
  releaseQualityEnabled: boolean;
  /** WEB-OBS-3 — compute the deployment gate verdict. OFF → gate hidden, quality/budget still shown. */
  deploymentGateEnabled: boolean;
  /** WEB-OBS-3 — evaluate the performance budget. OFF → budget section shows disabled notice. */
  performanceBudgetEnabled: boolean;
  /** WEB-OBS-3 — when false, budget FAIL is reported as a WARNING (advisory) instead of a hard BLOCK. */
  budgetEnforcementEnabled: boolean;
  /** WEB-OBS-4 — show the Root Cause tab (analysis/correlation/timeline/graph). OFF → disabled notice. */
  rootCauseEnabled: boolean;
  /** WEB-OBS-4 — compute the Rollback Advisor recommendation. OFF → advisor hidden (analysis stays). */
  rollbackAdvisorEnabled: boolean;
  /** WEB-OBS-4 — show the release timeline section. */
  timelineEnabled: boolean;
  /** WEB-OBS-4 — show evidence correlation section. */
  correlationEnabled: boolean;
  /** WEB-OBS-4 — show the service dependency graph section. */
  serviceGraphEnabled: boolean;
  /** WEB-OBS-5 — show the Operations tab (advisor/playbook/blast/impact/recovery/lifecycle/escalation). */
  operationalAdvisorEnabled: boolean;
  /** WEB-OBS-5 — show the incident playbook section. */
  playbookEnabled: boolean;
  /** WEB-OBS-5 — show blast radius + impact. */
  blastRadiusEnabled: boolean;
  /** WEB-OBS-5 — show recovery tracking. */
  recoveryTrackingEnabled: boolean;
  /** WEB-OBS-5 — show incident lifecycle (suggested status). */
  incidentLifecycleEnabled: boolean;
  /** WEB-OBS-5 — show escalation recommendation. */
  escalationEnabled: boolean;
  /** WEB-OBS-5 — show the business-impact (availability) note. */
  businessImpactEnabled: boolean;
  /** WEB-OBS-5 — minimum recovery observation window (minutes) before a recovery verdict is shown. */
  minRecoveryWindowMinutes: number;
}

let cached: ObservabilityConfig | null = null;

export function getObservabilityConfig(): ObservabilityConfig {
  if (cached) return cached;
  const env = import.meta.env;
  cached = {
    dashboardEnabled: envBool(env.VITE_OBSERVABILITY_ENABLED, true),
    incidentDetectionEnabled: envBool(env.VITE_OBSERVABILITY_INCIDENTS_ENABLED, true),
    releaseComparisonEnabled: envBool(env.VITE_OBSERVABILITY_RELEASE_COMPARE_ENABLED, true),
    autoRefreshEnabled: envBool(env.VITE_OBSERVABILITY_AUTO_REFRESH_ENABLED, true),
    autoRefreshMs: envInt(env.VITE_OBSERVABILITY_AUTO_REFRESH_MS, 60_000, 15_000, 600_000),
    minSessions: envInt(env.VITE_OBSERVABILITY_MIN_SESSIONS, 5, 1, 10_000),
    minSamples: envInt(env.VITE_OBSERVABILITY_MIN_SAMPLES, 50, 1, 1_000_000),
    releaseQualityEnabled: envBool(env.VITE_OBSERVABILITY_RELEASE_QUALITY_ENABLED, true),
    deploymentGateEnabled: envBool(env.VITE_OBSERVABILITY_DEPLOYMENT_GATE_ENABLED, true),
    performanceBudgetEnabled: envBool(env.VITE_OBSERVABILITY_PERF_BUDGET_ENABLED, true),
    budgetEnforcementEnabled: envBool(env.VITE_OBSERVABILITY_BUDGET_ENFORCEMENT_ENABLED, true),
    rootCauseEnabled: envBool(env.VITE_OBSERVABILITY_ROOT_CAUSE_ENABLED, true),
    rollbackAdvisorEnabled: envBool(env.VITE_OBSERVABILITY_ROLLBACK_ADVISOR_ENABLED, true),
    timelineEnabled: envBool(env.VITE_OBSERVABILITY_TIMELINE_ENABLED, true),
    correlationEnabled: envBool(env.VITE_OBSERVABILITY_CORRELATION_ENABLED, true),
    serviceGraphEnabled: envBool(env.VITE_OBSERVABILITY_SERVICE_GRAPH_ENABLED, true),
    operationalAdvisorEnabled: envBool(env.VITE_OBSERVABILITY_OPERATIONAL_ADVISOR_ENABLED, true),
    playbookEnabled: envBool(env.VITE_OBSERVABILITY_PLAYBOOK_ENABLED, true),
    blastRadiusEnabled: envBool(env.VITE_OBSERVABILITY_BLAST_RADIUS_ENABLED, true),
    recoveryTrackingEnabled: envBool(env.VITE_OBSERVABILITY_RECOVERY_TRACKING_ENABLED, true),
    incidentLifecycleEnabled: envBool(env.VITE_OBSERVABILITY_INCIDENT_LIFECYCLE_ENABLED, true),
    escalationEnabled: envBool(env.VITE_OBSERVABILITY_ESCALATION_ENABLED, true),
    businessImpactEnabled: envBool(env.VITE_OBSERVABILITY_BUSINESS_IMPACT_ENABLED, true),
    minRecoveryWindowMinutes: envInt(env.VITE_OBSERVABILITY_MIN_RECOVERY_WINDOW_MINUTES, 30, 5, 1440),
  };
  return cached;
}

/** Test-only reset of the memoized config. */
export function __resetObservabilityConfig(): void {
  cached = null;
}
