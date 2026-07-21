# 06 — Test Matrix

> Executed this phase: tsc, eslint (src+api), vitest 85/85, build, lint:rpc.

| Feature/RPC area | Unit | SQL | Integration | Preview | Result | Evidence |
|---|---|---|---|---|---|---|
| Cron fail-closed auth (503/401/403/ok) | ✅ | — | — | ☐ | PASS | `api/_lib/cronAuth.test.ts` (7) |
| Undefined-function error mapping (PGRST202/42883) | ✅ | — | — | ☐ | PASS | `src/lib/errorMessages.test.ts` (6) |
| RPC registry guard (no new undefined) | ✅ (script) | — | — | — | PASS | `npm run lint:rpc` (31 allowlisted, 0 new) |
| 31 undefined RPCs runtime behaviour | — | — | — | ☐ | UNVERIFIED_REMOTE | needs live DB / Preview |
| daily-metrics end-to-end cron | — | — | — | ☐ | UNVERIFIED | needs deployed env + secret |
| Destructive admin-track RPCs | — | ☐ | — | ☐ | UNVERIFIED_REMOTE | reconciliation + Test DB |

## Safe-to-run classification
- New unit tests: **Safe Local / Safe CI** (node; no network/DB).
- RPC registry lint: **Safe Local / Safe CI**.
- SQL tests for restored RPCs: **N/A this phase** (no RPC restored).
- Preview/live RPC verification: **Requires Preview + accounts** (not run headlessly).

## Note
No SQL tests were added because no RPC was restored (all deferred). When reconciliation restores an RPC, add the role/input/IDOR/idempotency/PII SQL tests per `04-rpc-security-review.md`.
