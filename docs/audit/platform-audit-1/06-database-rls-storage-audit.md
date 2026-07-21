# 06 — Database / RLS / Storage Audit

> PLATFORM-AUDIT-1 · READ-ONLY static SQL analysis of `supabase/migrations/*.sql` (419 files, `0001`–`0456`) + `supabase/tests`. **No DB connected.** Deployed-schema-vs-migration drift is `UNVERIFIED`.

## Migration health
- **True duplicate numeric prefixes:** `0068`, `0214`, `0388` — all in `scripts/lint-migrations.mjs` allowlist (intentional/already-in-prod). Suffix families (`0167b`, `0367a/b/c`, …) are lint-legal.
- **Sequence gaps:** `0198-0203`, `0354`, `0365-0366`, `0408-0411`, `0414-0419`, `0421-0451`, then jumps to `0452-0456`. Gaps are cosmetic (Supabase applies lexically) but the `0421-0451` void suggests squashed/abandoned branches → `UNVERIFIED` whether prod ran anything there. **DB-F5.**
- **Destructive ops:** `DROP TABLE`×2, `DROP COLUMN`×0, `DROP CONSTRAINT`×41 (redefinitions), `DROP FUNCTION`×122 (mostly `or replace` churn), `TRUNCATE`×1, `DROP POLICY`×320 (drop+recreate idempotency pattern). **Low destructive risk; no column drops.**
- **`lint-migrations.mjs` checks exactly 2 rules:** (1) `unsafe-array-concat` (`text[] || 'literal'` bug), (2) `duplicate-prefix`. It does **not** check search_path, SECURITY DEFINER, RLS, or gaps. Current status: **0 violations** (ran this phase).

## Tables (~205)
Grouped by domain (first-creating migration cited):
- **Core content/playback:** `users`, `tracks`, `playlists`, `playlist_tracks`, `likes`, `recent_plays` (`0001`); analytics `daily_metrics`, `revenue_events`, `stream_events`, `visitor_events` (`0002`); library `liked_tracks`, `continue_listening` (`0005`).
- **Artists/uploads/review:** `artist_profiles` (`0017`), `artist_contracts` (`0057`), `artist_payout_accounts` (`0025`, **PII/bank**), moderation/QC (`0074`,`0224`,`0242`), metadata audit (`0176`,`0191`,`0194`).
- **Settlement/money (sensitive):** `artist_settlements`+`settlement_items`+`settlement_generation_runs` (`0060`), `settlement_policies`+`streaming_revenues` (`0059`), `settlement_adjustments` (`0321`), `settlement_admin_audit_logs` (`0311`), payout intake/reveal logs (`0304`,`0061`). **V2 shadow set** (`0420`, 0 src refs). **Logic2** (`0454`).
- **Payments/subscriptions:** `payment_orders`, `subscriptions`, `subscription_plans`, `payapp_webhook_events` (`0015`), promotions (`0104`), free trial (`0195`), sales agents (`0054`).
- **Business/franchise:** `business_profiles`+schedules (`0007`), verification (`0014`); **franchise cluster** 9 tables (`0349`).
- **Enterprise HQ (largest recent surface `0351-0407`):** `enterprise_accounts`, regions, franchises, settlement profiles/monthly, billing invoices+items (`0382`), contracts+files (`0383`), announcements/scheduler (`0381`), NOC, brand registry, incidents.
- **Brand player (MVP `0405`):** `brand_accounts`, `brand_media_assets`, `brand_music_policies`, `brand_player_sessions`, `brand_audit_logs`; `brand_signage_settings` (`0452`).
- **AI curation/embeddings:** `track_ai_metadata`, `track_audio_features`, `playlist_track_fit_scores` (`0156`), embeddings (`0169`,`0171`), guardrails (`0173`), behavior learning, taxonomy (`0228`), CLAP recs+centroids (`0219`), weight-regression (`0335-0338`), reactions (`0345`).
- **Streaming V2 (`0412`):** `stream_ingest_v2`, `stream_sessions_v2`, `stream_dispute_flags` + 4 views.
- **Admin/RBAC/ops:** `admin_users`+`admin_action_log` (`0192`), operation logs, notifications, QC queue, `system_settings` (`0353`), `app_internal_secrets` (`0223`, **secrets**), support tables.

