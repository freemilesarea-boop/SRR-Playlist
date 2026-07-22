# 04 — Device Binding Design

## Decision order (per phase §5)
- **Option A (reuse existing)** → chosen. `brand_player_sessions` already models Brand + Store(enterprise) + Authenticated User + hashed token. We reuse it and add revocation/expiry/label + strict re-verify. **No new binding table.**
- Option B (server session / HttpOnly cookie) — not adopted; the app has no server session tier; Supabase Auth already provides the account session.
- Option C (design from scratch) — unnecessary.

## Logical model
```
Brand User (auth.uid)  +  Brand (brand_accounts)  +  Store (enterprise_accounts)  +  Browser (token hash)
                                   → brand_player_sessions row
```

## Fields (existing + additive from 0454)
- existing: `id, brand_id, session_token_hash, user_id, enterprise_account_id, current_track_id, last_seen_at, playback_started_at, user_agent, created_at`
- additive: `revoked_at, revoked_by, expires_at, device_label`

## Server verification (additive RPC `verify_brand_device_binding`)
Given `(brand_id, token)`:
- `auth.uid()` present, else `not_authenticated`.
- token → sha256 → row match on `(brand_id, hash)`, else `invalid_binding`.
- `row.user_id = auth.uid()`, else `not_owner`.
- `revoked_at is null`, else `revoked`.
- `expires_at is null or > now()`, else `expired`.
- brand active/not-deleted, else `store_inactive`.
- On success: bump `last_seen_at`; return **only** `{ ok, brand_name, device_label, expires_at }` (no UUIDs/token/hash).

## Client stored reference (design)
`localStorage: srr.brand.binding.<brandId> = { token, storeLabel, deviceLabel, ts }`
- `token` is the opaque, hashed-server-side, revocable, user-bound, expiring device token — an allowed "server-reverified device token" (phase §7). No plaintext store code, no Supabase access token, no UUIDs.
- The stored value alone **never** grants access: on app start the client calls `verify_brand_device_binding` (server re-check) before auto-entry.

## Device label
Coarse `"Chrome · macOS"` style derived from UA (no fingerprinting), optionally user-named (e.g. "왕십리점 카운터"). The label is **not** an auth factor.

## Revocation
- Self: `revoke_brand_device_by_token(brand_id, token)` sets `revoked_at/revoked_by` for the caller's own row.
- Admin (others): deferred to a follow-up phase (per §14 — self-revoke first). `list_my_brand_devices()` lists the caller's own devices for a minimal management view.
