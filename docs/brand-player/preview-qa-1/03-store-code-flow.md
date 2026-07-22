# 03 — Store Code Flow

## Components
- `src/pages/BrandPage.tsx` — store-code input (`/brand`). Uppercased, `maxLength=40`, `autoComplete="off"`.
- `verifyStoreCode(code)` → `supabase.rpc('verify_store_code', { p_store_code })` (`src/lib/api/brandPlayerApi.ts:14`).

## `verify_store_code(p_store_code)` (migration 0407)
`SECURITY DEFINER`, `search_path = public, extensions`, **granted to `authenticated` only** (revoked from public/anon).
1. Reject empty code.
2. Find `enterprise_accounts` by `store_invite_code` (not deleted) → else `invalid_code`.
3. Find linked active `brand_accounts` (enterprise_account_id, status='active') → else `brand_not_linked` (no fallback).
4. Generate token = `gen_random_bytes(24)` hex; hash = sha256(token).
5. Insert `brand_player_sessions (brand_id, enterprise_account_id, session_token_hash, user_id=auth.uid(), last_seen_at)`.
6. Audit `brand.verify_store_ok`.
7. Return `{ success, brand_id, store_label, session_token (plaintext, once), expires_at = now()+30d }`.

## Error handling (already safe)
Failure returns coarse reasons (`invalid_code`, `brand_not_linked`) mapped to safe Korean messages in `STORE_VERIFY_ERROR_MESSAGES`. It does **not** reveal "code exists but belongs to another brand" — a wrong-brand code simply doesn't resolve to the user's enterprise.

## Post-success (current client)
`saveBrandToken(brand_id, token)` (sessionStorage) + `pushRecentBrand({id,name})` + navigate `/brand/player/:brandId`. The plaintext code is dropped after submit; input state reset on navigation.

## Notes for hardening
- `expires_at` is returned but **not persisted/enforced** in the row today (no column). The additive migration adds `expires_at` and a strict re-verify RPC; `verify_store_code` should also set `expires_at` when the row is created (do this on Test after inspecting its current body).
- Rate-limiting / brute-force defense on `verify_store_code` is not evident in the RPC; recommend adding attempt throttling (per user/IP) in the hardening phase.
