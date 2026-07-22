# 02 — RPC Remote Inventory

> Machine-readable: `rpc-remote-inventory.json`. Test = ABSENT for all; Production = PRESENT for all; Repository = MISSING for all → **PRODUCTION_ONLY**.

| RPC | Prod signature | Return | SecDef | search_path | Execute grants | Kind |
|---|---|---|---|---|---|---|
| admin_delete_site_notice | p_id uuid | void | ✓ | public | authenticated, service_role | write |
| admin_get_support_inquiry_detail | p_inquiry_id uuid | jsonb | ✓ | public | authenticated, service_role | read |
| admin_hard_delete_track | p_track_id uuid | TABLE | ✓ | public | authenticated, service_role | write⚠destructive |
| admin_list_site_notices | () | SETOF site_notices | ✓ | public | authenticated, service_role | read⚠over-exposed |
| admin_list_support_inquiries | p_status…p_limit (6) | TABLE (incl contact_email/phone) | ✓ | public | authenticated, service_role | read (admin-guarded) |
| admin_purge_all_tracks | p_confirm text | TABLE | ✓ | public | authenticated, service_role | write⚠destructive |
| admin_support_inquiry_summary | p_days int | jsonb | ✓ | public | authenticated, service_role | read |
| admin_toggle_site_notice | p_id uuid, p_active bool | void | ✓ | public | authenticated, service_role | write |
| admin_update_inquiry | p_inquiry_id…(5) | jsonb | ✓ | public | authenticated, service_role | write |
| admin_update_site_settings | (4) | site_settings | ✓ | public | authenticated, service_role | write |
| admin_update_track_metadata_full | p_track_id + 26 | void | ✓ | public | authenticated, service_role | write |
| admin_upsert_site_notice | p_id + 9 | site_notices | ✓ | public | authenticated, service_role | write |
| ai_correction_stats | () | TABLE | ✓ | public | authenticated, service_role | read⚠over-exposed |
| ai_predictions_summary | () | TABLE | ✓ | public | authenticated, service_role | read⚠over-exposed |
| apply_track_ai_predictions | (5) | void | ✓ | public | authenticated, service_role | write |
| bulk_apply_high_confidence_ai_predictions | (2) | integer | ✓ | public | authenticated, service_role | write |
| bulk_delete_severe_mismatches | (2) | TABLE | ✓ | public | authenticated, service_role | write⚠destructive |
| create_support_inquiry | (10) | jsonb | ✓ | public | authenticated, service_role | write (auth.uid) |
| get_admin_track_detail | p_track_id uuid | TABLE(large) | ✓ | public | authenticated, service_role | read⚠over-exposed |
| get_my_inquiry_detail | p_inquiry_id uuid | jsonb | ✓ | public | authenticated, service_role | read (auth.uid) |
| get_site_settings | () | site_settings | ✓ | public | **anon**, authenticated, service_role | read (public) |
| list_active_site_notices | () | TABLE | ✓ | public | **anon**, authenticated, service_role | read (public) |
| list_admin_tracks_with_ai | p_limit int | TABLE | ✓ | public | authenticated, service_role | read⚠over-exposed |
| list_clap_auto_approved | p_limit int | TABLE | ✓ | public | authenticated, service_role | read⚠over-exposed |
| list_clap_curation_playlists | () | TABLE | ✓ | public | authenticated, service_role | read⚠over-exposed |
| list_clap_recommendations | (2) | TABLE | ✓ | public | authenticated, service_role | read⚠over-exposed |
| list_my_inquiries | p_limit int | TABLE | ✓ | public | authenticated, service_role | read (auth.uid) |
| list_pending_ai_predictions | p_limit int | TABLE | ✓ | public | authenticated, service_role | read⚠over-exposed |
| list_severe_metadata_mismatches | p_limit int | TABLE | ✓ | public | authenticated, service_role | read⚠over-exposed |
| rollback_clap_auto_attach | p_recommendation_id uuid | void | ✓ | public | authenticated, service_role | write |
| set_playlist_auto_attach | (3) | void | ✓ | public | authenticated, service_role | write |

All: Test **ABSENT**, Production **PRESENT**, Repository **MISSING**. Source hashes captured in the raw metadata query (not reproduced here).
