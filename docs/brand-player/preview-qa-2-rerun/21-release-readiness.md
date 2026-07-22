# 21 — Release Readiness

## Completion (§26) — status
- [x] Test backend ready (brands/stores/tracks/media/RPCs; runtime 19/19)
- [x] Test/Production isolation; Test URL known
- [ ] Test user browser-login password — NOT SET (operator; 02)
- [ ] Preview Test URL + anon key pair — BLOCKED (no env-var control; 03)
- [ ] Preview deploy / URL / Deployment ID / HTTP 200 — BLOCKED (04)
- [ ] Login / first code / binding / config / 15-queue / media / heartbeat (browser) — BLOCKED
- [ ] Refresh / Tab-restart / **Browser-restart** auto-entry — BLOCKED
- [ ] Logout / disconnect / store-switch (browser) — BLOCKED
- [ ] Tamper / revoke / expiry / cross-user / cross-brand (browser) — BLOCKED (server 19/19 done)
- [ ] Player controls / visual / multi-tab (browser) — BLOCKED
- [ ] Chrome matrix / Safari / Edge — BLOCKED / DEFERRED
- [ ] >= 30 min long-run — BLOCKED (0 min)
- [x] Migration lint / Unit 127 PASS; Typecheck/ESLint/Build carried
- [x] No Production DB change / no Production deploy / no secret / no PII

## Verdict
`BLOCKED` — Test backend is ready and SQL-certified, but Preview env binding + real-browser QA + long-run cannot be performed in this environment. Operator runbook (00 + 02/03/04) is short now: set QA password → set Preview Test env → deploy → run browser + long-run runbooks. This is genuinely a human-operator + real-browser certification.
