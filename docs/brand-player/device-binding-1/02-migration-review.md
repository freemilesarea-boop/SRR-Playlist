# 02 — Migration Review (`0454`)

## Made idempotent & self-sufficient
Because Test lacks the brand subsystem entirely, `0454` bootstraps a minimal schema without harming Production:
- `create table if not exists enterprise_accounts / brand_accounts / brand_player_sessions` — **no-op on Production** (tables exist), bootstraps Test. The full `brand_player_sessions` create includes the 4 new columns.
- `alter table ... add column if not exists revoked_at/revoked_by/expires_at/device_label` — adds on Production (table pre-existed without them), no-op on Test.
- Indexes: `idx_brand_sessions_token`, partial `idx_brand_sessions_user_active (user_id, brand_id) where revoked_at is null`.
- RLS enabled + `brand_sessions_self_read` (`user_id = auth.uid()`).
- RPCs: `verify_brand_device_binding`, `revoke_brand_device_by_token`, `list_my_brand_devices`, hardened `brand_player_heartbeat`.

## Review checklist
| Item | Result |
|---|---|
| Migration number collision (repo) | none new (lint PASS; `0068/0214/0388` legacy allowlisted) |
| Duplicate table/column | none — reuses `brand_player_sessions`; columns `if not exists` |
| Naming convention | matches existing (`brand_*`, snake_case) |
| Nullable/default | new columns nullable (safe backfill: existing rows → null = non-expiring/non-revoked) |
| Existing-row backfill | null-safe; `expires_at is null` treated as valid until set by (future) `verify_store_code` hardening |
| Lock risk | `add column` (nullable, no default) = metadata-only, no rewrite; function replace = brief |
| FK | `brand_id→brand_accounts` CASCADE; `user_id/revoked_by→auth.users` SET NULL |
| RPC signature collision | new names unique; `brand_player_heartbeat` replaced with identical signature |
| Existing call-site compat | `brand_player_heartbeat` return shape unchanged (`{success}`) |
| Grants/Revoke | `revoke ... from public, anon` + `grant ... to authenticated` on all 4 |
| SECURITY DEFINER + search_path | all set (verified on Test) |
| Anonymous execution | blocked (verified: `anon=false`) |

## Not rewritten (intentional)
`verify_store_code` (depends on `_brand_audit`) and `get_brand_player_config` (depends on media/policy/signage/playlist subsystems absent from Test) are **not** blind-rewritten. Their binding-guard hardening (set `expires_at`; enforce owner/revoke/expiry) is documented for the Production-apply phase after inspecting their live bodies. The auto-entry security is enforced by `verify_brand_device_binding` + hardened `brand_player_heartbeat`, which carry the identical checks.
