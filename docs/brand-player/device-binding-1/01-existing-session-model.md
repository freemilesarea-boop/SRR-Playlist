# 01 — Existing Session Model

## Auth
Supabase Auth (`persistSession` + `autoRefreshToken` + `detectSessionInUrl`, `src/lib/supabase.ts`). Brand routes behind `<RequireAuth>` (waits on `isAuthReady`, no flicker). "Brand account" = authenticated enterprise/HQ user (`enterprise_accounts.auth_user_id`).

## Store code → binding (pre-existing)
`verify_store_code(p_store_code)` (authenticated-only, SECURITY DEFINER):
- resolves `enterprise_accounts.store_invite_code` → linked active `brand_accounts`,
- issues `gen_random_bytes(24)` token, stores **sha256 hash** in `brand_player_sessions (brand_id, enterprise_account_id, session_token_hash, user_id=auth.uid(), last_seen_at)`,
- returns the plaintext token once + `expires_at = now()+30d` (returned, previously not enforced).

## `brand_player_sessions` (Production, pre-hardening)
`id, brand_id, session_token_hash, user_id, current_track_id, last_seen_at, playback_started_at, user_agent, created_at, enterprise_account_id`. No revoked/expires columns.

## Gaps (fixed this phase)
- `get_brand_player_config` / `brand_player_heartbeat` validated the token hash but **not `user_id = auth.uid()`**, and had no revoke/expiry checks.
- Client stored the token in `sessionStorage` → lost on browser restart → store code re-entered.

## Test environment reality
Test (`hao…qorr`) had **none** of the brand subsystem (tables/RPCs) — Production-only drift. This phase bootstraps the minimal brand schema on Test to certify the binding security (see `02`, `10`, `11`).
