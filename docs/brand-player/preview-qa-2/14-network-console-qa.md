# 14 — Network / Console QA

## Status: BLOCKED / NOT RUN
Runbook (on Test-bound preview):
- Network: every Supabase request host = `haojpuhztegecbrwqorr.supabase.co`; ZERO requests to `nsoesrvwkxqifjcxzvol.supabase.co` (Production host = immediate stop). No unexpected 401/403/404/409/500; no infinite retry / repeated signed-URL storms.
- Console: no React/unhandled-promise/auth/storage/fullscreen/media/seek/binding errors; and NO token / store code / PII printed. Any secret/token visible = P0.
