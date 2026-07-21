# PLATFORM-HOTFIX-1 — Executive Summary

> Branch `claude/platform-hotfix-1-rpc-cron` from default/production `acebedd` (independent of AUTH-STABILIZATION-1 — RPC/cron changes are unrelated to auth). No production/DB/deploy/merge. No settlement/payment/AI algorithm change. **No RPC created.**

## RPC reconciliation
- **725** distinct `supabase.rpc()` call names; **946** local `CREATE FUNCTION` defs; **31 undefined locally** — confirms PLATFORM-AUDIT-1B's corrected count exactly.
- All 31 verified: **no local definition, no git-history definition** (4/4 spot-checked deeply; all 31 checked against migrations + `schema.sql` + seed + admin SQL). They back **live UI** (support inquiries, site notices/settings, track-AI predictions, admin-track, CLAP curation).
- **Remote DB not accessible** → all **UNVERIFIED_REMOTE**. Most likely **DEFINED_REMOTE_ONLY** (applied out-of-band).
- **Decision for all 31: DOCUMENT_REMOTE_ONLY + DEFER to DB-SCHEMA-RECONCILIATION.** None created (bulk-create ban + no confirmed contract + no guessing).

## Numbers
| | Count |
|---|---|
| Defined-local-active | (946 total defs) |
| Undefined (called, no local def) | **31** |
| Remote-only (unverified) | 31 |
| Restored / Replaced / Disabled | 0 |
| Deferred (reconciliation) | 31 |
| Dead calls | 0 confirmed |

## Changes made (minimal, safe)
1. **Cron fail-closed (H-02, FIXED):** `api/_lib/cronAuth.ts` (new, timing-safe) + `api/cron/daily-metrics.ts` now returns **503** (CRON_SECRET unset), **401** (no header), **403** (mismatch). Previously it skipped auth entirely when the secret was unset → unauthenticated service_role RPC execution. `enterprise-ops` was already fail-closed (documented, unchanged).
2. **Error recovery (H-03, FIXED):** `errorMessages.ts` maps `PGRST202` / `42883` / "could not find the function" → safe Korean message, **without leaking function names/SQL**. All 6 undefined-RPC wrappers `throw`, so a missing RPC surfaces this message instead of infinite loading / blank / raw error.
3. **CI guard (H-04, FIXED):** `scripts/lint-rpc-registry.mjs` + `scripts/rpc-remote-only-allowlist.json` (the 31) + `.github/workflows/lint-rpc-registry.yml` + `npm run lint:rpc`. Fails on any **new** undefined RPC.
4. **Tests:** `api/_lib/cronAuth.test.ts` (7) + `src/lib/errorMessages.test.ts` (6) = 13 new; vitest include extended to `api/**`.

## Verification
tsc PASS · eslint (src + api) PASS · **vitest 85/85** · vite build PASS · `lint:rpc` PASS (31 undefined, all allowlisted, 0 new).

## Cron status
`daily-metrics` **HARDENED**; `enterprise-ops` + `enterprise-ops-run` + 4 edge-fn crons already compliant (documented). Secret never logged; comparison timing-safe.

## Production readiness
**READY_FOR_PREVIEW_QA** for the code changes; the 31 RPCs remain **UNVERIFIED_REMOTE** (→ DB-SCHEMA-RECONCILIATION). Operator must set `CRON_SECRET` in production (checklist).

## Next phase
**DB-SCHEMA-RECONCILIATION** — run the read-only `pg_proc` query on Test + Production, then per RPC either commit its migration or remove the call.
