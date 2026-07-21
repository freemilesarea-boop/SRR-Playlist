# 02 — RPC Call Traceability

> For each undefined-RPC cluster: User/Job → Route → Component → Hook/Service → RPC → (missing) → error path. All wrappers `throw` on error; components' try/catch → `friendlyError` → now maps PGRST202 to a safe message (no infinite spinner, no name leak).

## support (Tier A) — `src/lib/supportInquiryApi.ts`
User `/support` (public/member) & `/admin` inquiries tab → SupportPage / admin panel → supportInquiryApi → `create_support_inquiry` / `list_my_inquiries` / `get_my_inquiry_detail` / `admin_*`. Missing → wrapper throws → UI shows "요청하신 기능을 현재 사용할 수 없습니다…". **User-facing support submission is the highest-impact if genuinely absent → verify first.**

## notices (Tier B) — `src/lib/siteNoticesApi.ts`
Admin notices tab + public active-notice banner → `list_active_site_notices` (public), `admin_list/upsert/toggle/delete_site_notice`. Missing → banner/admin list shows error/empty; no crash.

## settings (Tier B) — `src/lib/siteSettingsApi.ts`
Admin settings → `get_site_settings` / `admin_update_site_settings`.

## track-AI (Tier B) — `src/lib/trackAiPredictionsApi.ts`
Admin AI-predictions tab → `ai_predictions_summary`, `list_pending_ai_predictions`, `apply_track_ai_predictions`, `bulk_apply_high_confidence_ai_predictions`. Apply = admin-gated write over AI predictions (algorithm itself unchanged this phase).

## admin-track (Tier B) — `src/lib/adminTrackApi.ts`
Admin track management → `get_admin_track_detail`, `list_admin_tracks_with_ai`, `ai_correction_stats`, `list_severe_metadata_mismatches`, `admin_update_track_metadata_full`, and destructive `admin_hard_delete_track` / `admin_purge_all_tracks` / `bulk_delete_severe_mismatches`. Destructive ones: if absent they fail closed (PGRST202); if present-remote, auth/RLS must be verified in reconciliation.

## clap-curation (Tier C) — `src/lib/clapCurationApi.ts`
CLAP curation admin (superOnly) → `list_clap_recommendations`, `list_clap_auto_approved`, `list_clap_curation_playlists`, `set_playlist_auto_attach`, `rollback_clap_auto_attach`.

## Runtime-safety verification
- All 6 wrappers: `if (error) throw error` (verified counts: 4/9/4/8/7/1) → errors propagate.
- `friendlyError` now catches PGRST202/42883 → safe message; no infinite loading (25s Supabase fetch timeout also bounds pending); empty arrays are not mistaken for success on the missing-function path (it's an error, not `[]`).
