# 04 — Auth / Session QA

## Status: BLOCKED / NOT RUN
Requires a Test-bound Preview + real browser + loginable synthetic brand account (none available). No item below is marked PASS.

## Runbook (Chrome, on a Test-bound preview)
| Scenario | Expected |
|---|---|
| First login (Supabase Auth) | session established; `[SupabaseEnv]` = `hao…qorr` |
| Refresh while playing | session restored, no re-login, no store-code flicker |
| Tab close → reopen | session restored |
| **Full browser restart** → reopen | session restored (refresh-token) — record only if a REAL restart was done, not a tab refresh |
| Access token near-expiry | auto-refresh, no interruption |
| Logout | session removed; login page |
| Multi-tab | account session synced across tabs |

Record only actually-observed results; do not infer restart PASS from a tab refresh.
