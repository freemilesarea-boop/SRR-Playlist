# 11 — Production Readiness

## Current production state (verified read-only)
- All 31 RPCs + their backing tables **exist in Production** → the frontend calls **work in Production today** (no live PGRST202 there).
- **Test is missing all 31 + 5 tables** → Test/Preview cannot exercise these features (E2E/QA gap).
- Repository does not contain them → drift.

## Blocking findings
1. **Cron secret gate (BLOCKED_UNVERIFIED):** set `CRON_SECRET` in Vercel before merging PLATFORM-HOTFIX-1 (else daily-metrics 503).
2. **10 over-exposed admin readers (P2, live):** any authenticated user can read admin/curation/track-detail data. Fix during recovery/hardening. Not an emergency (no PII/money) but should not persist.

## Not blocking
- The 31 functions themselves are safely present in Production with `search_path` set and writes admin-guarded.

## Production recommendation
**READY_FOR_RPC_MIGRATION_RECOVERY** — proceed to reconstruct repo + Test from the verified Production definitions, folding in the security fix for the 10 readers. Do **not** treat the drift as resolved until the migrations land and Test matches.

## Guarantees (this phase)
0 migrations · 0 code changes · 0 production changes · no function executed · no user data / PII read · no secrets / connection strings output · project refs masked · Test/Prod isolation confirmed.
