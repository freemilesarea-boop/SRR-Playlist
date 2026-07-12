// AI-MUSIC-7 — Preview environment enforcement. Client-side environment detection alone is INSUFFICIENT:
// `import.meta.env.MODE` is 'production' for BOTH Preview and Production Vercel builds. So a single client flag
// or host string is never trusted. The gate requires ALL of: appEnv === 'preview', a configured allowed
// deployment id that matches the current deployment id, and not-a-production-host. The server RPC enforces the
// same independently (stored allowed_deployment_id + explicit preview allowlist + super-admin), and the
// strongest guarantee is structural — the canary migration is not applied to production, so the RPCs don't
// exist there. A UNSAFE result forbids any runtime canary connection.

import type { EnvContext, EnvGateResult } from './types';

export function evaluateEnvironmentGate(ctx: EnvContext): EnvGateResult {
  const reasons: string[] = [];
  const isPreview = ctx.appEnv === 'preview';
  const deploymentConfigured = !!ctx.allowedDeploymentId && !!ctx.currentDeploymentId;
  const deploymentMatches = deploymentConfigured && ctx.allowedDeploymentId === ctx.currentDeploymentId;

  if (!isPreview) reasons.push('appEnv !== preview (VITE_AI_PREVIEW_CANARY_ENV)');
  if (!ctx.allowedDeploymentId) reasons.push('allowed deployment id 미설정');
  if (!ctx.currentDeploymentId) reasons.push('current deployment id 미설정');
  if (deploymentConfigured && !deploymentMatches) reasons.push('deployment id 불일치');
  if (ctx.isProductionHost) reasons.push('production host 감지');

  let status: EnvGateResult['status'];
  if (ctx.isProductionHost) status = 'UNSAFE';                      // never run on a production host
  else if (isPreview && deploymentMatches) status = 'ENFORCED';     // all conditions hold
  else if (isPreview || deploymentConfigured) status = 'PARTIAL';   // some but not all
  else status = 'NOT_AVAILABLE';                                    // no preview signals at all

  return { status, isPreview, deploymentMatches, reasons };
}

// Master check: runtime canary is allowed only when the env gate is ENFORCED (and callers additionally require
// master+canary flag on, kill switch off, allowlist valid — see the resolver).
export function environmentAllowsCanary(gate: EnvGateResult): boolean {
  return gate.status === 'ENFORCED' && gate.isPreview && gate.deploymentMatches;
}
