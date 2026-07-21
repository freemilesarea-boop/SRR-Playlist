# 05 — Cron Security

> Machine-readable: `cron-endpoints.json`. Shared helper: `api/_lib/cronAuth.ts`.

## daily-metrics — HARDENED (H-02)
- **Before:** `if (secret) { check }` — CRON_SECRET unset ⇒ **auth skipped**, endpoint ran unauthenticated and called service_role RPCs (`expire_free_trials`, `admin_compute_daily_metrics`). Fail-open.
- **After:** `verifyCronAuth(req)` fail-closed:
  - CRON_SECRET unset/blank → **503 CONFIGURATION_ERROR** (never runs unauthenticated)
  - no `Authorization`/`x-cron-secret` → **401 UNAUTHORIZED**
  - mismatch → **403 FORBIDDEN**
  - Constant-time comparison; secret never logged or echoed.

## Other cron/scheduled endpoints (already compliant — documented, unchanged)
| Endpoint | Auth | Status |
|---|---|---|
| enterprise-ops.ts | CRON_SECRET required (fail-closed) | ALREADY_COMPLIANT |
| admin/enterprise-ops-run.ts | admin token + role + 60s debounce (attaches secret server-side) | COMPLIANT |
| check-audio-health | admin JWT OR x-cron-secret | COMPLIANT |
| process-scheduled-releases | admin JWT OR x-cron-secret | COMPLIANT |
| dispatch-trial-reminders | x-cron-secret OR service_role JWT | COMPLIANT |
| dispatch-admin-notifications | admin JWT OR x-cron-secret | COMPLIANT |

## Policy checklist (verified)
1. Prod without CRON_SECRET → does not start (503). ✓
2. No header → 401. ✓
3. Wrong secret → 403. ✓
4. Empty provided secret not accepted (401). ✓
5. Secret value never logged. ✓
6. External request cannot reach service_role RPC without valid secret. ✓
7. Idempotency: downstream RPCs already idempotent (expire/compute/reminders) — unchanged. ✓ (documented)
8. Replay: bounded by cron cadence; secret-gated. Documented.

## Tests
`api/_lib/cronAuth.test.ts` — 503/401/403/ok (Bearer + x-cron-secret), empty-secret rejection, timing-safe compare, no-leak error response. 7 cases PASS.