**Orphan/dead candidates (0 src refs):** `_x6_playlist_archive_snapshot`, `_x6_schedule_fix_snapshot` (`0282`), `signup_debug_events` (`0022`), settlement V2 shadow set (`0420`), `store_archetype_seed_candidates` (`0171`). → see `12-dead-deprecated-candidates.md`. **Do not drop this phase.**

## Views
**0 materialized views.** 12 regular views incl. `eligible_settlement_tracks` (`0058`), `store_now_playing` (`0356`), streaming-v2 quartet (`0412`). Settlement/streaming lean on views (recomputed per query) → perf `UNVERIFIED`.

## Functions / RPCs
- ~1,356 `create [or replace] function` statements across files but heavy `or replace` churn → **distinct count far lower, `UNVERIFIED`**.
- **362 files contain `security definer`** — dominant pattern (RPC bypasses RLS, self-checks role).
- **⚠ SECURITY DEFINER WITHOUT `set search_path` (5 files — search-path smell):** `0051`, `0120`, `0140`, `0284`, `0374`. `0374` is recent (enterprise writes) → **DB-F2, review.**
- Money-movement RPCs (settlement/payout/billing/carryover) all SECURITY DEFINER; correctness covered by 3 `supabase/tests`.

## Triggers / Enums / Constraints
- **89 `create trigger`** (announcement exact-time, QC pg_net enqueue, fit-score recompute, embedding pipeline, updated_at, settlement audit).
- **0 enums** — status/role use `text` + `CHECK (x in (...))`. No DB-level enum guarantee.
- Pervasive FK/UNIQUE/CHECK; idempotency constraints on notification dispatch (`0392`), announcement dedup (`0389`).

## RLS
- **203 `enable row level security`; 336 `create policy`.** Broadly enabled.
- **All checked money/PII/secret tables HAVE RLS:** `users`, `artist_payout_accounts`, `payout_intake_submissions`, `artist_settlements`, `settlement_items`, `streaming_revenues`, `payment_orders`, `subscriptions`, `app_internal_secrets`, `artist_contracts`, `enterprise_billing_invoices`, `enterprise_contracts`. **No sensitive table found without RLS.**
- **Caveat (DB-F1, P2):** correctness of the 336 policies is `UNVERIFIED` (not evaluated line-by-line). Risk = over-permissive policies, not missing RLS. `0388_artist_settlement_visibility_lockdown` implies a prior visibility gap existed.

## Storage buckets
| Bucket | Public | Created | Notes |
|---|---|---|---|
| `audio` | public | `0010` | 100MB limit (`0107`) |
| `covers` | public | `0010` | cover art |
| `brand-assets` | public | `0213` | brand logos |
| `brand-media` | public | `0405` | +video/50MB (`0453`) |
| `enterprise-announcements` | public | `0381` | intentional broadcast |
| `enterprise-documents` | **private** | `0367c` | settlement docs |
| `enterprise-contracts` | **public→PRIVATE** | `0383`→`0394` | **security fix** — `0383` shipped public w/ anon read; `0394` flips `public=false`, super_admin-only signed URLs. **DB-F3.** |

**DB-F3 (P1, security):** `enterprise-contracts` had a public-read window (`0383`) before `0394` locked it. Confirm no confidential contract URLs leaked while public; `0394` only fixes forward.

## Cron / pg_net / Realtime
- **pg_cron:** exactly **one** job — `srr-weight-regression-weekly` (`0337`).
- **pg_net async HTTP:** `0223` (secrets), `0225` (QC enqueue), `0340` (embedding pipeline) fire edge functions from triggers.
- **Realtime publication `supabase_realtime`:** `payment_orders`, `users` (`0049`), `store_policy_sync_status` (`0349`) — guarded with `if publication exists` (self-host → UI-poll fallback).

## Findings
- **DB-F1 (P2):** 336 RLS policies not individually verified; deployed drift `UNVERIFIED`.
- **DB-F2 (P2, security):** 5 SECURITY DEFINER files lack `set search_path` (esp. recent `0374`).
- **DB-F3 (P1, security):** `enterprise-contracts` public→private window — audit for leakage.
- **DB-F4 (P3):** dead/orphan tables (`_x6_*`, `signup_debug_events`, settlement V2 shadow).
- **DB-F5 (P3):** `0421-0451` migration-number void — confirm no lost migration state.
