# 03 — Profile Provisioning

> No code/migration change this phase (per absolute conditions — trigger logic frozen). Verification + failure-recovery documentation.

## Trigger (from repo)
- `supabase/migrations/0021_signup_metadata_trigger.sql`: `on_auth_user_created AFTER INSERT ON auth.users → handle_new_user()`.
- `handle_new_user`: SECURITY DEFINER; inserts a `public.users` row from `raw_user_meta_data`.
- Google user: no `account_type` in metadata → default `'individual'`; `signup_completed=false`; `role` DB default (`'user'`).
- Idempotency: insert keyed on `auth.users.id` (PK) → duplicate-safe.

## Provisioning paths
| Path | Row source | Role | Notes |
|---|---|---|---|
| Email signup | trigger from `options.data` | `user` | nickname defaulted from email local-part |
| Google signup | trigger, minimal metadata | `user` | `signup_completed=false` until profile filled |
| Existing email → Google | Supabase provider identity-linking (external setting) | existing | **no client linking code** — provider-config dependent (UNVERIFIED) |

## Failure recovery (existing, confirmed — App.tsx)
- `loadProfile` uses `.maybeSingle()` → missing row = `profile=null`, not an error.
- `profile_missing` → bootstrap screen retries `loadProfile` (3× ~1.2s) then shows "가입 정보를 불러오지 못했어요" with retry/logout.
- `profile_error` (RLS/network) → error screen with retry/logout.
- 25s fetch timeout prevents infinite pending on the profile query.
⇒ No infinite spinner / blank profile: each state has a bounded wait + explicit failure path.

## Verification
| Case | Method | Result |
|---|---|---|
| New email user → row + default role | Test DB / Preview | **UNVERIFIED** (no test-DB write / auth browser this phase) |
| New Google user → row | Preview manual QA | **UNVERIFIED** |
| Existing email + Google login linking | Preview manual QA | **UNVERIFIED** (external provider setting) |
| Duplicate-profile prevention | PK insert semantics | code-PASS (idempotent by PK) |
| Refresh keeps session | `getSession` restore | code-PASS |

## Operator live check (read-only, proposed)
```sql
-- confirm the trigger + function exist on the deployed DB (read-only)
select tgname from pg_trigger where tgname = 'on_auth_user_created';
select proname from pg_proc where proname = 'handle_new_user';
```
Not executed this phase (no DB access) → **profile-trigger live existence UNVERIFIED**. If absent, new users hang at `profile_missing` — highest-priority external check.
