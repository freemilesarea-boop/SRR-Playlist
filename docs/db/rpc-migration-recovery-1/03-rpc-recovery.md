# 03 — RPC Recovery

| RPC | Cluster | Local before | Test after | Production | Security fix | Result |
|---|---|---|---|---|---|---|
| get_site_settings | A | ✗ | ✓ | ✓ | public reader (anon) | DONE |
| list_active_site_notices | A | ✗ | ✓ | ✓ | public reader (anon) | DONE |
| admin_list_site_notices | A | ✗ | ✓ | ✓ | **FIXED (added admin guard)** | DONE |
| admin_upsert_site_notice | A | ✗ | ✓ | ✓ | already guarded | DONE |
| admin_toggle_site_notice | A | ✗ | ✓ | ✓ | already guarded | DONE |
| admin_delete_site_notice | A | ✗ | ✓ | ✓ | already guarded | DONE |
| admin_update_site_settings | A | ✗ | ✓ | ✓ | already guarded | DONE |
| create_support_inquiry, list_my_inquiries, get_my_inquiry_detail, admin_list_support_inquiries, admin_get_support_inquiry_detail, admin_support_inquiry_summary, admin_update_inquiry | B | ✗ | pending | ✓ | admin-guarded; PII-return keep gated | PREPARED |
| ai_predictions_summary*, list_pending_ai_predictions*, apply_track_ai_predictions, bulk_apply_high_confidence_ai_predictions | C | ✗ | pending | ✓ | *=needs fix | PREPARED |
| get_admin_track_detail*, list_admin_tracks_with_ai*, ai_correction_stats*, list_severe_metadata_mismatches*, admin_update_track_metadata_full, admin_hard_delete_track, admin_purge_all_tracks, bulk_delete_severe_mismatches | D | ✗ | pending | ✓ | *=needs fix | PREPARED |
| list_clap_recommendations*, list_clap_auto_approved*, list_clap_curation_playlists*, set_playlist_auto_attach, rollback_clap_auto_attach | E | ✗ | pending | ✓ | *=needs fix | PREPARED |

`*` = over-exposed reader requiring the admin-guard security fix. Machine-readable: `production-rpc-definitions.json`, `rpc-recovery` in `migration-manifest.json`.
