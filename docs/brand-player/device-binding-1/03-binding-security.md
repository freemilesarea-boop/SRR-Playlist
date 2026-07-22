# 03 — Binding Security

## Two required factors
Auto-entry requires **both**:
1. a valid Supabase Auth session (`RequireAuth`), and
2. a valid Trusted Store Device Binding (`verify_brand_device_binding` → ok).
Neither alone is sufficient; a stored token never grants access on its own.

## Server checks (`verify_brand_device_binding`, and `brand_player_heartbeat`)
- `auth.uid()` present → else `not_authenticated`.
- token → sha256 → row match on `(brand_id, hash)` → else `invalid_binding`.
- `row.user_id = auth.uid()` → else `not_owner` (**cross-user blocked**).
- `revoked_at is null` → else `revoked`.
- `expires_at is null or > now()` → else `expired`.
- brand active/not-deleted → else `store_inactive`.
- success: bump `last_seen_at`; return only `{ ok, brand_name, device_label, expires_at }`.

## No sensitive exposure
Returns never include token, token hash, `user_id`, internal UUIDs (beyond what the client needs), store code, or other-brand info. Failure reasons are coarse tokens; RPC-internal errors are not surfaced.

## Grants
`revoke all from public, anon` + `grant execute to authenticated` on all binding RPCs (verified: `anon=false`, `auth=true`). Direct table access is RLS self-read only; all writes go through the definer RPCs.

## Certified (Test, synthetic, rolled back)
Anonymous blocked on all RPCs; owner ok; revoked/expired/cross-brand/inactive rejected; cross-user `not_owner` + heartbeat fail + revoke `not_found`; `list_my_brand_devices` scoped to caller; self-revoke then verify → `revoked`. See `11-rls-rpc-certification.md`.
