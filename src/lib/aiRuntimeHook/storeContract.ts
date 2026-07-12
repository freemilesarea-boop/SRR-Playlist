// AI-MUSIC-9 — Isolated single test store contract. Exactly ONE internal test store may ever be allowlisted:
// no wildcard, no multiple stores, no auto-add, no customer/enterprise/franchise/production store. The entry
// must be enabled, non-expired, deployment-pinned, candidate/version/snapshot-pinned, approved, capped to one
// session, and kill-switch-required. Pure & deterministic.

import type { IsolatedTestStore, TestStoreValidation, TestStoreValidity } from './types';

export interface TestStoreContext {
  currentDeploymentId: string;
  configuredStoreId: string | null;    // the single allowlisted store id from config (null = none)
  isInternalStore: (storeId: string) => boolean;   // caller asserts this is a non-customer internal store
  nowMs: number;
}

export function validateTestStore(store: IsolatedTestStore | null, ctx: TestStoreContext): TestStoreValidation {
  const reasons: string[] = [];
  const fail = (validity: TestStoreValidity, reason: string): TestStoreValidation => ({ validity, reasons: [reason] });

  if (store == null || ctx.configuredStoreId == null) return fail('NO_STORE_CONFIGURED', '내부 Test Store 미구성');
  if (store.storeId === '*' || store.storeId.includes('*')) return fail('WILDCARD_FORBIDDEN', 'Wildcard Store 금지');
  if (store.storeId !== ctx.configuredStoreId) return fail('MULTI_STORE_FORBIDDEN', '허용된 단일 Store 아님');
  if (!ctx.isInternalStore(store.storeId)) return fail('NOT_INTERNAL_STORE', '내부 Test Store 아님 (고객/Enterprise/Franchise 금지)');
  if (!store.enabled) return fail('DISABLED', 'Store 비활성');
  if (store.killSwitchRequired !== true) return fail('KILL_SWITCH_NOT_REQUIRED', 'Kill Switch 필수 조건 누락');
  if (store.maxSessions !== 1) return fail('MULTI_STORE_FORBIDDEN', 'maxSessions 는 1 이어야 함');
  if (store.expiresAtMs <= ctx.nowMs) return fail('EXPIRED', 'Store 승인 만료');
  if (store.previewDeploymentId !== ctx.currentDeploymentId) return fail('DEPLOYMENT_MISMATCH', 'Deployment ID 불일치');
  if (!store.approvedCandidatePlaylistId) return fail('CANDIDATE_MISSING', 'Candidate Playlist 미승인');
  if (store.approvedCandidateVersion == null) return fail('VERSION_MISSING', 'Candidate Version 미승인');
  if (!store.approvedSnapshotHash) return fail('SNAPSHOT_MISSING', 'Candidate Snapshot 미승인');
  if (!store.approvedExistingPlaylistId) return fail('EXISTING_MISSING', 'Existing Playlist 미지정 (Rollback Target)');
  if (!store.approvedBy) return fail('APPROVAL_MISSING', '승인자 없음');

  reasons.push('단일 내부 Test Store 유효');
  return { validity: 'VALID', reasons };
}

export function isTestStoreValid(v: TestStoreValidity): v is 'VALID' { return v === 'VALID'; }
