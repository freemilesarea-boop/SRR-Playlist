# 14 — RPC Contract Tests

Synthetic rows only; no model execution. Per-RPC coverage (existence, signature, required/optional params, unauthorized, forbidden, not-found, normal, empty, return shape, ordering, invalid input, transaction rollback).

| RPC | exists | sig | unauthorized | not-found/invalid | normal/empty | ordering/limit |
|---|---|---|---|---|---|---|
| get_admin_track_detail | ✔ | ✔ | PASS | bad uuid → 0 rows | empty OK | n/a |
| list_admin_tracks_with_ai | ✔ | ✔ (default 1000) | PASS | — | empty OK | created_at desc, limit |
| ai_correction_stats | ✔ | ✔ | PASS | — | empty OK | total desc |
| list_severe_metadata_mismatches | ✔ | ✔ (default 100) | PASS | — | empty OK | confidence desc, limit |
| admin_hard_delete_track | ✔ | ✔ | PASS | `track_not_found` | (write path) | n/a |
| admin_purge_all_tracks | ✔ | ✔ | PASS | `confirmation_required` | (write path) | n/a |
| admin_update_track_metadata_full | ✔ | ✔ (25 optional) | PASS | `energy_level must be 1-5` | coalesce update | n/a |
| bulk_delete_severe_mismatches | ✔ | ✔ (defaults 0.6,100) | PASS | — | counts | confidence desc, limit |
| list_clap_curation_playlists | ✔ | ✔ | PASS | — | empty OK | centroid updated desc |
| list_clap_recommendations | ✔ | ✔ (default 20) | PASS | bad playlist → 0 rows | empty OK | total_score desc, limit |
| list_clap_auto_approved | ✔ | ✔ (default 50) | PASS | — | empty OK | reviewed_at desc |
| rollback_clap_auto_attach | ✔ | ✔ | PASS | `not_found` / `not_auto_approved` | (write path) | n/a |
| set_playlist_auto_attach | ✔ | ✔ | PASS | `threshold must be 0-100` | (write path) | n/a |

- No overloads (each name single-signature on Test).
- Transaction rollback: all write bodies atomic; `admin_purge_all_tracks` isolates per-track failures in sub-blocks (counts `failed`).
- No dynamic SQL / no user sort input → invalid-sort/filter not applicable.
