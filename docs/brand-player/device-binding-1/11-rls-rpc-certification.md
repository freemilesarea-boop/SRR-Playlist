# 11 — RLS / RPC Certification (Test, synthetic, rolled back)

Method: single `DO` block on Test — `set local session_replication_role = replica` (bypass FK to `auth.users`), synthetic brands + bindings with known tokens (hashed identically), JWT impersonation via `set_config('request.jwt.claims', …)`, terminal `raise exception` → **full rollback**. Only synthetic values (no real users/stores/PII).

## Results — 18/18 PASS
| Actor | Check | Result |
|---|---|---|
| Anonymous | verify / revoke / heartbeat / list | **PASS** (`not_authenticated` / `success=false` / `unauthorized`) |
| User A (owner) | verify own → ok (brand_name) | **PASS** |
| User A | verify revoked-token → `revoked` | **PASS** |
| User A | verify expired-token → `expired` | **PASS** |
| User A | verify wrong-token-for-brand → `invalid_binding` | **PASS** |
| User A | verify inactive-brand → `store_inactive` | **PASS** |
| User A | heartbeat own → success; revoked → fail | **PASS** |
| User A | `list_my_brand_devices` count = own(4) | **PASS** |
| User B | use A's token → `not_owner` | **PASS** |
| User B | heartbeat A's token → fail | **PASS** |
| User B | revoke A's token → `not_found` | **PASS** |
| User B | `list_my_brand_devices` count = own(1) | **PASS** |
| User A | self-revoke → ok; then verify → `revoked` | **PASS** |

Covers: Anonymous block, cross-user block, cross-brand block, revoked, expired, inactive brand, owner-scoped listing, self-revoke. Rollback confirmed (no synthetic data persists).

## Grants/RLS (verified)
All 4 RPCs `secdef` + `search_path` set + **no anon** + `authenticated`. `brand_player_sessions` RLS on with self-read policy; writes only via definer RPCs.
