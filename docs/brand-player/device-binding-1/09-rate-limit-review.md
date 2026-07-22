# 09 — Rate Limit Review

## Finding
`verify_store_code` has **no evident rate-limiting / brute-force defense** in its RPC body. Store codes are `enterprise_accounts.store_invite_code`; the function requires an authenticated caller and only resolves codes that map to the caller's reachable enterprise→brand, which limits blast radius but does not throttle guessing.

## This phase
Adding a full attempt-throttling infrastructure (attempt table / edge rate-limit / IP+user lockout) is out of scope here and is recorded as a **P1 risk** (`14-risk-register.md`), not silently passed.

## Recommended (follow-up)
- An `rpc_attempts`-style table or edge-function limiter keyed by `auth.uid()` (+ optional IP), with a short lockout after N failures.
- Reuse any existing repository throttling pattern rather than inventing a new one.

We do **not** report READY as if brute-force were solved; the device-binding hardening (owner/revoke/expiry) is independent of and complementary to this.
