# 02 — Preview Deployment

## Status: NOT DEPLOYED (BLOCKED)
```
Preview URL:        none
Deployment ID:      none
Branch:             claude/brand-player-preview-qa-2
Commit:             (this branch head)
Supabase Environment: (not bound to Test — cannot verify)
HTTP Status:        n/a
```

## Reasons
- The Vercel Preview environment variables (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`) cannot be set to the **Test** pair here; they are operator-controlled and the Test anon key is not available in this environment.
- Deploying with the project's current env risks the Preview pointing at the **Production** host (`nso…zvol`) — the phase marks a Production host request as **P0** and requires immediate stop — so no deploy was performed.

## Operator runbook (to deploy safely)
1. In the Vercel project, create/confirm a **Preview** scope env with:
   - `VITE_SUPABASE_URL = https://haojpuhztegecbrwqorr.supabase.co`
   - `VITE_SUPABASE_ANON_KEY = <Test project anon key>` (Test pair)
2. Deploy branch `claude/brand-player-preview-qa-2` as a Preview.
3. Open the Preview, check the `[SupabaseEnv]` console line shows `projectRef: haojpuhztegecbrwqorr` and **never** `nsoesrvwkxqifjcxzvol`.
4. Record Preview URL + Deployment ID here. If any request hits `nso…zvol.supabase.co`, stop immediately.

## Prerequisite before a useful deploy
The Test project must first have the **brand player backend** recovered (see `01`/`03`); otherwise the deployed preview cannot log a user into a working brand player.
