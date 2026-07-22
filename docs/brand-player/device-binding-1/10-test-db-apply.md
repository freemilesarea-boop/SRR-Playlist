# 10 — Test DB Apply

## Environment certification (before any write)
`list_projects` →
- **Test:** `haojpuhztegecbrwqorr` — "SRR Playlist **Test**", ap-southeast-1, created 2026-07-20.
- **Production:** `nsoesrvwkxqifjcxzvol` — "SRR Playlist", ap-southeast-1.
Distinct refs, hosts, names → **isolated**. All `apply_migration`/`execute_sql` writes targeted Test only. Production accessed read-only for metadata (function/table defs), no rows.

## Pre-apply state (Test)
Test migration history: settlement `0454/0455`, recovery `0457–0461`. **No brand subsystem** — `brand_player_sessions`, `brand_accounts`, `enterprise_accounts`, and the brand RPCs were all absent (Production-only drift). Hence `0454` was made self-sufficient (bootstrap + additive).

## Applied
`apply_migration(project_id=haojpuhztegecbrwqorr, name=0454_brand_device_binding_hardening, ...)` → success.

## Post-apply verification (Test)
- `brand_player_sessions`: 14 columns incl. `revoked_at/revoked_by/expires_at/device_label`; RLS enabled; policy `brand_sessions_self_read`.
- Functions `verify_brand_device_binding / revoke_brand_device_by_token / list_my_brand_devices / brand_player_heartbeat`: `secdef=true`, `search_path` set, **anon=false**, auth=true.
- Indexes `idx_brand_sessions_token`, `idx_brand_sessions_user_active` present.

## Production
**No Production apply.** `verify_store_code`/`get_brand_player_config` guard-prepend + `expires_at` on creation are staged for the Production-apply phase (inspect live bodies first).
