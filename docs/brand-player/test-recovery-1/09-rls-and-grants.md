# 09 — RLS & Grants

## RLS (new tables)
brand_media_assets, brand_music_policies, brand_signage_settings, brand_audit_logs, brand_store_code_attempts — RLS **enabled**, policy `<t>_admin_read` (users.role=admin) for direct read; otherwise default-deny. All runtime access is via SECURITY DEFINER RPCs. brand_player_sessions keeps its 0454 self-read policy.

## Function grants (verified on Test)
| Function | secdef | search_path | anon | authenticated |
|---|---|---|---|---|
| verify_store_code | yes | yes | no | yes |
| get_brand_player_config | yes | yes | no | yes |
| _brand_generate_playlist | yes | yes | no | no (internal) |
| _brand_signage_json | yes | yes | no | no (internal) |
| _brand_audit | yes | yes | no | no (internal) |
| _brand_store_code_rate_limited | yes | yes | no | no (internal) |

No public execute; no anon; helpers callable only in definer context.
