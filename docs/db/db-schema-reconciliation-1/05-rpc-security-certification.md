# 05 — RPC Security Certification

> Machine-readable: `rpc-security-results.json`. Heuristics computed in-DB over `pg_get_functiondef` (booleans only; source never printed).

## Positive
- **All 31: `SECURITY DEFINER` + `SET search_path=public`** → search-path injection smell absent.
- **Owner:** postgres (consistent).
- **Destructive/write functions guarded:** admin/role check + `auth.uid()` + `raise` detected on all writes incl. destructive `admin_hard_delete_track`, `admin_purge_all_tracks`, `bulk_delete_severe_mismatches`, and all inquiry/notice/settings/prediction writes → **PASS**.
- **User-scoped reads** (`create_support_inquiry`, `list_my_inquiries`, `get_my_inquiry_detail`) use `auth.uid()` → **PASS**.
- **Public reads** (`get_site_settings`, `list_active_site_notices`) granted `anon`, return only public/active data → **intended, PASS**.

## FINDING — over-exposed admin readers (P2, live in Production)
10 SECURITY DEFINER **reader** functions are granted to `authenticated` with **no in-function admin role check detected** (and SECURITY DEFINER bypasses RLS) → **any logged-in user can read admin data**:
`get_admin_track_detail`, `list_admin_tracks_with_ai`, `admin_list_site_notices`, `ai_correction_stats`, `ai_predictions_summary`, `list_pending_ai_predictions`, `list_severe_metadata_mismatches`, `list_clap_recommendations`, `list_clap_auto_approved`, `list_clap_curation_playlists`.
- **Data:** internal operational (track admin detail incl. review statuses, AI predictions, CLAP curation, full notice list). **No PII/money** → **P2**.
- **Not changed this phase** (read-only). Fix = add admin/role gate OR restrict EXECUTE grant (revoke authenticated) during RPC-MIGRATION-RECOVERY / RPC-SECURITY-HARDENING.

## Data-exposure review (Return types)
- `admin_list_support_inquiries` returns `contact_email`, `contact_phone` — **but is admin-guarded** (role check + auth.uid) → acceptable; consider masking in future.
- No settlement/payment/RRN/account columns in any of the 31 return types (`touches_money_or_pii` true only for `admin_hard_delete_track`, which is admin-guarded and destructive-by-design).

## Execute-grant summary
- 29/31 → `{authenticated, service_role}` (+ postgres owner).
- 2/31 (`get_site_settings`, `list_active_site_notices`) → `{anon, authenticated, service_role}` (public, intended).
- **No PUBLIC-default (unrestricted) grants** found. No `anon` on any write/admin-mutating function.
