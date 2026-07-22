# 03 — Application Call-site Analysis

Wrapper modules: `src/lib/adminTrackApi.ts` (Cluster D) and `src/lib/clapCurationApi.ts` (Cluster E). Importers: `src/components/admin/{ContentManagement,SiteSettingsPanel,ClapRecommendationPanel}.tsx` — **all admin-only surfaces**.

| RPC | Wrapper | Params | Return | Client id passed? |
|---|---|---|---|---|
| get_admin_track_detail | `getAdminTrackDetail` | `{p_track_id}` | detail row | no |
| list_admin_tracks_with_ai | `listAdminTracksWithAi` | `{p_limit}` | rows[] | no |
| ai_correction_stats | `aiCorrectionStats` | — | stats[] | no |
| list_severe_metadata_mismatches | `listSevereMetadataMismatches` | `{p_limit}` | rows[] | no |
| admin_hard_delete_track | `adminHardDeleteTrack` | `{p_track_id}` | storage refs | no |
| admin_purge_all_tracks | `adminPurgeAllTracks` | `{p_confirm}` | counts | no |
| admin_update_track_metadata_full | `adminUpdateTrackMetadataFull` | 26 `p_*` fields | void | no |
| bulk_delete_severe_mismatches | `bulkDeleteSevereMismatches` | `{p_min_confidence, p_limit}` | counts | no |
| list_clap_curation_playlists | `listClapCurationPlaylists` | — | rows[] | no |
| list_clap_recommendations | `listClapRecommendations` | `{p_playlist_id, p_limit}` | rows[] | no |
| list_clap_auto_approved | `listClapAutoApproved` | `{p_limit}` | rows[] | no |
| rollback_clap_auto_attach | `rollbackClapAutoAttach` | `{p_recommendation_id}` | void | no |
| set_playlist_auto_attach | `setPlaylistAutoAttach` | `{p_playlist_id, p_enabled, p_threshold}` | void | no |

## Findings
- **No user / track-owner call site.** Every consumer is an admin component.
- **No client-supplied identity.** No `user_id`/`actor_id`/`admin_id` is passed; the server derives actor from `auth.uid()`.
- **Error handling:** every wrapper does `if (error) throw error;`; several have empty-state defaults (e.g. `?? []`).
- **Pagination/filter/sort:** limits are numeric params (`p_limit`); ordering is server-fixed (no client-controlled sort string → no injection surface).

## Contract decision
**Keep all 13 signatures.** The security fix (admin guard on 7 readers) and the explicit casts in `list_clap_recommendations` are invisible to the client — return columns/types unchanged, and callers are already admin. No wrapper RPC, no split, no client edit.
