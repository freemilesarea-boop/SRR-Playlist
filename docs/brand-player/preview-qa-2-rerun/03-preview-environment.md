# 03 — Preview Environment

## Status: NOT CONFIGURED (BLOCKED)
```
Preview Supabase Host: (cannot be set here)
Anon Key Pair: (cannot be set here)
Production Host Configured in Preview: N/A (no deploy)
Production Environment Changed: NO
```

## Why
- App reads `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` at build time (Vite).
- Available Vercel tools have **no env-var management**; no linked project (`.vercel/project.json` absent). `deploy_to_vercel` creates a new project from a file tree with no env injection.
- Therefore the Preview cannot be pointed at the Test pair here without risking a build with missing config or an uncontrolled-env deploy (Production-host P0).

## Correct pair (for the operator)
- `VITE_SUPABASE_URL = https://haojpuhztegecbrwqorr.supabase.co`
- `VITE_SUPABASE_ANON_KEY = <Test project anon/publishable key>` (Supabase → Project API settings; publishable — safe in client bundle). Set on **Preview** scope only; leave Production/Development unchanged.
