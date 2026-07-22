# RPC-MIGRATION-RECOVERY-1 — Executive Summary

> Branch `claude/rpc-migration-recovery-1` from `claude/db-schema-reconciliation-1` (`afa7f02`). Read-only Production metadata; **migrations applied to Test only; 0 Production changes**. No function executed on Production, no user data/PII read, no full source in reports.

## Scope reality
Recovering 5 Production-only tables + 31 verbatim functions + 10 security fixes is large. This phase delivers a **complete, verified vertical slice (Cluster A)** end-to-end on Test, and **captures exact definitions + prepares** clusters B–E. Honest status: **partial** (not all 31) — see §Completion.

## Cluster A — COMPLETE + VERIFIED on Test
- **Tables recovered:** `site_settings`, `site_notices` (exact columns, checks, FK→users, partial index, RLS + policies) → created on Test.
- **7 RPCs recovered:** `get_site_settings`, `list_active_site_notices` (public/anon), `admin_list_site_notices`, `admin_upsert_site_notice`, `admin_toggle_site_notice`, `admin_delete_site_notice`, `admin_update_site_settings` → created on Test with signatures matching Production.
- **Security fix applied + verified:** `admin_list_site_notices` was `language sql` with **no admin check** (over-exposed to `authenticated`). Rewritten to plpgsql with the repo's canonical admin guard (same signature/return). Functional test on Test: **guard raises `unauthorized` for non-admin; public reader still callable**.
- **Migration:** `supabase/migrations/0457_site_notices_settings_recover.sql`, applied to Test (`hao…qorr`).

## Clusters B–E — definitions captured, migrations prepared (not applied)
- **B support-inquiries** (2 tables + 7 fns), **C track-ai-predictions** (1 table + 4 fns), **D admin-track** (0 tables + 8 fns), **E clap-curation** (0 tables + 5 fns). All 5 tables' exact DDL captured; function-recovery method proven; 9 remaining over-exposed readers to fix. See `05/07` + `10-production-apply-plan`.

## Security
Repo canonical guard confirmed: `exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin')`. 10 over-exposed readers identified; **1 fixed (Cluster A)**, 9 planned. All functions keep `SECURITY DEFINER` + `search_path=public` (verified). Grants: `revoke all from public`; public→anon/authenticated; admin/user→authenticated + internal guard.

## Verification
migration-lint PASS (417 files) · **rpc-registry: 31→24 undefined (−7 recovered), 0 new, PASS** · tsc PASS · vitest 85/85 · Test apply + functional guard test PASS. **0 Production changes.**

## Completion (honest)
Applied+verified on Test: **7/31 RPCs, 2/5 tables, 1/10 security fixes**. Prepared (captured, not applied): 24/31, 3/5. → Per the phase's all-or-nothing rule this is **RPC-MIGRATION-RECOVERY INCOMPLETE (full set)**, delivered as a verified Cluster-A increment.

## Verdict / next
**TEST_SCHEMA_ONLY.** Next: continue recovery for clusters B–E (same proven method), then **RPC-PRODUCTION-APPLY** (which must include the 10 grant/guard security fixes as the real Production remediation) after `CRON_SECRET` is set.
