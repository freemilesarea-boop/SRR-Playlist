# WEB-OBS-4 — Root Cause Analysis & Rollback Advisor

Turns an incident into an answer: click a release/incident and get an automated, explainable **"why
did this happen?"** — most-likely cause, correlated evidence, release timeline, and a rollback
recommendation. Built entirely on the WEB-OBS-1/2/3 persistent RUM. **Rule-based, NO ML. Commit
CONTENT is never inspected. Additive. Preview PR only — no production merge / deploy / migration
apply.** Base = `feat/web-obs-3-predictive-regression` (PR #342).

> Assumptions flagged **(ASSUMPTION)**. Every threshold is a named constant in
> `src/lib/observability/thresholds.ts`. Below the concentration / affected-session gates the engine
> returns **INSUFFICIENT_DATA** — never a fabricated cause. **Rollback is advisory only; no rollback
> is ever performed.**

## 1. Architecture

```
runtime_telemetry_events (0454, unchanged, read-only)
  └─ 0457 admin_root_cause RPC (super_admin · param-bound · allow-list · SELECT-only)
       → candidate + baseline ERROR PROFILE (by-browser / by-kind / by-route cross-tabs, api p95,
         lcp p75, chunk/hydration/memory/long-task) + recent-release TIMELINE
         ▼
src/lib/observability/rootCause.ts  (pure, unit-tested — the analysis truth)
   analyzeRootCauses · correlateEvidence · commitCorrelation · buildTimeline · rollbackAdvisor
   · explainIncident · serviceGraph · rootCauseConfidence
         ▼
observabilityApi.ts getRootCause()  (maps RPC → engine, runs analysis client-side)
         ▼
ObservabilityDashboard "Root Cause" tab  (explanation · rollback advisor · causes · correlation
                                          · timeline · service graph)
```

The RPC is thin (indexed aggregates + cross-tabs + sample counts). **All causes, correlations,
timeline health, rollback recommendation and explanation are computed client-side** from documented
thresholds — deterministic, reproducible, auditable.

## 2. Root Cause Engine

`analyzeRootCauses(candidate, baseline)` → ranked causes, each with `score` (0..100), `confidence`,
`affectedSessions`, and `evidence`. Codes: `RELEASE_ERROR_SPIKE · CHUNK_DEPLOY · HYDRATION_MISMATCH ·
BROWSER_SPECIFIC · ROUTE_CONCENTRATION · API_LATENCY · MEMORY_PRESSURE · LONG_TASK · RUNTIME_ERROR`
(generic fallback when errors exist but nothing concentrates). A cause is surfaced only when it clears
its concentration gate (route ≥50%, browser ≥60% of error sessions) and the affected-session floor
(≥3); otherwise it does not appear, and if nothing qualifies → INSUFFICIENT_DATA.

## 3. Evidence Correlation

`correlateEvidence` → strength band per pair: `STRONG ≥0.7 · MODERATE ≥0.4 · WEAK · NONE ·
INSUFFICIENT_DATA`. Pairs: **Release↔Error, Browser↔Error, Chunk↔Release, Hydration↔Browser,
Route↔API, LongTask↔LCP, Device↔Memory** — each a rule-based concentration/ratio score over the
profile, never a learned model.

## 4. Commit Correlation (no commit content)

`commitCorrelation(timeline)` maps each **release (= build id = the Sentry release, a git SHA)** to its
error-rate change vs the previous (older) release. **The commit message / diff is never read** — the
output contains only the release id, first-seen (≈ deploy time) and the error-rate delta. The pure
type has no `message` field (asserted by a unit test).

## 5. Release Timeline

`buildTimeline(timeline)` → newest-first entries (`release · deployAt · sessions · events · errorRate
· chunkSessions · health`). Health: `unknown` (<20 events) / `critical` (chunk ≥5% or error ≥10%) /
`degraded` (error ≥3%) / `healthy`. Rendered with the commit-correlation delta column.

## 6. Rollback Advisor (recommendation only)

`rollbackAdvisor(candidate, baseline)` → `NO_ACTION / WATCH / ROLLBACK_RECOMMENDED / BLOCK_RELEASE`
with reasons drawn from Error Rate, Chunk Failure, Critical, Regression (spike vs baseline) and
Confidence. Rules: INSUFFICIENT confidence → NO_ACTION (flagged INSUFFICIENT_DATA); critical ≥2% or
chunk ≥5% → BLOCK_RELEASE; error ≥10% or a ≥2× **and** ≥5pp spike vs baseline → ROLLBACK_RECOMMENDED;
error ≥3% → WATCH; else NO_ACTION. **The advisor only displays a recommendation — it never triggers a
rollback.** (The 5pp absolute floor on the spike path is intentionally higher than the root-cause 2pp
gate so a multiple of a tiny baseline stays WATCH, not ROLLBACK.)

## 7. Incident Explanation

`explainIncident(causes, rollback, confidence)` → rule-templated Korean lines from the top causes +
overall confidence + the rollback status (with the "표시만, 실제 롤백은 수행되지 않습니다" disclaimer).
INSUFFICIENT confidence or zero causes → a single INSUFFICIENT_DATA line. No free-form guessing.

## 8. Service Dependency Graph

Static topology (`SERVICE_NODES` / `SERVICE_EDGES`: App · Player · Queue · Streaming · Admin ·
Telemetry · API · Auth · Storage · Scheduler). `serviceGraph(causes)` highlights the nodes implicated
by the surfaced causes (e.g. API_LATENCY → api+storage; route `/player` concentration → player+
streaming). **Display only — no service is changed.**

## 9. RPC — migration 0457

`admin_root_cause(window, candidate, baseline, environment)` + helper `_rc_release_profile` —
**additive, two functions**. Returns candidate+baseline error profiles (by-browser / by-kind /
by-route cross-tabs, api p95, lcp p75, chunk/hydration/memory/long-task/critical counts) + recent-
release timeline (≤30). `admin_root_cause` is SECURITY DEFINER with an `_is_super_admin()` gate,
`search_path=public`, parameter binding (no dynamic SQL), window/environment allow-lists, row caps,
aggregates only. `_rc_release_profile` is **SECURITY INVOKER** so a direct non-admin call is blocked
by the table's RLS (no privilege escalation); it only returns data when invoked inside the definer RPC
or by a super-admin. **No table/column/index/view/RLS change; 0454–0456 untouched.** Rollback =
`DROP FUNCTION` of both (SELECT-only). **Validated vs prod in a rollback transaction** (auto-select
candidate r2 / baseline r1; r2 profile: by_kind [js 60, chunk-load 10], by_route [/player 70],
by_browser [Chrome 60/80, Safari 10/64], api p95 1514ms, critical 3.7% → BLOCK_RELEASE; no prod data
changed).

## 10. Query cost

Reads through 0454's existing indexes with a `received_at >= since` lower bound; two-release scope +
≤30 timeline + capped cross-tabs. No new index. **Real production cost NOT measured** (0454–0457 not
applied; little/no data). Rollback-transaction validation ran on ~700 synthetic events in interactive
time — not a production-scale projection.

## 11. Feature flags / Kill switch

`src/lib/observability/config.ts` (all `VITE_*`, safe defaults, zero effect on collection/transport):
`VITE_OBSERVABILITY_ROOT_CAUSE_ENABLED` (Root Cause tab master), `_ROLLBACK_ADVISOR_ENABLED`,
`_TIMELINE_ENABLED`, `_CORRELATION_ENABLED`, `_SERVICE_GRAPH_ENABLED`. OFF → the section renders a
disabled notice; telemetry keeps flowing; nothing touches app boot.

## 12. Privacy

No new data stored — read-only over 0454's bucketed, PII-free rows. Surfaces aggregates, normalized
route/kind names, and release ids only. **Never surfaced:** raw events, stacks, commit messages, user
input, tokens/JWT/cookies, query strings, UA strings, or any identifier. Commit CONTENT is never
fetched — only the release id (build SHA) as a correlation key.

## 13. Tests / Manual QA

`typecheck ✓ · lint (max-warnings=0) ✓ · lint:tones ✓ · lint:migrations ✓ · test 238/238 (+22 new) ✓
· build ✓`. New unit tests: root-cause confidence, cause detection + ranking + evidence, browser-
specific identification, clean-release / RUNTIME_ERROR fallback, correlation bands + NONE, commit
correlation delta + no-message-field assertion, timeline health + unknown, rollback advisor
(BLOCK/ROLLBACK/WATCH/NO_ACTION/INSUFFICIENT), explanation templating + rollback disclaimer, service
graph highlighting. **NOT RUN (no browser/Playwright in env):** in-Preview Root Cause tab interaction —
explanation/causes/correlation/timeline/graph render, filters, auto-refresh, kill-switch flips,
responsive layout. Manual: open Admin → 런타임 텔레메트리 → 옵저버빌리티 → Root Cause; verify the
explanation, rollback advisor, ranked causes, correlation table, timeline (with Δ-vs-prev) and service
graph render, or INSUFFICIENT_DATA/NO DATA when sparse.

## 14. Bundle impact

All code in the **lazy `RuntimeTelemetryPanel` chunk: 78.2 → 96.9 KB raw (27.91 KB gzip)**, +18.7 KB.
**Boot entry unchanged: 428.36 KB / 127.05 KB gzip.** No new dependency (no chart/state/date lib).

## 15. Rollback

Code: revert the WEB-OBS-4 commits (additive; only additive tab wiring beyond the new modules). DB:
`DROP FUNCTION public.admin_root_cause(...); DROP FUNCTION public._rc_release_profile(...);` (0457 is
never applied to production this phase). No data migration to reverse.

## 16. Deferred work

- Per-incident deep-link: click an Incident card → open Root Cause pre-scoped to that release (the
  engine is release-scoped today; the Incidents tab and Root Cause tab share the same window/filters).
- Boot-recovery cause (needs the deferred boot-recovery telemetry channel).
- Persisted incident timeline / postmortem export.
- Interactive graph layout (currently a highlighted node list + edge list, not an SVG layout).
- LongTask↔LCP correlation refinement once long-task attribution-by-route is added to the RPC.
