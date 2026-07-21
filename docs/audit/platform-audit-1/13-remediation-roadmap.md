# 13 — Remediation Roadmap

> PLATFORM-AUDIT-1 · READ-ONLY. Fixes are split into future phases. No change this phase.

## Priority order (recommended)
1. **AUTH-STABILIZATION** (blocks confident go-live)
2. **PLATFORM-HOTFIX** (P1/P2 quick wins)
3. **SECURITY-HARDENING**
4. **DB-CLEANUP**
5. **PLAYER-STABILIZATION**
6. **TEST-COVERAGE**
7. **ALGORITHM-EXPERT-REVIEW**
8. **PERFORMANCE** / **DOCUMENTATION**

---

## AUTH-STABILIZATION
- **Goal:** make email + Google login reliably succeed across all origins.
- **Scope:** R-01 (pin/whitelist OAuth `redirectTo`), R-02 (verify `on_auth_user_created` on live DB + client fallback), R-15 (self-service password reset), R-05 (remove PII console.log), AUTH-R4/R5 (timeout, friendlyError).
- **Non-scope:** payment, algorithms.
- **Prereq:** access to Supabase Auth dashboard + Google Cloud console (external config).
- **Files:** `authStore.ts`, `AuthCallbackPage.tsx`, `productionRedirect.ts`, `LoginPage.tsx`, `AuthResetPasswordPage.tsx`; new signup-trigger migration if missing.
- **DB impact:** possibly re-assert `handle_new_user` trigger (additive).
- **Risk:** Medium (auth is critical path). **Rollback:** revert PR; config changes reversible in dashboard.
- **Tests:** OAuth callback e2e per origin, signup-trigger test.

## PLATFORM-HOTFIX
- **Goal:** clear runtime-breaking gaps.
- **Scope:** R-03 (reconcile 29 undefined RPCs — commit missing migrations or remove calls), R-06 (require `CRON_SECRET` on daily-metrics), R-17 (404 page), R-18 (`VITE_APP_VERSION` in `.env.example`), R-19 (gate env console.log).
- **Prereq:** live-DB introspection to classify each undefined RPC.
- **Risk:** Low–Med. **Rollback:** per-change revert.
- **Tests:** RPC-existence CI check.

## SECURITY-HARDENING
- **Scope:** R-04 (audit enterprise-contracts public window + access logs), R-07 (line-by-line RLS review on money/PII), R-08 (`set search_path` on 5 SECURITY DEFINER fns, esp. `0374`), R-09 (`/my/playlist/:id` guard/RLS), R-10 (enterprise RPC/RLS enforcement), R-14 (dep bumps).
- **Prereq:** live DB + storage access logs.
- **DB impact:** additive policy/`search_path` migrations only.
- **Risk:** Med. **Rollback:** additive → revert migration.
- **Tests:** RLS pgTAP suite, storage-policy tests.

## DB-CLEANUP
- **Scope:** R-20 — drop confirmed-dead tables (`_x6_*`, `signup_debug_events`) + deprecated python worker; decide settlement-V2 shadow rollout; document `0421-0451` void; deprecate ~13 uncalled admin RPCs after verification.
- **Prereq:** confirm 0 reads on live DB.
- **Risk:** Med (destructive). **Rollback:** keep DROP migrations reversible / backup first.
- **Tests:** post-drop smoke.

## PLAYER-STABILIZATION
- **Scope:** R-12 — extract audio-lifecycle hooks from `Player.tsx` (2970 LOC); R-22 (audit exhaustive-deps suppressions in player); verify timer/listener cleanup for 24/7 playback.
- **Risk:** High (core playback). **Rollback:** feature-flag new player path.
- **Tests:** player leak tests, brand-player e2e (wire Playwright).

## TEST-COVERAGE
- **Scope:** R-13 — add tests for auth/OAuth, player lifecycle, payment webhook, admin actions; install & wire Playwright (TEST-F2); CI-wire settlement SQL tests against a disposable branch.
- **Risk:** Low. **Rollback:** n/a.

## ALGORITHM-EXPERT-REVIEW (no code change without expert sign-off)
- **Scope:** ML-2 CLAP overfitting + prompt versioning (MIR/ML); LRN-8 invalid regression weighting + LRN-5/6 naming vs method (statistician); FIT-2/3 magic constants; ALG-F1 auto-mutating paths policy decision; ALG-F3 embedding pipeline automation (data engineer).
- **Prereq:** external experts.
- **Risk:** Do NOT alter scores/weights without validation. **Rollback:** approval-gated changes only.

## PERFORMANCE / DOCUMENTATION
- **Scope:** view-vs-MV for settlement/streaming (perf UNVERIFIED); bundle/Player render; document env matrix, cron inventory, RPC catalog, storage policy.
- **Risk:** Low.

## Cross-cutting non-scope (all phases)
No production DB/data/deploy/merge in an audit or expert-review phase; algorithm scores/weights frozen until expert sign-off; settlement logic frozen (already certified separately).
