# 09 — Binding Security (browser)

## Status: BLOCKED / NOT RUN (server-side already certified 19/19)
Runbook: Tampered token (edit localStorage token) → fail-closed, token cleared, code screen, no internal error. Revoked (revoke on Test) → refresh fails, heartbeat fails, revoked notice. Expired (set expires_at past on a synthetic binding) → config/heartbeat fail, expired notice, code re-entry. Cross-user (User A token in User B context) → blocked, no brand/store info, token cleared. Never record real token values. Server certification: docs/brand-player/test-recovery-1/16-security-certification.md.
