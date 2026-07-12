// AI-MUSIC-12 — Vercel environment rebinding planner (pure; PLAN ONLY — never mutates any env var). It produces
// the Preview-scope-only rebinding plan and structurally guarantees the Production scope is untouched. It refuses
// to plan a bind unless the backend is isolated, and never proposes a Production-scope change. Pure.

import type { EnvRebindingInput, EnvRebindingPlan } from './types';

const PREVIEW_ONLY_VARS = [
  'VITE_SUPABASE_URL (preview)', 'VITE_SUPABASE_ANON_KEY (preview)', 'SUPABASE_URL (preview)',
  'SUPABASE_ANON_KEY (preview)', 'SUPABASE_SERVICE_ROLE_KEY (preview)', 'SUPABASE_PROJECT_REF (preview)',
  'VITE_AI_PREVIEW_PROJECT_REF (preview)', 'VITE_AI_PREVIEW_DEPLOYMENT_ID (preview)',
  'VITE_AI_PREVIEW_TESTBED_ENABLED=false (preview)', 'VITE_AI_PREVIEW_KILL_SWITCH=true (preview)',
];

export function planEnvRebinding(i: EnvRebindingInput): EnvRebindingPlan {
  const base = { productionScopeUntouched: true as const, previewScopeChanges: PREVIEW_ONLY_VARS };
  if (i.previewProjectRef != null && i.previewProjectRef.trim() === i.productionProjectRef.trim()) {
    return { ...base, status: 'BLOCKED_PRODUCTION_SCOPE', previewScopeChanges: [], redeployRequired: false, reasons: ['Preview ref 가 Production ref 와 동일 — 바인딩 금지'] };
  }
  if (i.isolationStatus !== 'ISOLATED') {
    return { ...base, status: 'BLOCKED_NOT_ISOLATED', previewScopeChanges: [], redeployRequired: false, reasons: [`Backend 미격리 (${i.isolationStatus}) — 바인딩 계획 보류`] };
  }
  if (i.previewProjectRef == null) {
    return { ...base, status: 'INSUFFICIENT_DATA', previewScopeChanges: [], redeployRequired: false, reasons: ['Preview Project Ref 미확인'] };
  }
  return {
    ...base,
    status: 'PLAN_READY',
    redeployRequired: true,
    reasons: [
      'Vercel Preview scope 에만 위 변수를 바인딩 (Production scope 변경 금지)',
      '바인딩 후 Preview Redeploy 필요 — 이전 Preview Deployment 는 구 Env 를 사용할 수 있음',
      '실제 바인딩은 이번 Phase 에서 수행하지 않음 (수동 절차)',
    ],
  };
}
