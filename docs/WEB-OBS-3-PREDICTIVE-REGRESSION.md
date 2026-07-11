# WEB-OBS-3 — Predictive Regression Engine & Deployment Gate

Moves observability from *watching* telemetry to *deciding* with it: before promoting a release, the
operator gets an automated, explainable verdict on **"is this release risky?"**. Built entirely on
the WEB-OBS-1/2 persistent RUM — no new data collection. **Rule-based only, NO ML.** **Additive.
Preview PR only — no production merge / deploy / migration apply.** Base = `feat/web-obs-2-observability-dashboard` (PR #341).

> Assumptions flagged **(ASSUMPTION)**. Every threshold is a named constant in
> `src/lib/observability/thresholds.ts`. A release with too little data returns **INSUFFICIENT_DATA** —
> never a fabricated PASS.

## 1. Architecture

```
runtime_telemetry_events (0454, unchanged, read-only)
  └─ 0456 admin_release_gate RPC (super_admin · param-bound · allow-list · SELECT-only)
       → candidate + baseline metric bundle (incl. api p95, browser diversity) + recent-release list
         ▼
src/lib/observability/releaseQuality.ts  (pure, unit-tested — the verdict truth)
   computeReleaseQuality · checkPerformanceBudget · checkBundleBudget · computeReleaseConfidence
   · computeDeploymentReadiness · computeReleaseGate     (+ Regression via release.ts compareReleases)
         ▼
observabilityApi.ts getReleaseGate()  (maps RPC → ReleaseSignals, runs the engine)
         ▼
ObservabilityDashboard "Release Gate" tab  (verdict · readiness · budget · regression · confidence)
```

The RPC is thin (indexed aggregates + sample counts). **All scoring, budgeting, regression
classification, confidence and the final gate verdict are computed client-side** from one shared set
of TypeScript thresholds, so every verdict is deterministic, reproducible and unit-tested.

## 2. Release Quality Score

`computeReleaseQuality(signals)` → 0..100, a weighted mean of component sub-scores
(`RELEASE_QUALITY_WEIGHTS`, sum 100): errorRate 16 · critical 16 · chunk 12 · hydration 8 · slowRoute 5
· slowApi 8 · longTask 4 · LCP 9 · INP 6 · CLS 4 · TTFB 3 · memoryRisk 3 · bootRecoveryFailure 2 ·
incidents 4. Each component maps its rate/value to 0..1 goodness against its budget; a no-data
component adds no penalty (weights renormalize). Status: `EXCELLENT ≥90 · GOOD ≥75 · RISKY ≥55 · POOR
<55 · INSUFFICIENT_DATA` (only when no component has data).

## 3. Deployment Readiness

`computeDeploymentReadiness(quality, budget, confidence)` → `READY / WATCH / BLOCKED /
INSUFFICIENT_DATA`. Rules: confidence INSUFFICIENT or quality INSUFFICIENT_DATA → INSUFFICIENT_DATA;
budget FAIL → BLOCKED; else score ≥85 READY, ≥65 WATCH, else BLOCKED.

## 4. Performance Budget

`checkPerformanceBudget(signals)` — absolute ceilings (`PERF_BUDGET`), FAIL when exceeded:
LCP p75 ≤4000ms · INP p75 ≤500ms · CLS p75 ≤0.25 · TTFB p75 ≤1800ms · **API p95 ≤1500ms** · error rate
≤5% · critical ≤1% · chunk ≤2% · hydration ≤2% · slow-api ≤20% · slow-route ≤20% · long-task ≤1/session
· memory-risk ≤10%. Vital budgets reuse the web.dev "needs-improvement" upper edge (a p75 past it is a
real regression). A null (no-data) item is `pass=null` and is not counted. Overall = INSUFFICIENT_DATA
(all null) / FAIL (any exceeded) / PASS.
**Bundle budget** (`checkBundleBudget`) is a **BUILD-TIME artifact check** (Initial JS ≤140 KB gzip,
lazy chunk ≤120 KB gzip) — measured at build, **not from telemetry**; the dashboard notes this. Live
build sizes this phase: boot entry **127.05 KB gzip (PASS)**, RuntimeTelemetry lazy chunk **22.96 KB
gzip (PASS)**.

## 5. Regression Budget

Reuses WEB-OBS-2 `compareReleases` (candidate B vs baseline A). Each metric → `IMPROVED / REGRESSED /
STABLE / INSUFFICIENT_DATA`, requiring **both** an absolute and a relative threshold in the worsening
direction; absolute **and** relative delta shown with per-side sample counts and per-metric confidence.
Zero baseline → relative null, absolute decides.

## 6. Confidence Engine

`computeReleaseConfidence(signals)` → `HIGH / MEDIUM / LOW / INSUFFICIENT` from **sessions, events and
browser diversity** (coverage): below 20 sessions or 200 events → INSUFFICIENT; ≥300 sessions **and**
≥2 browsers → HIGH; ≥80 sessions → MEDIUM; else LOW. A single-browser sample can never be HIGH.

## 7. Release Gate

`computeReleaseGate(...)` → final `PASS / PASS_WITH_WARNING / BLOCK / INSUFFICIENT_DATA` with
precedence:
1. **INSUFFICIENT_DATA** — confidence INSUFFICIENT or quality INSUFFICIENT_DATA (never guess).
2. **BLOCK** — any hard-block rule: critical-error ≥2%, chunk-failure ≥5%, error ≥10%, any budget FAIL,
   or ≥3 metrics REGRESSED at ≥MEDIUM confidence; or readiness BLOCKED.
3. **PASS_WITH_WARNING** — WATCH readiness, any strong regression, or LOW confidence.
4. **PASS** — READY, budget PASS, no meaningful regression.

Every reason (`blockingReasons` / `warnings`) carries `metric`, `threshold`, `evidence`, `code` so the
operator sees exactly *why*. Weak-sample regressions become warnings, never blocks.

## 8. Dashboard

New **Release Gate** tab in the observability dashboard: candidate/baseline context + recent-release
list, verdict headline (verdict · readiness · quality · confidence · budget), blocking reasons +
warnings, the full Performance Budget table, Release Quality component breakdown, and the Regression
Budget table. Conditional-mount; loading/empty(INSUFFICIENT_DATA·NO DATA)/error/retry/stale handled by
the shared dashboard shell.

## 9. RPC — migration 0456

`admin_release_gate(window, candidate, baseline, environment)` — **additive, one function**. Returns
the candidate + baseline metric bundle (events/sessions/browsers/first-last-seen, error/critical/chunk/
hydration counts, api count/slow/**p95**, route/slow-route/long-task, memory-risk, LCP/INP/CLS/TTFB p75
+ sample counts) and a recent-release list (≤30) for the picker; auto-selects the two most-recent
releases when unspecified. `_is_super_admin()` gate, `search_path=public`, parameter binding (no dynamic
SQL), window/environment allow-lists, aggregates only. **No table/column/index/view/RLS change; 0454/
0455 untouched.** Rollback = `DROP FUNCTION admin_release_gate` (SELECT-only, no data/schema impact).

## 10. Query cost

Reads through 0454's existing indexes with a `received_at >= since` lower bound; two-release scope +
≤30 release list. No new index. **Real production cost NOT measured** (0454–0456 not applied; little/no
data). Rollback-transaction validation ran on ~1100 synthetic events in interactive time — not a
production-scale projection.

## 11. Feature flags / Kill switch

`src/lib/observability/config.ts` (all `VITE_*`, safe defaults, zero effect on collection/transport):
`VITE_OBSERVABILITY_RELEASE_QUALITY_ENABLED` (Release Gate tab master), `_DEPLOYMENT_GATE_ENABLED`
(hide the verdict, keep quality/budget), `_PERF_BUDGET_ENABLED`, `_BUDGET_ENFORCEMENT_ENABLED` (OFF →
budget FAIL is advisory/warning, not a hard BLOCK). OFF → the section renders a disabled notice;
telemetry keeps flowing; nothing touches app boot.

## 12. Privacy

No new data stored — read-only over 0454's bucketed, PII-free rows. The gate surfaces aggregates,
budget results and normalized metric names only. Never surfaced: raw events, stacks, user input,
tokens/JWT/cookies, query strings, UA strings, or any identifier.

## 13. Tests / Manual QA

`typecheck ✓ · lint (max-warnings=0) ✓ · lint:tones ✓ · lint:migrations ✓ · test 216/216 (+27 new) ✓ ·
build ✓`. New unit tests: release quality (bands/INSUFFICIENT_DATA/no-data/bounds), performance budget
(PASS/FAIL/null/insufficient), bundle budget, confidence (HIGH/MEDIUM/LOW/INSUFFICIENT/single-browser),
deployment readiness, and the gate (PASS/INSUFFICIENT_DATA/BLOCK on critical/chunk/budget/multi-
regression/PASS_WITH_WARNING + reason evidence). **Rollback-transaction validation vs production**
(BEGIN…ROLLBACK, table+RPC+synthetic candidate/baseline, no prod data changed): auto-selected
candidate r2 / baseline r1; r2 LCP p75 3320ms, api p95 1485ms, critical 2.7%, chunk 11% → a clean BLOCK
scenario; RPC returned all signals correctly.
**NOT RUN (no browser/Playwright in env):** in-Preview Release Gate interaction — tab render, verdict/
budget/regression tables, filters, auto-refresh, kill-switch env flips, responsive layout. Manual: open
Admin → 런타임 텔레메트리 → 옵저버빌리티 → Release Gate; verify verdict + budget + regression render or
INSUFFICIENT_DATA when sparse; flip `VITE_OBSERVABILITY_DEPLOYMENT_GATE_ENABLED=false` and confirm the
verdict hides while quality/budget remain.

## 14. Bundle impact

All code in the **lazy `RuntimeTelemetryPanel` chunk: 63.4 → 78.2 KB raw (22.96 KB gzip)**, +14.8 KB
raw. **Boot entry unchanged: 428.36 KB / 127.05 KB gzip.** No new chart/state/date dependency.

## 15. Rollback

Code: revert the WEB-OBS-3 commits (additive; no existing file semantics changed beyond additive tab
wiring). DB: `DROP FUNCTION public.admin_release_gate(text,text,text,text);` (0456 is never applied to
production in this phase). No data migration to reverse.

## 16. Deferred work

- Boot-recovery telemetry channel (bootRecoveryFailureRate stays null → component skipped).
- Historical release-gate trend / persisted verdicts (would need a table + RLS).
- Automated CI/deploy hook consuming the gate verdict (this phase is operator-facing dashboard only).
- Live bundle-size wiring into the budget (currently a documented build-time check).
