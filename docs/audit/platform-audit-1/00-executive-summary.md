# 00 — Executive Summary

> PLATFORM-AUDIT-1 · READ-ONLY platform audit of DEUDDA (듣다 / SRR-Playlist) · commit `0f3bb57` · audit branch `claude/platform-audit-1-inventory`.

## Overall assessment
DEUDDA is an **architecturally mature, unusually clean** React + Supabase platform for store music (playback, artist uploads, AI-assisted curation, brand/enterprise management, settlement, PayApp billing). Static quality is excellent: **129/129 tests pass, tsc/eslint/migration-lint/tones all clean, build OK**; ~1 `any` in all of `src`, zero `@ts-ignore`, near-zero dead code and TODO debt, broad RLS, idempotent payment webhook, deterministic + separately-certified settlement.

**However, this audit ran with no live-DB and no authenticated-browser access**, so nearly all *runtime* behaviour is `UNVERIFIED` rather than PASS, and there are real open risks (4× P1, incl. a confirmed PII-logging defect). The platform is **CONDITIONALLY CERTIFIED — RUNTIME UNVERIFIED**.

## Completeness (by evidence)
- **Frontend:** 40 pages, 41 routes, single router, 68-tab admin console; no orphan pages, no dead nav. Missing: pricing/404/maintenance pages.
- **Backend:** ~205 tables, 336 RLS policies (all sensitive tables covered), 89 triggers, 20 edge functions, 3 Vercel serverless, 1 pg_cron job, 7 storage buckets, 419 migrations.
- **Integrations:** Supabase, Vercel, **PayApp (only PG)**, Resend, Slack, Sentry, Web Push/VAPID, Kakao (toggle), FFmpeg.wasm, off-platform Modal GPU (CLAP/DSP). No Cloudflare/S3/Stripe/analytics.
- **Algorithms:** 46 mapped. Only real ML = LAION-CLAP (off-platform); everything else labeled "AI" is deterministic SQL.

## Counts
- **Top-level features:** ~65 (+46 algorithms, +68 admin sub-tabs).
- **Feature status:** PASS(executed) 0 user-facing · settlement code-PASS (tests) 3 · UNVERIFIED(code present) ~57 · PARTIAL 2 · NOT_IMPLEMENTED 1 (Kakao messaging 501) · DEAD/shadow 1 (settlement V2) · FAIL 0 reproduced.
- **Risks:** **P0 0** (none reproduced; runtime unverifiable) · **P1 4** · **P2 12** · **P3 6** · **P4 1**.
- **Dead/deprecated candidates:** 3 confirmed-dead tables + 1 deprecated worker; settlement-V2 shadow set (pending rollout); 29 undefined client RPCs + ~13 uncalled admin RPCs to verify.
- **Tests:** 13 files — 7 runnable (129 cases PASS), 3 e2e (Playwright uninstalled, non-runnable), 3 SQL (need Test DB).

## Immediate attention (must-fix before production certification)
1. **R-01 (P1)** Google OAuth `redirectTo` = dynamic origin → whitelist/pin to canonical.
2. **R-02 (P1)** Verify `on_auth_user_created` profile trigger on live DB (else new users hang).
3. **R-03 (P1)** 29 client RPC calls have no committed definition → runtime `PGRST202` risk.
4. **R-04 (P1)** `enterprise-contracts` bucket had a public-read window (`0383`→`0394`) → audit for leakage.
5. **R-05 (P2, CONFIRMED)** Signup email + payload logged to browser console (`authStore.ts:226/239`).
6. **R-06 (P2)** daily-metrics cron unauthenticated if `CRON_SECRET` unset (calls service_role RPCs).

## Production risk
- Highest user-facing risk = **Google login reliability** (external-config dependent).
- Highest data risk = **enterprise-contract exposure window** (confirmed) + **PII console log** (confirmed).
- Highest stability risk = **Player.tsx** God component on the 24/7 playback path (untested).

## Algorithm expert-review scope
- **ML/MIR (highest):** CLAP zero-shot classifiers (self-documented overfitting, unversioned prompts, un-automated ingestion).
- **Statistician:** LRN-8 regression weighting (statistically invalid), LRN-5/6 mislabeled "clustering/prediction", magic-constant fit scores.
- **Data engineer:** automate CLAP pipeline; add algorithm tests.
- **Royalty:** settlement already covered (frozen, tested).

## Recommended next phase
**AUTH-STABILIZATION** — resolve R-01/R-02/R-05 (+ self-service reset), because Google/email login reliability is the top user-facing risk and gates every downstream journey. Follow with **PLATFORM-HOTFIX** (R-03/R-06) and **SECURITY-HARDENING** (R-04/R-07/R-08).

## Guarantees
No Production change, no DB/SQL/migration execution, no deploy/merge, no algorithm/settlement logic change. No secrets or PII emitted (variable names + booleans only). All outputs on audit branch `claude/platform-audit-1-inventory`.
