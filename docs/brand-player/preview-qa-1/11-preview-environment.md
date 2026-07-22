# 11 — Preview Environment

## Status: BLOCKED (not deployed)
A Test-bound Preview could not be provisioned in this environment. Reporting honestly:
- **Preview URL:** none (not deployed).
- **Deployment ID:** none.
- **Supabase environment:** must be the **Test** project — not verified because no deploy was made.
- **Production isolation:** cannot be asserted without a deploy; this phase made **no** deploy and **no** Production change.

## Why blocked
- Vercel Preview env vars (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`) are operator-controlled; binding them to the Test project is an operator action.
- A meaningful auth QA also needs a **seeded Test brand/enterprise account** + **synthetic store code** (creating `auth.users` + enterprise/brand rows needs service-role/admin seeding on Test).

## Operator runbook (to unblock)
1. Create a Vercel Preview build of `claude/brand-player-preview-qa-1` (after the server hardening is applied+certified on Test).
2. Set Preview env to the **Test** Supabase project URL + anon key. Confirm `[SupabaseEnv]` log shows the Test `projectRef` (never the Production ref).
3. Seed on Test only: one enterprise account (with `auth_user_id` = a test brand user), one active brand linked to it, one `store_invite_code` (synthetic). No real PII.
4. Record the Preview URL + Deployment ID here.
5. **If the Preview points at the Production DB, stop immediately** and re-point to Test before any QA.

## Guardrails
No real user data, no Production secrets, no Production DB connection. Synthetic store + synthetic code only.
