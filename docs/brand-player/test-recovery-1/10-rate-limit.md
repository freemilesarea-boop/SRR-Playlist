# 10 — Rate Limit

verify_store_code now enforces a minimal brute-force guard:
- `brand_store_code_attempts(user_id, success, attempted_at)` records each attempt.
- `_brand_store_code_rate_limited()` = ≥5 failed attempts for `auth.uid()` in the last 10 minutes.
- On limit → returns `{success:false, error:"rate_limited"}` before any lookup.
- Successful and failed attempts are both recorded; only failures count toward the limit.

Certified: 5 wrong codes → 6th call returns `rate_limited` (synthetic user, rolled back). Keyed by auth.uid() (authenticated-only RPC). IP-based limiting is deferred (P2) — auth.uid() keying is sufficient since the RPC is authenticated-only.
