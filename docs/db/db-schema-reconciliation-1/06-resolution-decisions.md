# 06 — Resolution Decisions

> Machine-readable: `rpc-resolution-decisions.json`. No code/migration authored this phase.

## All 31 → COMMIT_REMOTE_DEFINITION + RESTORE_TEST_SCHEMA
Justification: present in Production with exact, capturable definitions; absent in Test and Repository. Recovery legitimately reconstructs the repo from the verified Production source (via `pg_get_functiondef`, admin read-only) — **not** guessed. Must also be applied to Test (currently missing) and their **Production-only tables** (site_notices/site_settings/support_inquiries/+attachments/track_ai_predictions) recovered first.

## 10 also → REQUIRE_SECURITY_FIX
`get_admin_track_detail`, `list_admin_tracks_with_ai`, `admin_list_site_notices`, `ai_correction_stats`, `ai_predictions_summary`, `list_pending_ai_predictions`, `list_severe_metadata_mismatches`, `list_clap_recommendations`, `list_clap_auto_approved`, `list_clap_curation_playlists` → add admin gate or revoke `authenticated` EXECUTE before/with committing.

## None → REMOVE_OR_DISABLE_CALL
No ABSENT_BOTH; every call reaches a live Production function.

## None → DEFER (except algorithm caution)
The AI/CLAP write functions (`apply_track_ai_predictions`, `bulk_apply_*`, `set_playlist_auto_attach`, `rollback_clap_auto_attach`) touch AI-curation state — recovery must port them **verbatim** (no algorithm change) and only adjust grants/gates.

## Decision counts
| Decision | Count |
|---|---|
| COMMIT_REMOTE_DEFINITION + RESTORE_TEST_SCHEMA | 31 |
| …of which also REQUIRE_SECURITY_FIX | 10 |
| REMOVE_OR_DISABLE_CALL | 0 |
| INVESTIGATE_PRODUCTION_DRIFT | 0 (source confirmed) |
| DEFER | 0 |
