# BRAND-PLAYER-PREVIEW-QA-2-RERUN — Executive Summary

> Branch `claude/brand-player-preview-qa-2-rerun` from `claude/brand-test-recovery-1` (`602dc6b`).
> **Status: `BLOCKED`.** No source change, no deploy, no Production change, no Test DB mutation this phase.

> **Operator follow-up (after operator configured Preview env + Test password):** see [`22-operator-followup-results.md`](./22-operator-followup-results.md). A Test-bound Playwright/Chromium harness was built and run locally, but this session's **egress policy denies the browser's connection to the Test Supabase host** (`403` at the agent proxy — logged, not routed around), so the in-browser login/data/player flow cannot execute here. **Verified regardless:** the client attempts **only** the Test host with **zero** Production-host attempts (isolation P0 holds), and the backend is re-certified ready (brands 2 / stores 2 / media A=4,B=0 / tracks 15 / playlist 15 / 6 RPCs / QA auth+profile ready). All in-browser runtime items are `OPERATOR_REQUIRED`; none marked PASS. **Follow-up status: `BLOCKED`.**

## What changed since the previous BLOCKED (PREVIEW-QA-2)
The Test backend is now **ready** (BRAND-TEST-RECOVERY-1): the full brand player flow runs on Test and was SQL-certified 19/19. Re-verified this phase — brands 2, stores 2, tracks 15, media 4, `_brand_generate_playlist` → 15, QA auth user present, `verify_store_code`+`get_brand_player_config` present. So the **backend blocker is removed**.

## Why still BLOCKED
The remaining blockers are environmental and match the phase's own stop-triggers:
1. **No Vercel env-var control.** The available Vercel tools (`list_projects`/`get_project`/`deploy_to_vercel`) include **no environment-variable management**, and no Vercel project is linked (`.vercel/project.json` absent). I cannot set the user's **Preview-scoped** `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` to the Test pair. `deploy_to_vercel` only creates a *new* project from a file tree with no env injection → a Vite build would have no Supabase config (or require embedding the key, which the phase forbids). → "Preview 환경변수 설정 권한 없음".
2. **No real browsers.** I cannot run real Chrome-desktop across resolutions, Safari, or Edge; cannot perform a genuine full-browser-restart distinct from a tab refresh across the matrix; cannot run a true 30 min–2 hr long-run; cannot do DevTools audio-instance / memory / listener-trend inspection. → "실제 Browser 실행 불가", and per the phase, unverified browser / restart / long-run items must **not** be marked PASS.
3. **Browser-login password.** Setting the QA user's password and then using it requires completing the browser QA I cannot run; and the password must not be stored/reported.

No Preview was deployed (deploying with uncontrolled env risks hitting the Production host `nso…zvol` — a P0). No browser/long-run item is marked PASS.

## Certified / ready (verifiable here)
- Environment isolation: Test `haojpuhztegecbrwqorr` (`https://haojpuhztegecbrwqorr.supabase.co`) vs Production `nsoesrvwkxqifjcxzvol` — isolated.
- Backend runtime + security: already applied + certified on Test (0454 + 0455; 19/19 synthetic). Seed persists.
- Gates on this branch: Migration lint ✅, Unit 127 ✅, Typecheck/ESLint/Build carried (no source changed).

## Operator runbook (now short — backend is ready)
1. Test dashboard → set a password for `qa-brand-user@test.invalid` (Test only; don't share/store insecurely).
2. Vercel project → **Preview** env: `VITE_SUPABASE_URL=https://haojpuhztegecbrwqorr.supabase.co`, `VITE_SUPABASE_ANON_KEY=<Test anon key>` (retrievable via Supabase → API settings; publishable). Do **not** change Production/Development scopes.
3. Deploy branch `claude/brand-player-preview-qa-2-rerun` as a Preview; confirm `[SupabaseEnv]` shows `hao…qorr`, never `nso…zvol`.
4. Run the browser + long-run runbooks (docs 06–20), recording only actually-observed results. Synthetic store codes are in `supabase/seed/brand_player_synthetic_test.sql`.

## Verdict
`BLOCKED` — backend ready, but Preview env control + real-browser + long-run QA cannot run in this environment. Precise, now-short unblock runbook provided.
