# 04 — Security Corrections

## Canonical admin guard (repo-verified, not guessed)
`if not exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin') then raise exception 'unauthorized'; end if;`
— identical to existing admin functions + RLS policies in Production.

## Over-exposed readers (10) — SECURITY DEFINER granted to `authenticated`, no in-function admin check
`admin_list_site_notices` (✅ FIXED, Cluster A), `ai_correction_stats`, `ai_predictions_summary`, `get_admin_track_detail`, `list_admin_tracks_with_ai`, `list_clap_recommendations`, `list_clap_auto_approved`, `list_clap_curation_playlists`, `list_pending_ai_predictions`, `list_severe_metadata_mismatches` (9 planned, clusters C/D/E).

Fix pattern: keep signature/return; if `language sql` → convert to `plpgsql` with `return query`; prepend the admin guard. (Grant stays `authenticated` because admins connect as the `authenticated` Postgres role — the guard, not the grant, enforces admin.)

## Other controls (applied in 0457, standard for all clusters)
- **Grants:** `revoke all ... from public`; public readers → `anon, authenticated`; admin/user → `authenticated`. No PUBLIC-default execute. `service_role` bypasses grants (server-only).
- **SECURITY DEFINER + `search_path=public`:** kept on all (verified) → no search-path injection.
- **IDOR / ownership:** user-scoped functions use `auth.uid()` (create/list/get my inquiry); RLS policies self-or-admin.
- **PII:** `support_inquiries` returns `contact_email/phone` only via admin-guarded functions (Cluster B) — keep gated; masking recommended later.
- **Write validation:** upsert/update functions validate non-empty title/body and use `auth.uid()` as actor.
