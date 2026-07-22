# DB-SCHEMA-RECONCILIATION-1 — Executive Summary

> Branch `claude/db-schema-reconciliation-1` from `claude/platform-hotfix-1-rpc-cron` (`8716e7a`). READ-ONLY remote metadata verification. **0 migrations, 0 code changes, 0 production changes.** No function executed, no user data / PII read, no secrets output.

## Remote verification result
- **Access:** Test `hao…qorr` (SRR Playlist Test) + Production `nso…zvol` (SRR Playlist) — **distinct projects (isolated)**, both reachable read-only via `pg_catalog`/`information_schema` metadata.
- **The 31 RPCs: PRESENT in Production, ABSENT in Test, MISSING in Repository → PRODUCTION_ONLY (all 31).** Applied to Production out-of-band; never committed, never applied to Test.
- **Deeper drift:** the backing tables `site_notices`, `site_settings`, `support_inquiries`, `support_inquiry_attachments`, `track_ai_predictions` are **also Production-only** (CLAP tables exist in Test+repo).

## Security certification
- **All 31 are SECURITY DEFINER with `search_path=public`** → the classic search-path smell is **not** present.
- **Destructive/write functions** (hard-delete, purge, bulk-delete, metadata update, apply-predictions, inquiry/notice writes, auto-attach) — **admin/role check + `auth.uid()` + raise-on-guard detected → PASS**.
- **User-scoped** (create/list/get my inquiry) and **public** (`get_site_settings`, `list_active_site_notices`, anon-granted) — appropriately scoped.
- **FINDING (P2):** **10 admin/internal READER functions** are SECURITY DEFINER granted to `authenticated` with **no in-function admin check** → any logged-in user can read admin data (RLS bypassed): `get_admin_track_detail`, `list_admin_tracks_with_ai`, `admin_list_site_notices`, `ai_correction_stats`, `ai_predictions_summary`, `list_pending_ai_predictions`, `list_severe_metadata_mismatches`, `list_clap_recommendations`, `list_clap_auto_approved`, `list_clap_curation_playlists`. Data is internal-ops (no PII/money) → **P2, live in Production**. `admin_list_support_inquiries` returns contact email/phone but **is** admin-guarded (PASS).

## Test/Production comparison
All 31 = **PRESENT_PROD_ONLY** (Test has none) → no cross-env source-hash comparison possible; **Test must be restored**.

## Resolution (per RPC)
- **All 31 → COMMIT_REMOTE_DEFINITION + RESTORE_TEST_SCHEMA** (exact signatures captured; exact source obtainable via `pg_get_functiondef` in recovery).
- **10 readers → additionally REQUIRE_SECURITY_FIX** (add admin gate / restrict grant) during recovery.
- **0 → REMOVE/DISABLE** (all exist in Prod, all reachable). **0 → ABSENT_BOTH.**

## Blocking / production
- **Cron gate (BLOCKED_UNVERIFIED):** `CRON_SECRET` existence in Vercel Prod/Preview **cannot be verified here**. PLATFORM-HOTFIX-1 daily-metrics returns 503 without it → **operator must set `CRON_SECRET` before merging the hotfix**.
- **RPC drift:** frontend calls **work in Production today** (functions present); Test/Preview cannot exercise them, and repo doesn't reflect prod.

## Verdict / next
**READY_FOR_RPC_MIGRATION_RECOVERY** (with mandatory security fix for the 10 over-exposed readers). Next phase: **RPC-MIGRATION-RECOVERY** — port the Production table+function definitions into committed migrations, fix the over-exposed grants, apply to Test, then a grants-tightening migration to Production.
