# 01 — Remaining RPC Inventory (13)

Source: RPC registry, repository call sites, Production metadata (read-only). No Production rows read, no RPC executed on Production.

| RPC | Cluster | Purpose | Caller | R/W | Admin-only | Ownership | Sensitive return | Call site |
|---|---|---|---|---|---|---|---|---|
| get_admin_track_detail | D | Full admin track detail (+AI) | Admin | R | yes | n/a | internal review fields | adminTrackApi.ts:75 |
| list_admin_tracks_with_ai | D | Admin track list +AI | Admin | R | yes | n/a | — | adminTrackApi.ts:189 |
| ai_correction_stats | D | AI-vs-admin correction stats | Admin | R | yes | n/a | aggregate only | adminTrackApi.ts:205 |
| list_severe_metadata_mismatches | D | QC mismatch queue | Admin | R | yes | n/a | mismatch reasons | adminTrackApi.ts:224 |
| admin_hard_delete_track | D | Delete track (revenue-safe) | Admin | W | yes | n/a | storage paths (for cleanup) | adminTrackApi.ts:91 |
| admin_purge_all_tracks | D | Purge all (confirm-gated) | Admin | W | yes | n/a | counts | adminTrackApi.ts:243 |
| admin_update_track_metadata_full | D | Full metadata edit + AI-correction log | Admin | W | yes | n/a | — | adminTrackApi.ts:136 |
| bulk_delete_severe_mismatches | D | Bulk delete QC mismatches | Admin | W | yes | n/a | counts | adminTrackApi.ts:255 |
| list_clap_curation_playlists | E | Curation playlist overview | Admin | R | yes | n/a | ops counts | clapCurationApi.ts:48 |
| list_clap_recommendations | E | Pending CLAP recs for playlist | Admin | R | yes | n/a | scores | clapCurationApi.ts:57 |
| list_clap_auto_approved | E | Auto-approved CLAP attachments | Admin | R | yes | n/a | scores | clapCurationApi.ts:106 |
| rollback_clap_auto_attach | E | Undo an auto-attach | Admin | W | yes | n/a | — | clapCurationApi.ts:112 |
| set_playlist_auto_attach | E | Toggle/threshold auto-attach | Admin | W | yes | n/a | — | clapCurationApi.ts:123 |

## Split
- **Cluster D (8):** admin track detail / QC / moderation / metadata edit / delete.
- **Cluster E (5):** CLAP curation & playlist auto-attach operations.

## Language / guard state in Production
- **7 `language sql` readers, no admin guard** (over-exposed to `authenticated`): all 4 D readers + all 3 E readers → SECURITY FIX (plpgsql + admin guard, contract preserved).
- **6 `plpgsql` writes, already admin-guarded** (actor=`auth.uid()`): 4 D writes + 2 E writes → verbatim.

## Transitive Production-only dependencies (recovered in 0460/0461)
- Table `ai_metadata_corrections` (10 cols) — written by `_log_ai_correction`, read by `ai_correction_stats`.
- Table `artist_lifetime_streams` (9 cols) — written by `snapshot_artist_lifetime_streams` (called by `admin_purge_all_tracks`).
- Helper fn `_log_ai_correction` (internal, no client grant).
- Helper fn `snapshot_artist_lifetime_streams` (internal, admin-guarded).
- Columns `playlists.auto_attach_enabled` / `auto_attach_threshold` (Production-only column drift) — written by `set_playlist_auto_attach`, read by `list_clap_curation_playlists`.

These are not in the "undefined RPC" list (not client-`.rpc()`-called) but are execution dependencies; recovered so Cluster D/E run in Test.
