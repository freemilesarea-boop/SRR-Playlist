// WEB-OBS-9 — Operations Governance feature flags. All read-side flags default ON (super-admin only,
// fail-open). `recordEnabled` gates whether the operator-action RPCs (decision/approval/rule) are shown;
// even ON, recording is NEVER automatic — it always requires an explicit operator click. A flag OFF only
// hides governance UI; it can never affect playback, the queue, crossfade, recovery, or a release.

function envStr(v: unknown): string | undefined { return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined; }
function envBool(v: unknown, dflt: boolean): boolean {
  const s = envStr(v)?.toLowerCase();
  if (s === undefined) return dflt;
  if (s === 'false' || s === '0' || s === 'off' || s === 'no') return false;
  if (s === 'true' || s === '1' || s === 'on' || s === 'yes') return true;
  return dflt;
}

export interface OpsGovernanceConfig {
  dashboardEnabled: boolean;
  approvalsEnabled: boolean;   // show the approval queue actions
  rulesEnabled: boolean;       // show rule management
  recordEnabled: boolean;      // allow logging a decision (still operator-initiated only)
  executiveReportEnabled: boolean;
  autoRefresh: boolean;
}

let cached: OpsGovernanceConfig | null = null;

export function getOpsGovernanceConfig(): OpsGovernanceConfig {
  if (cached) return cached;
  let env: Record<string, unknown> = {};
  try { env = import.meta.env as unknown as Record<string, unknown>; } catch { /* noop */ }
  cached = {
    dashboardEnabled: envBool(env.VITE_OPSGOV_DASHBOARD_ENABLED, true),
    approvalsEnabled: envBool(env.VITE_OPSGOV_APPROVALS_ENABLED, true),
    rulesEnabled: envBool(env.VITE_OPSGOV_RULES_ENABLED, true),
    recordEnabled: envBool(env.VITE_OPSGOV_RECORD_ENABLED, true),
    executiveReportEnabled: envBool(env.VITE_OPSGOV_EXEC_REPORT_ENABLED, true),
    autoRefresh: envBool(env.VITE_OPSGOV_AUTO_REFRESH, false),
  };
  return cached;
}

export function __resetOpsGovernanceConfig(): void { cached = null; }
