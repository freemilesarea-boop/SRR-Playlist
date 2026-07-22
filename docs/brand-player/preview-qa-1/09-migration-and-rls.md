# 09 — Migration & RLS

## File
`supabase/migrations/0454_brand_device_binding_hardening.sql` — **committed, NOT applied to any database** (Test access was declined this phase; Production forbidden).

## What it does (additive, drift-safe)
- `ALTER TABLE public.brand_player_sessions ADD COLUMN IF NOT EXISTS revoked_at / revoked_by / expires_at / device_label`.
- Partial index `(user_id, brand_id) WHERE revoked_at IS NULL`.
- New RPCs (all `SECURITY DEFINER`, `search_path` pinned, `revoke ... from public, anon`, `grant execute to authenticated`):
  - `verify_brand_device_binding(brand_id, token)` — owner + not-revoked + not-expired + active-brand; returns only non-sensitive display fields.
  - `revoke_brand_device_by_token(brand_id, token)` — self-revoke (own row only).
  - `list_my_brand_devices()` — caller's own devices, display fields only.

## What it intentionally does NOT do
- It does **not** `create or replace` `verify_store_code` or `get_brand_player_config`. Their latest bodies (the table has drifted since 0407 — e.g. `enterprise_account_id` was added) must be inspected on Test first, then patched to (a) set `expires_at` on creation and (b) enforce `user_id = auth.uid()` + revocation + expiry. Blind-rewriting them risks reverting later logic.
- It does not create a new binding table (reuses `brand_player_sessions`).

## RLS
`brand_player_sessions` is accessed via `SECURITY DEFINER` RPCs. If direct-table RLS is desired for `list_my_brand_devices` as an invoker query, add a self-read policy (`user_id = auth.uid()`) + admin-read policy; the current design keeps access RPC-mediated (definer) which is equivalent and simpler.

## Certification plan (run on Test only, when DB access is available)
1. `apply_migration` to Test (`hao…qorr`).
2. Verify columns/index/functions exist; grants show `authenticated` only, no anon; `search_path` set; secdef true.
3. Synthetic, auto-rolled-back SQL tests (same method as prior DB phases):
   - anon → all 3 RPCs blocked.
   - user A binding: `verify_brand_device_binding` ok; user B token → `not_owner`; revoked → `revoked`; expired → `expired`; wrong brand → `invalid_binding`; inactive brand → `store_inactive`.
   - `revoke_brand_device_by_token` revokes own row only; other user's row → `not_found`.
   - `list_my_brand_devices` returns only the caller's rows, no token/hash/UUID.
4. Then patch `verify_store_code`/`get_brand_player_config` on Test and re-certify.

## Production
No Production apply this phase. A separate production-apply phase (after browser certification) is required.
