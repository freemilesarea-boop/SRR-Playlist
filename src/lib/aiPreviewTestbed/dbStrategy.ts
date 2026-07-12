// AI-MUSIC-11 — Preview database strategy recommendation. Given the environment audit, recommends how to obtain
// an isolated preview DB. Option D (shared production + test rows) is ALWAYS blocked. Pure & deterministic.

import type { DbStrategyResult, EnvironmentIsolation } from './types';

export interface DbStrategyInput {
  isolation: EnvironmentIsolation;
  supabaseBranchingAvailable: boolean;
  localSupabaseAvailable: boolean;
}

export function recommendDbStrategy(i: DbStrategyInput): DbStrategyResult {
  if (i.isolation === 'ISOLATED_PREVIEW_DB') {
    return { option: 'B_SEPARATE_TEST_PROJECT', status: 'SELECTED', reason: '이미 분리된 Preview DB 사용 중', limitations: [], cost: '낮음 (기존 분리 환경)' };
  }
  if (i.isolation === 'LOCAL_ONLY') {
    return { option: 'C_LOCAL_SUPABASE', status: 'RECOMMENDED', reason: 'Local Supabase 로 개발자 검증 가능하나 외부 Preview QA 불가', limitations: ['Browser Runtime QA 제한', '외부 접근 불가'], cost: '낮음' };
  }
  // Shared/partial/unsafe → recommend a proper isolated project (B) or a Supabase branch (A); block D.
  const branchNote = i.supabaseBranchingAvailable ? 'Supabase Branch(A) 또는 별도 Test Project(B)' : '별도 Test Project(B)';
  return {
    option: i.supabaseBranchingAvailable ? 'A_SUPABASE_BRANCH' : 'B_SEPARATE_TEST_PROJECT',
    status: 'RECOMMENDED',
    reason: `현재 Shared Production DB — Testbed 적용 불가. ${branchNote} 를 별도 provisioning 해야 함 (D. Shared Prod + Test Rows 는 금지).`,
    limitations: ['현재 미구성 → Migration 적용/Fixture 생성 DEFERRED', 'Preview Vercel Env 를 새 DB 로 재바인딩 필요'],
    cost: i.supabaseBranchingAvailable ? '중간 (branch 수명/데이터 clone)' : '중간~높음 (별도 Project + Auth/Storage 분리)',
  };
}
