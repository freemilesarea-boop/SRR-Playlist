// AI-MUSIC-12 — Backend strategy selection. Priority: reuse an EXISTING SRR test project > a (free) Supabase
// branch > a separate test project > local. Option D (shared production) is always BLOCKED. A cost-bearing
// branch/project is NEVER auto-created without explicit `costApproved`; when cost is unclear or unapproved the
// result is MANUAL_PROVISIONING_REQUIRED (plan + manual steps only). Pure & deterministic.

import type { BackendStrategyInput, BackendStrategy, BackendStrategyResult, BackendStrategyOption } from './types';

export function selectBackendStrategy(i: BackendStrategyInput): BackendStrategy {
  const mk = (option: BackendStrategyOption | null, result: BackendStrategyResult, recommendedName: string | null, estimatedCost: string, reason: string, manualSteps: string[] = []): BackendStrategy =>
    ({ option, result, recommendedName, estimatedCost, reasons: [reason], manualSteps });

  // 1. Reuse an existing SRR-Playlist test project (no new cost).
  if (i.srrTestProjectExists) {
    return mk('B_SEPARATE_TEST_PROJECT', 'EXISTING_PROJECT_SELECTED', null, '없음 (기존 재사용)', '기존 SRR Playlist 전용 Test Project 재사용');
  }

  const manualBranch = [
    'Supabase 대시보드에서 SRR Playlist Production Project 의 Branch 생성 (이름: ai-music-preview-testbed)',
    'Branch 비용/수명 확인 후 승인 → 이후 Phase 에서 VITE_AI_PREVIEW_COST_APPROVED=true 로 실행',
    'Vercel Preview scope 에만 Branch 연결 정보 바인딩 (Production scope 변경 금지)',
  ];
  const manualProject = [
    'Supabase 에서 새 Project 생성 (이름: srr-playlist-preview, Region: ap-southeast-1 권장)',
    '예상 비용/Plan/Region/삭제 절차 확인 후 승인',
    'Preview 전용 Auth/Storage 구성 · Vercel Preview scope 에만 바인딩 (Production scope 변경 금지)',
  ];

  // 2. Branch — only auto-selectable if branching is available AND not cost-bearing (or cost pre-approved).
  if (i.branchingAvailable && (!i.branchCostBearing || i.costApproved)) {
    if (i.costApproved) return mk('A_SUPABASE_BRANCH', 'MANUAL_PROVISIONING_REQUIRED', 'ai-music-preview-testbed', i.branchCostBearing ? '유료 Branch (승인됨)' : '무료 Branch', 'Branch 생성 가능 — 실제 생성은 대시보드 수동 절차', manualBranch);
    return mk('A_SUPABASE_BRANCH', 'MANUAL_PROVISIONING_REQUIRED', 'ai-music-preview-testbed', '무료 Branch (플랜 확인 필요)', '무료 Branch 가능성 — 실제 생성은 수동 절차', manualBranch);
  }

  // 3. Cost-bearing branch/project without approval → MANUAL (never auto-create).
  if (i.projectCreatePermission) {
    return mk('B_SEPARATE_TEST_PROJECT', 'MANUAL_PROVISIONING_REQUIRED', 'srr-playlist-preview', i.branchCostBearing ? '유료 (승인 필요)' : '별도 Project 비용 확인 필요', '비용 발생 가능 리소스 — 승인 전 자동 생성 금지. 별도 Test Project 수동 provisioning 필요', manualProject);
  }

  // 4. Local only (no create permission), if available.
  if (i.localSupabaseAvailable) {
    return mk('C_LOCAL_SUPABASE', 'LOCAL_ONLY_SELECTED', null, '없음 (로컬)', 'Project/Branch 생성 권한 없음 — Local Supabase 로 Schema/Migration/Seeder 검증만 (외부 Preview QA 불가)');
  }

  return mk(null, 'MANUAL_PROVISIONING_REQUIRED', 'srr-playlist-preview', '확인 필요', 'Project/Branch 생성 권한·비용 불명확 — 수동 provisioning 절차만 제공', manualProject);
}
