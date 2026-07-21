# 01 — RPC Master Registry (31 undefined-local)

> Machine-readable: `rpc-master-registry.json`, `rpc-call-sites.json`. All: Local **MISSING**, Git-history **NONE**, Remote **UNVERIFIED_REMOTE**, Decision **DOCUMENT_REMOTE_ONLY + DEFER**.

| ID | RPC | Domain | Call site | Tier | Kind | Destructive |
|---|---|---|---|---|---|---|
| RPC-001 | admin_delete_site_notice | notices | siteNoticesApi.ts | B | write | yes |
| RPC-002 | admin_get_support_inquiry_detail | support | supportInquiryApi.ts | A | read | — |
| RPC-003 | admin_hard_delete_track | admin-track | adminTrackApi.ts | B | write | **yes** |
| RPC-004 | admin_list_site_notices | notices | siteNoticesApi.ts | B | read | — |
| RPC-005 | admin_list_support_inquiries | support | supportInquiryApi.ts | A | read | — |
| RPC-006 | admin_purge_all_tracks | admin-track | adminTrackApi.ts | B | write | **yes** |
| RPC-007 | admin_support_inquiry_summary | support | supportInquiryApi.ts | A | read | — |
| RPC-008 | admin_toggle_site_notice | notices | siteNoticesApi.ts | B | write | — |
| RPC-009 | admin_update_inquiry | support | supportInquiryApi.ts | A | write | — |
| RPC-010 | admin_update_site_settings | settings | siteSettingsApi.ts | B | write | — |
| RPC-011 | admin_update_track_metadata_full | admin-track | adminTrackApi.ts | B | write | — |
| RPC-012 | admin_upsert_site_notice | notices | siteNoticesApi.ts | B | write | — |
| RPC-013 | ai_correction_stats | admin-track | adminTrackApi.ts | B | read | — |
| RPC-014 | ai_predictions_summary | ai-ops | trackAiPredictionsApi.ts | B | read | — |
| RPC-015 | apply_track_ai_predictions | ai-ops | trackAiPredictionsApi.ts | B | write | — |
| RPC-016 | bulk_apply_high_confidence_ai_predictions | ai-ops | trackAiPredictionsApi.ts | B | write | — |
| RPC-017 | bulk_delete_severe_mismatches | admin-track | adminTrackApi.ts | B | write | **yes** |
| RPC-018 | create_support_inquiry | support | supportInquiryApi.ts | **A** | write | — |
| RPC-019 | get_admin_track_detail | admin-track | adminTrackApi.ts | B | read | — |
| RPC-020 | get_my_inquiry_detail | support | supportInquiryApi.ts | A | read | — |
| RPC-021 | get_site_settings | settings | siteSettingsApi.ts | B | read | — |
| RPC-022 | list_active_site_notices | notices | siteNoticesApi.ts | B | read | — |
| RPC-023 | list_admin_tracks_with_ai | admin-track | adminTrackApi.ts | B | read | — |
| RPC-024 | list_clap_auto_approved | clap-curation | clapCurationApi.ts | C | read | — |
| RPC-025 | list_clap_curation_playlists | clap-curation | clapCurationApi.ts | C | read | — |
| RPC-026 | list_clap_recommendations | clap-curation | clapCurationApi.ts | C | read | — |
| RPC-027 | list_my_inquiries | support | supportInquiryApi.ts | A | read | — |
| RPC-028 | list_pending_ai_predictions | ai-ops | trackAiPredictionsApi.ts | B | read | — |
| RPC-029 | list_severe_metadata_mismatches | admin-track | adminTrackApi.ts | B | read | — |
| RPC-030 | rollback_clap_auto_attach | clap-curation | clapCurationApi.ts | C | write | yes |
| RPC-031 | set_playlist_auto_attach | clap-curation | clapCurationApi.ts | C | write | — |

## Tier summary
- **Tier A (critical runtime):** support-inquiry family (7) — user-facing support submission/read + admin triage.
- **Tier B (active operational):** notices (5), settings (2), track-AI (4), admin-track (8).
- **Tier C (non-critical/legacy):** CLAP curation (5).
- **Tier D (dead):** none — all reach live UI.

## Resolution
No RPC has a confirmed past definition or a safe contract to reconstruct, and remote existence is unverifiable → **all 31 = DOCUMENT_REMOTE_ONLY + DEFER**. Runtime protected by PGRST202 mapping; regressions blocked by `lint:rpc`.
