# 02 — Test Auth Readiness

Synthetic user `qa-brand-user@test.invalid` exists on Test (id a0000000-…-000000000001, email-confirmed). Its password was randomized on creation and is **not** stored/reported.

```
Test Auth Login Credential: NOT SET (password must be set by operator on the Test dashboard)
Password Exposed: NO
```

I did not set a browser-login password because: (a) it must not be stored/reported, and (b) verifying it requires the browser QA I cannot run. Operator step: Test Supabase dashboard → Auth → set a password for this user (Test only). → then browser QA can log in.

Status: **BLOCKED on browser login** until the operator sets the password.
