# 11 — Synthetic Auth User

Created on Test only: `auth.users` row id `a0000000-…-000000000001`, email `qa-brand-user@test.invalid` (test-only, no PII), email-confirmed, provider=email. Password was set to a random value and is **not stored/reported**.

For the next browser-QA phase, the operator sets a known password via the Supabase **Test** dashboard (or issues a magic link) — no secret is embedded in the repo/docs. This phase certifies the runtime via JWT impersonation (SQL), so a known password is not required here.

Service-role/admin was used only on the Test project to insert the row; no credential is reported (creation status only).
