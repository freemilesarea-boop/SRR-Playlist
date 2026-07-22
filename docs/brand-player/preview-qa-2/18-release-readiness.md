# 18 — Release Readiness

## Completion checklist (§25)
- [x] Test project confirmed / Production isolation confirmed
- [ ] Test URL + Key pair on Preview — BLOCKED (cannot set here)
- [ ] Synthetic account/brand/store/code/tracks — BLOCKED (player backend absent from Test)
- [ ] Preview deployment READY / URL / Deployment ID / HTTP 200 — BLOCKED (no deploy)
- [ ] Auth login / first store code / binding create / refresh & tab & browser-restart auto-entry — BLOCKED (no runnable preview)
- [ ] Token server re-verification (browser) — BLOCKED (server logic already certified in prior phase)
- [ ] Logout / disconnect / store switch / tamper / revoke / expiry / cross-user / cross-brand (browser) — BLOCKED
- [ ] Chrome / Responsive / Safari / Edge QA — BLOCKED / DEFERRED
- [ ] Progress/Seek/Volume/Queue/Fullscreen/Keyboard/Touch (browser) — BLOCKED
- [ ] Brand image/video/logo/artwork/blur/fade/video-loop (browser) — BLOCKED
- [ ] Audio-duplication / queue / scheduler / crossfade / heartbeat / analytics regression (browser) — BLOCKED
- [ ] >= 30 min continuous playback — BLOCKED (0 min run)
- [x] Console secret exposure: none (no runtime run)
- [x] Production requests: none (no deploy)
- [x] Migration lint / Unit(127) PASS; Typecheck/Build carried
- [x] No Production DB change / no Production deploy

## Verdict
`BLOCKED` — the certification target (Test-bound Preview + real-browser + long-run) cannot be exercised in this environment, and Test lacks the brand player backend needed to run the flow at all. Unblock runbook: recover brand backend to Test + seed synthetic data (03) -> set Vercel Preview to Test env (02) -> run browser + long-run runbooks (04-14).
