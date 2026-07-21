# 08 — Production Checklist (operator)

## Cron
- [ ] `CRON_SECRET` set in Production (and Preview) Vercel env — **required**; daily-metrics now returns 503 without it.
- [ ] Vercel Cron sends `Authorization: Bearer <CRON_SECRET>` (default) — confirm daily-metrics + enterprise-ops still authenticate after deploy.
- [ ] Confirm no external caller can hit `/api/cron/*` without the secret (401/403 expected).

## RPC reconciliation (read-only, before relying on the 31)
- [ ] Run the `pg_proc` query (`03-schema-drift-report.md`) on **Test** and **Production** for the 31 names.
- [ ] For each present-remote/absent-local: export definition into a committed migration OR remove the client call.
- [ ] Verify destructive RPCs (`admin_purge_all_tracks`, `admin_hard_delete_track`, `bulk_delete_severe_mismatches`) have super-admin gate + audit + confirm.
- [ ] Verify support/track RPCs enforce RLS/role scoping + PII masking.
- [ ] Any genuinely-missing RPC: keep the PGRST202 safe message; schedule the fix.

## CI
- [ ] `lint-rpc-registry` workflow active on PRs (blocks new undefined RPCs).
- [ ] Do not add names to `rpc-remote-only-allowlist.json` without a reconciliation decision.

## Rollback
- [ ] Changes are additive (cron helper, error mapping, lint) → revert the PR; no DB/migration to undo.
