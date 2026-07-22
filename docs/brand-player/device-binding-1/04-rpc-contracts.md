# 04 — RPC Contracts

All `SECURITY DEFINER`, `search_path = public[, extensions]`, `authenticated`-only.

## `verify_brand_device_binding(p_brand_id uuid, p_session_token text) → jsonb`
`{ ok: true, brand_name, device_label, expires_at }` or `{ ok: false, reason }` where reason ∈ `not_authenticated | no_binding | invalid_binding | not_owner | revoked | expired | store_inactive`.

## `revoke_brand_device_by_token(p_brand_id uuid, p_session_token text) → jsonb`
`{ ok: true }` on self-revoke; `{ ok:false, reason: not_authenticated|no_binding|not_found }`. Only the caller's own, non-revoked row is affected.

## `list_my_brand_devices() → table(device_label, brand_name, last_seen_at, created_at, expires_at, revoked)`
Caller's own devices only; no token/hash/UUID/store code.

## `brand_player_heartbeat(p_brand_id uuid, p_session_token text, p_current_track_id uuid, p_user_agent text) → jsonb`
`{ success: boolean }`. Return shape unchanged from before; now updates `last_seen_at`/`current_track_id`/`playback_started_at`/`user_agent` **only** when owner + not-revoked + not-expired.

## Client wrappers (`src/lib/api/brandPlayerApi.ts`)
`verifyBrandDeviceBinding`, `revokeBrandDeviceByToken`, `listMyBrandDevices` added; `brandPlayerHeartbeat` unchanged signature.

## Deferred (Production-apply phase)
`get_brand_player_config` gets the same binding guard prepended (owner + revoke + expiry) after its live body is inspected; `verify_store_code` sets `expires_at`/`device_label` on creation. On Test the equivalent security is proven via the RPCs above.
