# 09 — Cron Deployment Gate

> Machine-readable: `cron-deployment-gate.json`.

PLATFORM-HOTFIX-1 made `api/cron/daily-metrics.ts` **fail-closed**: 503 if `CRON_SECRET` is unset. So the hotfix must not merge to Production until the secret is set, or the daily metrics + trial-expiry cron will stop (503).

| Item | Status |
|---|---|
| Production `CRON_SECRET` | **UNVERIFIED** — no Vercel env read access from this environment |
| Preview `CRON_SECRET` | **UNVERIFIED** |
| Caller secret (Vercel Cron auto-Bearer) | present only if env var set |
| Header format | `Authorization: Bearer <secret>` or `x-cron-secret: <secret>` |
| Rotation | operator-managed (Vercel env) |

**Gate status: BLOCKED_UNVERIFIED.**

## Operator action (before merging PLATFORM-HOTFIX-1)
1. Confirm/set `CRON_SECRET` in Vercel **Production** and **Preview** env.
2. Deploy; verify `/api/cron/daily-metrics` and `/api/cron/enterprise-ops` return **200** (not 503/401/403) on the scheduled Vercel-Cron call.
3. Only then merge the hotfix. (Secret value never to be pasted into any report.)
