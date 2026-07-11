// WEB-OPS-10 — Unified Operations Platform feature flags. All read-side, default ON (super-admin only,
// fail-open). A flag OFF only hides a section of the Command Center; it can never affect playback, the
// queue, crossfade, recovery, a release, or any operational data.

function envStr(v: unknown): string | undefined { return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined; }
function envBool(v: unknown, dflt: boolean): boolean {
  const s = envStr(v)?.toLowerCase();
  if (s === undefined) return dflt;
  if (s === 'false' || s === '0' || s === 'off' || s === 'no') return false;
  if (s === 'true' || s === '1' || s === 'on' || s === 'yes') return true;
  return dflt;
}

export interface PlatformConfig {
  operationsCenterEnabled: boolean;
  executiveDashboardEnabled: boolean;
  platformScoreEnabled: boolean;
  widgetLayoutEnabled: boolean;
  slaDashboardEnabled: boolean;
  digitalTwinEnabled: boolean;
  timelineEnabled: boolean;
}

let cached: PlatformConfig | null = null;

export function getPlatformConfig(): PlatformConfig {
  if (cached) return cached;
  let env: Record<string, unknown> = {};
  try { env = import.meta.env as unknown as Record<string, unknown>; } catch { /* noop */ }
  cached = {
    operationsCenterEnabled: envBool(env.VITE_OPS_CENTER_ENABLED, true),
    executiveDashboardEnabled: envBool(env.VITE_OPS_EXECUTIVE_ENABLED, true),
    platformScoreEnabled: envBool(env.VITE_OPS_PLATFORM_SCORE_ENABLED, true),
    widgetLayoutEnabled: envBool(env.VITE_OPS_WIDGET_LAYOUT_ENABLED, true),
    slaDashboardEnabled: envBool(env.VITE_OPS_SLA_ENABLED, true),
    digitalTwinEnabled: envBool(env.VITE_OPS_DIGITAL_TWIN_ENABLED, true),
    timelineEnabled: envBool(env.VITE_OPS_TIMELINE_ENABLED, true),
  };
  return cached;
}

export function __resetPlatformConfig(): void { cached = null; }
