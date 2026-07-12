// AI-MUSIC-7 — Internal test store allowlist check. Only an explicit, super-admin-created, preview-scoped,
// non-expired, enabled entry allows a store. No wildcards, no auto-inclusion of general/enterprise stores. The
// entry pins the allowed candidate playlist + version and a max-session cap. Production environment entries are
// never valid (environment must be 'preview').

import type { AllowlistCheckInput, AllowlistCheckResult, AllowlistStatus } from './types';

export function checkAllowlist(input: AllowlistCheckInput): AllowlistCheckResult {
  const reasons: string[] = [];
  const e = input.entry;

  if (!e) return { status: 'NOT_ALLOWED', reasons: ['Allowlist 항목 없음 — 내부 테스트 Store 아님'] };
  if (e.environment !== 'preview') return { status: 'ENV_MISMATCH', reasons: ['environment !== preview'] };
  if (!e.enabled) return { status: 'DISABLED', reasons: ['Allowlist 항목 비활성'] };
  if (e.expiresAt == null || e.expiresAt <= input.nowMs) return { status: 'EXPIRED', reasons: ['Allowlist 만료(또는 만료시각 없음)'] };

  // Candidate scope: the entry pins which candidate playlist/version this store may run.
  if (e.allowedCandidatePlaylistId != null && input.candidatePlaylistId !== e.allowedCandidatePlaylistId) {
    reasons.push('Candidate Playlist 승인 범위 밖');
    return { status: 'CANDIDATE_OUT_OF_SCOPE', reasons };
  }
  if (e.allowedCandidateVersion != null && input.candidateVersion !== e.allowedCandidateVersion) {
    reasons.push('Candidate Version 승인 범위 밖');
    return { status: 'CANDIDATE_OUT_OF_SCOPE', reasons };
  }

  // Per-store max concurrent/total canary session cap.
  if (input.activeSessions >= e.maxSessions) {
    return { status: 'SESSION_CAP_REACHED', reasons: [`Session Cap 도달 (${input.activeSessions}/${e.maxSessions})`] };
  }

  return { status: 'ALLOWED', reasons: ['내부 테스트 Store 허용 (preview, 유효, 범위 내)'] };
}

export function isAllowlisted(status: AllowlistStatus): boolean { return status === 'ALLOWED'; }
