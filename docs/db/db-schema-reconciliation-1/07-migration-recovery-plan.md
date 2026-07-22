# 07 — Migration Recovery Plan (for next phase — NOT authored here)

> Machine-readable: `rpc-migration-plan.json`. Principle: **tables → functions → grants**, one migration per domain cluster, apply to **Test first**.

| # | Cluster | Prod-only tables to recover | Functions | Security fix |
|---|---|---|---|---|
| 1 | site-notices+settings | site_notices, site_settings | get/admin_update_site_settings, list_active/admin_list/upsert/toggle/delete_site_notice | admin_list_site_notices |
| 2 | support-inquiries | support_inquiries, support_inquiry_attachments | create/list_my/get_my inquiry + admin_list/get/summary/update | — (keep admin-gated; mask PII later) |
| 3 | track-ai-predictions | track_ai_predictions | ai_predictions_summary, list_pending, apply, bulk_apply | ai_predictions_summary, list_pending_ai_predictions |
| 4 | admin-track | — (deps: tracks, track_ai_predictions) | get_admin_track_detail, list_admin_tracks_with_ai, ai_correction_stats, list_severe_metadata_mismatches, admin_update_track_metadata_full, admin_hard_delete_track, admin_purge_all_tracks, bulk_delete_severe_mismatches | get_admin_track_detail, list_admin_tracks_with_ai, ai_correction_stats, list_severe_metadata_mismatches |
| 5 | clap-curation | — (deps present) | list_clap_recommendations, list_clap_auto_approved, list_clap_curation_playlists, set_playlist_auto_attach, rollback_clap_auto_attach | list_clap_recommendations, list_clap_auto_approved, list_clap_curation_playlists |

## Per-migration checklist (recovery phase)
- Capture exact source via `pg_get_functiondef` (admin, read-only) per cluster.
- Recover table DDL (columns, PK, FK, RLS, indexes) for the Production-only tables **before** their functions.
- Apply the security fix to over-exposed readers (admin gate or revoke `authenticated`).
- Preserve exact `p_*` arg names/types + return columns (client contract).
- Rollback: `drop function`/`drop table if exists` guarded; Production functions already exist → the Production migration is grants-tightening only.
- Apply order: **Test → verify (SQL + app) → Production (grants tighten + register migration)**.

## No migration authored this phase (per absolute conditions).
