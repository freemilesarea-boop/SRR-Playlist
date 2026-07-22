# 04 — Security Classification

| RPC | Class | Guard status |
|---|---|---|
| get_admin_track_detail | ADMIN_READER | guard ADDED (was over-exposed) |
| list_admin_tracks_with_ai | ADMIN_READER | guard ADDED |
| ai_correction_stats | ADMIN_READER | guard ADDED |
| list_severe_metadata_mismatches | ADMIN_READER | guard ADDED |
| list_clap_curation_playlists | ADMIN_READER | guard ADDED |
| list_clap_recommendations | ADMIN_READER | guard ADDED |
| list_clap_auto_approved | ADMIN_READER | guard ADDED |
| admin_hard_delete_track | ADMIN_WRITE | guard preexisting |
| admin_purge_all_tracks | ADMIN_WRITE | guard preexisting (+confirm token) |
| admin_update_track_metadata_full | ADMIN_WRITE | guard preexisting |
| bulk_delete_severe_mismatches | ADMIN_WRITE | guard preexisting |
| rollback_clap_auto_attach | ADMIN_WRITE | guard preexisting |
| set_playlist_auto_attach | ADMIN_WRITE | guard preexisting |
| _log_ai_correction | INTERNAL_ONLY | no guard by design; **no client grant** (definer-context only) |
| snapshot_artist_lifetime_streams | INTERNAL_ONLY | admin-guarded; no client grant |

## Admin Reader requirements — all met
`auth.uid()` + real admin role checked **before any row read**; unauthorized → exception (no partial data); numeric limit cap; server-fixed stable ordering; no dynamic SQL / no user-controlled sort or filter string; minimal sensitive return.

## Admin Write requirements — all met
Admin role checked; actor = `auth.uid()`; input validation (energy 1–5, bpm 0–400, threshold 0–100, purge confirm token); target existence checks (`track_not_found`, `not_found`); transaction (function body atomic; purge wraps per-track in sub-blocks); idempotency (revenue-protected soft delete, `coalesce` fills, status guards); audit (`removed_by`, `corrected_by`, `reviewed_by`, `applied_by`).

## Owner Reader
**None among the 13.** The only ownership surface is the recovered dependency table `artist_lifetime_streams`, whose `alstreams_self_read` RLS policy (`artist_user_id = auth.uid()`) confines each artist to their own row — verified in `12-sql-security-tests.md`.
