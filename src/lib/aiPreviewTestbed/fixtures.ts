// AI-MUSIC-11 — Preview fixture contract validators (pure; no real creation). Each validator enforces that a
// fixture is Preview-only, test-tagged, expiring, non-customer/enterprise/franchise, and (for candidates)
// version/snapshot-pinned. Real production names/emails/stores/playlists are rejected. Nothing is created or
// persisted this phase — these validate the CONTRACT a future isolated-DB seeder would satisfy.

import type {
  InternalTestStore, InternalTestAccount, PlaylistFixture, CandidateVersionSnapshot, RollbackTarget,
  PreviewAllowlistFixture, FixtureValidation, FixtureValidity,
} from './types';
import { snapshotMatches } from './snapshot';

const MIN_TRACKS = 5;
const TEST_STORE_PREFIX = 'INTERNAL_AI_CANARY_STORE_';
const TEST_TRACK_PREFIX = 'test-';

function mk(validity: FixtureValidity, reason: string): FixtureValidation { return { validity, reasons: [reason] }; }

export function validateTestStore(s: InternalTestStore | null, nowMs: number): FixtureValidation {
  if (s == null) return mk('MISSING', '내부 Test Store 미구성');
  if (s.environment !== 'preview') return mk('NOT_PREVIEW', 'Preview 환경 아님');
  if (s.testOnly !== true) return mk('NOT_TEST_ONLY', 'test_only 아님');
  if (s.customerStore) return mk('CUSTOMER_STORE', '고객 Store 금지');
  if (s.enterpriseStore) return mk('ENTERPRISE_STORE', 'Enterprise Store 금지');
  if (s.franchiseStore) return mk('FRANCHISE_STORE', 'Franchise Store 금지');
  if (!s.storeName.startsWith(TEST_STORE_PREFIX)) return mk('REAL_NAME', `Test Store 이름은 ${TEST_STORE_PREFIX} prefix 필수 (실제 브랜드/Store 이름 금지)`);
  if (!(s.expiresAtMs > nowMs)) return mk('EXPIRED', 'Expiry 없음/만료');
  if (s.cleanupRequired !== true) return mk('NO_CLEANUP', 'cleanup_required 필수');
  return { validity: 'VALID', reasons: ['단일 내부 Preview Test Store 유효'] };
}

export function validateTestAccount(a: InternalTestAccount | null, nowMs: number): FixtureValidation {
  if (a == null) return mk('MISSING', 'Test Account 미구성');
  if (a.testOnly !== true) return mk('NOT_TEST_ONLY', 'test_only 아님');
  if (a.productionAccess) return mk('PRODUCTION_ACCOUNT', 'production_access 금지');
  // Reject an obviously-real personal/customer domain; require a test alias.
  if (!/\+?(test|canary|preview)/i.test(a.email)) return mk('REAL_EMAIL', 'Test Alias 이메일 필수 (실제 직원/고객 이메일 금지)');
  if (!(a.expiresAtMs > nowMs)) return mk('NO_EXPIRY', 'Expiry 없음/만료');
  return { validity: 'VALID', reasons: ['Preview 전용 Test Account 유효'] };
}

export function validateExistingPlaylist(p: PlaylistFixture | null): FixtureValidation {
  if (p == null) return mk('MISSING', 'Existing Playlist 미구성');
  if (p.testOnly !== true) return mk('NOT_TEST_ONLY', 'test_only 아님');
  if (p.trackCount < MIN_TRACKS) return mk('TOO_FEW_TRACKS', `최소 ${MIN_TRACKS}곡 필요`);
  if (p.snapshotHash == null) return mk('SNAPSHOT_MISSING', 'Snapshot 없음 (Rollback Target 불가)');
  return { validity: 'VALID', reasons: ['Existing Playlist Fixture 유효'] };
}

export function validateCandidatePlaylist(candidate: PlaylistFixture | null, existing: PlaylistFixture | null): FixtureValidation {
  if (candidate == null) return mk('MISSING', 'Candidate Playlist 미구성');
  if (candidate.testOnly !== true) return mk('NOT_TEST_ONLY', 'test_only 아님');
  if (candidate.trackCount === 0) return mk('EMPTY_CANDIDATE', '빈 Candidate 금지');
  if (candidate.trackCount < MIN_TRACKS) return mk('TOO_FEW_TRACKS', `최소 ${MIN_TRACKS}곡 필요`);
  if (candidate.trackIds.some((t) => !t.startsWith(TEST_TRACK_PREFIX))) {
    // Not fatal, but flag production-like track ids.
    return mk('REAL_NAME', `Candidate Track 은 ${TEST_TRACK_PREFIX} prefix 권장 (실제 고객 Track 복사 금지)`);
  }
  if (existing != null) {
    const common = candidate.trackIds.filter((t) => existing.trackIds.includes(t));
    if (common.length === 0) return mk('INSUFFICIENT_DATA', 'Existing 과 공통 Track 없음 — Current Track Preservation 시나리오 불가');
  }
  return { validity: 'VALID', reasons: ['Candidate Playlist Fixture 유효 (공통+신규 Track 구성)'] };
}

export function validateCandidateVersionSnapshot(c: CandidateVersionSnapshot | null): FixtureValidation {
  if (c == null) return mk('MISSING', 'Candidate Version/Snapshot 미구성');
  if (c.candidateVersion == null) return mk('VERSION_MISSING', 'Version 없음');
  if (!c.candidateSnapshotHash) return mk('SNAPSHOT_MISSING', 'Snapshot 없음');
  if (!snapshotMatches(c.candidateTrackIds, c.candidateVersion, c.candidateSnapshotHash)) {
    return mk('SNAPSHOT_MISMATCH', 'Snapshot Hash 불일치 — 기존 Approval/Canary 무효');
  }
  if (c.immutable !== true) return mk('INSUFFICIENT_DATA', 'immutable 아님');
  return { validity: 'VALID', reasons: ['Version 고정 + Snapshot 무결성 확인'] };
}

export function validateRollbackTarget(r: RollbackTarget | null): FixtureValidation {
  if (r == null) return mk('NO_ROLLBACK_TARGET', 'Rollback Target 미구성');
  if (!r.existingPlaylistId || !r.existingSnapshotHash) return mk('NO_ROLLBACK_TARGET', 'Existing Playlist/Snapshot 없음');
  if (!r.existingResolverSource) return mk('INSUFFICIENT_DATA', 'Existing Resolver Source 없음 (Rollback 은 Resolver 재사용)');
  return { validity: 'VALID', reasons: ['Rollback Target 자료 준비 (실제 Rollback 실행 아님)'] };
}

export function validateAllowlist(a: PreviewAllowlistFixture | null, nowMs: number): FixtureValidation {
  if (a == null) return mk('MISSING', 'Allowlist 미구성');
  if (a.environment !== 'preview') return mk('NOT_PREVIEW', 'Preview 환경 아님');
  if (a.maxSessions !== 1) return mk('INSUFFICIENT_DATA', 'max_sessions 는 1 이어야 함');
  if (a.enabled !== false) return mk('INSUFFICIENT_DATA', 'enabled 는 이번 Phase 에서 false 여야 함 (Runtime 활성화 금지)');
  if (!(a.expiresAtMs > nowMs)) return mk('EXPIRED', 'Allowlist 만료/무기한 금지');
  return { validity: 'VALID', reasons: ['단일 Store Allowlist Fixture 유효 (enabled=false · Kill Switch ON)'] };
}
