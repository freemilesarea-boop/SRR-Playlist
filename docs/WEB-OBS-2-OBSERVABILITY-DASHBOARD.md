# WEB-OBS-2 — Observability Dashboard, Release Comparison & Incident Detection

Turns the persistent RUM store built in WEB-OBS-1 (`runtime_telemetry_events`, migration 0454) into
**operational answers**: Health Score, release regression, route/API risk ranking, error fingerprint
groups, browser anomalies and incident candidates. **Additive only. Preview PR only — no production
merge / deploy / migration apply.** Base = `feat/web-obs-1-runtime-telemetry-pipeline` (PR #340).

> Assumptions are flagged **(ASSUMPTION)**. Every threshold is a named constant in
> `src/lib/observability/thresholds.ts` — nothing downstream hard-codes a magic number.

## 1. Architecture

```
runtime_telemetry_events (WEB-OBS-1, 0454)               ← unchanged; read-only source
  └─ 0455 security-definer RPCs (super_admin gate, param-bound, allow-list filters)
       admin_observability_overview        → totals · vitals p50/75/95 · slow routes/apis · long tasks
       admin_observability_release_compare → per-release metric bundle (rate + percentile + sample n)
       admin_observability_errors          → error occurrences + by-browser summary
         │  (server returns ONLY low-cost aggregates + sample counts — no raw payloads)
         ▼
src/lib/observability/*  (pure, unit-tested — the single source of verdict truth)
  health · release · fingerprint · spike · risk · incident · thresholds · math · config
         ▼
src/lib/api/observabilityApi.ts  (composes RPC output through the pure logic)
         ▼
src/components/admin/ObservabilityDashboard.tsx  (Overview/Releases/Routes/APIs/Errors/Devices/Incidents)
  mounted as a 3rd mode ("옵저버빌리티") inside RuntimeTelemetryPanel, next to 현재 세션 / 서버 히스토리
```

**Why split server vs client?** The RPCs stay thin (indexed aggregates only, cheap to run and to
review for SQL safety); all judgement — Health Score, regression classification, confidence,
fingerprint hashing, incident rules, risk scoring — lives in TypeScript where it is unit-tested
against one shared set of thresholds. No dynamic SQL, no business rules baked into plpgsql.

**Failure isolation.** The dashboard is inside the lazy admin chunk. Each RPC is awaited with
`Promise.allSettled` so one failing widget never blanks the rest; a total failure renders an inline
error+retry card. It never reaches the global ErrorBoundary or the boot path. Auto-refresh is opt-in,
tab-visible only, and **stops after 3 consecutive failures** (no infinite retry).

## 2. Dashboard IA

`Overview · Releases · Routes · APIs · Errors · Devices · Incidents` (+ the existing `현재 세션` /
`서버 히스토리` views are untouched). Tabs mount conditionally — only the active tab renders its
heavy table. Loading / empty / error / retry / stale + last-updated are handled centrally.

## 3. Health Score

`computeHealth()` — 0..100, a **weighted mean of component sub-scores** (`HEALTH_WEIGHTS`, sum 100):
error rate 22 · critical 18 · chunk 12 · hydration 8 · slow-api 10 · slow-route 6 · long-task 5 ·
LCP 8 · INP 5 · CLS 3 · boot-recovery-failure 3. Each component maps a measured rate/value to a
0..1 badness against a documented budget; **a component with no data adds no penalty** (weights
renormalize over present components). Status bands: `HEALTHY ≥90 · WATCH ≥75 · DEGRADED ≥50 ·
CRITICAL <50`, with **hard floors** so a live storm can't read HEALTHY (critical-error ≥2% caps at
DEGRADED; chunk-failure ≥5% forces CRITICAL). Below `MIN_EVENTS_FOR_SCORE (50)` /
`MIN_SESSIONS_FOR_SCORE (5)` → `INSUFFICIENT_DATA` (no score shown). **Health Score is an operational
prioritization signal, NOT an SLA/uptime guarantee** — 100 means "no problem signal this window", not
"no incident possible".

## 4. Release Comparison

`compareMetric()` classifies each metric A→B as `IMPROVED / REGRESSED / STABLE / INSUFFICIENT_DATA`.
A change counts only when it clears **BOTH** an absolute floor (noise guard) **AND** a relative floor
(scale guard) in the worsening/improving direction — a single outlier or sub-threshold wiggle stays
STABLE. Absolute value **and** relative % are both shown, with per-side sample counts. Zero baseline:
relative is `null` (never a fabricated ∞%) and the absolute floor alone decides. `Confidence` =
`HIGH ≥500 · MEDIUM ≥100 · LOW ≥30 · INSUFFICIENT <30`, by the **smaller** of the two sample counts.
Per-metric thresholds live in `METRIC_SPECS` **(ASSUMPTION**, chosen near the web.dev good/ni band
widths): LCP ±300ms/15%, INP ±50ms/15%, CLS ±0.02/15%, TTFB ±150ms/15%, rates ±0.5pp/20%. Releases
auto-select the two most-recent-traffic builds when A/B aren't specified.

## 5. Incident Rules (candidates, not alerts)

`buildIncidents()` — rule-based, explainable, **no ML** (out of scope). Types: `ERROR_SPIKE ·
CRITICAL_ERROR · CHUNK_FAILURE_SPIKE · HYDRATION_ERROR_SPIKE · ROUTE_REGRESSION · API_REGRESSION ·
WEB_VITAL_REGRESSION · LONG_TASK_SPIKE · MEMORY_RISK · BOOT_RECOVERY_FAILURE ·
BROWSER_SPECIFIC_FAILURE · RELEASE_SPECIFIC_FAILURE`. Each candidate records `threshold`,
`baselineValue`/`currentValue`/`delta`, `evidence`, `affectedSessions` and a `suggestedAction`.
Spike detection (`detectSpike`) requires **enough current samples AND enough affected sessions AND**
both a relative and absolute increase; zero baseline is handled explicitly; a single-event increase is
never a spike. **No persistence** — candidates are recomputed per load (a table would add write paths
+ RLS surface for no operator benefit this phase; see §14). Auto-notify (Slack/email) is out of scope.

## 6. Error Fingerprinting

The stored payload carries only `{ kind, sanitized message }` — **no stack, no top frame** (WEB-OBS-1
schema), message already PII-redacted at capture. `normalizeErrorMessage()` collapses the remaining
volatile tokens (numbers, hex, urls, paths, quoted literals) to a stable template.
`fingerprintError()` = non-reversible **FNV-1a** hash of `groupClass | normalizedMessage | route` —
**release excluded from identity** so one defect is comparable across releases (release tracked as a
group dimension). `classifyErrorGroup()` pulls **chunk** (`chunk-load` kind / ChunkLoadError text) and
**hydration** (`hydrat` / "did not match" / React #418/#423/#425) out of the generic `react`/`runtime`
buckets — distinct causes, distinct fixes. Raw stacks are never rendered.

## 7. Boot Recovery — **observe-only, NO DATA this phase**

WEB-OPT-2 Boot Recovery is **not modified** (reload conditions, retry counts, chunk-recovery, Service
Worker all untouched — hard constraint). WEB-OBS-1 has **no dedicated boot-recovery event type**, and
adding one would require altering the 0454 `event_type` CHECK (not permitted). Therefore the dashboard
observes recovery **only** through the existing signal it already has — **chunk-load error sessions**
(a proxy for chunk-recovery pressure, shown in Overview + Incidents) — and reports **recovery success
rate as NO DATA**. The health component and the `BOOT_RECOVERY_FAILURE` incident are wired but stay
dormant until a boot-recovery telemetry channel is added (deferred, §14). This is the honest, zero-risk
choice; the spec explicitly permits `NO DATA` when the emit channel is absent.

## 8. Web Vitals

Overview shows server **p50 / p75 / p95 + sample count + rating** per vital; Releases compares vitals
A vs B with regression classification. Budgets are constants (`VITAL_GOOD_MAX`/`VITAL_NI_MAX`,
mirroring web.dev). CLS/INP are labelled **session approximations** (the collector's session algorithm
differs from the official web-vitals library) — not presented as the canonical metric.
**Time-bucketed sparkline trend is deferred** (§14): it needs a 4th time-bucket RPC and, on a 30d
window, a real query-cost review — building a fake trend from thin samples is explicitly disallowed.

## 9. Route / API Risk Ranking

`routeRiskScore` / `apiRiskScore` — published 0..100 formulas → `P0..P3 / INSUFFICIENT_DATA`.
Route: latency 35 · errorRate 35 · longTask 10 · reach 10 · regression 10.
API: latency 30 · failure 30 · timeout+network 15 · reach 10 · regression 15.
**Reach uses distinct sessions on a log scale** so a chatty-but-healthy endpoint never outranks a
rare-but-broken one — volume alone does not drive risk. Thin samples get a confidence haircut and can
never reach P0 (`< MIN_SAMPLES_FOR_METRIC (30)` → INSUFFICIENT_DATA).

## 10. Browser / Device Analysis

`browserAnomalies()` flags a browser whose error rate materially exceeds the fleet average (≥2× and
≥2%), gated for sample size (≥30 events, ≥3 sessions) — small groups are never called incidents. UA
strings are never surfaced; only bucketed `browser_family` + counts.

## 11. Query Cost

RPCs read only through 0454's existing indexes (`received_at desc`, `release|route|browser|type +
received_at`, partial vital index) with a `received_at >= since` lower bound and fixed row caps
(top-20 lists, ≤300 error rows). No new index is added (existing ones cover the access paths; adding
per-column indexes was explicitly avoided). **Real production query cost is NOT measured** — 0454/0455
are not applied to prod and there is little/no data yet. The rollback-transaction validation (§13) ran
on ~840 synthetic events and returned in interactive time; that is **not** a production-scale
projection. If volume grows, a partial `(event_type, received_at) where event_type='error'` index is
the first candidate — deferred until a real query plan justifies it.

## 12. Migration 0455

`supabase/migrations/0455_runtime_observability_rpcs.sql` — **additive, functions only**: one immutable
helper (`_obs_window_interval`) + three security-definer RPCs. No table/column/index/view/RLS change;
0454 is not touched. Every RPC: `_is_super_admin()` gate, `search_path = public`, parameter binding
(no dynamic SQL string), window/environment/event-type **allow-lists**, fixed row limits, aggregates +
sanitized fields only. **Rollback** = pure `DROP FUNCTION` of the four new objects (SELECT-only, no
data/schema impact) — block at the bottom of the file.

## 13. Manual QA & Verification

Run (all green): `typecheck · lint (max-warnings=0) · lint:tones · lint:migrations · test (189, +39
new) · build`. **Rollback-transaction validation vs production** (`BEGIN … ROLLBACK`, new table +
functions + synthetic scenarios, no prod data changed): healthy release r1 (LCP p75 1890ms) vs slower
release r2 (LCP p75 3290ms, +73 errors, 8 chunk-fail Safari sessions, 5 hydration, 4 memory-risk) →
overview/release-compare/errors RPCs all returned correct aggregates; Safari surfaced at 100% error
rate. **NOT RUN (no browser/Playwright/live-fetch in this env):** in-Preview dashboard interaction —
tab switching, filters, auto-refresh lifecycle, stale badge, kill-switch env flips, mobile/tablet
layout. Manual steps: open Admin → 런타임 텔레메트리 → 옵저버빌리티; verify each tab loads/empties/errors
+ retry; toggle 자동 ON and confirm 60s tab-visible polling + cleanup on unmount; set
`VITE_OBSERVABILITY_ENABLED=false` and confirm the disabled notice with collection unaffected.

## 14. Feature Flags / Kill Switch

`src/lib/observability/config.ts`, all `VITE_*`, safe defaults, **zero effect on collection/transport**:
`VITE_OBSERVABILITY_ENABLED` (master), `_INCIDENTS_ENABLED`, `_RELEASE_COMPARE_ENABLED`,
`_AUTO_REFRESH_ENABLED`, `_AUTO_REFRESH_MS` (15s–600s), `_MIN_SESSIONS`, `_MIN_SAMPLES`. OFF → the tab
renders a disabled notice; telemetry keeps flowing; nothing touches app boot.

## 15. Privacy

No new data is stored — analysis is read-only over 0454's already-bucketed, PII-free rows. The
dashboard shows aggregates + normalized (non-reversible-hashed) error templates only. Never surfaced:
raw stacks, raw messages beyond the sanitized template, query strings, UA strings, tokens/JWT/cookies,
user input, or any identifier.

## 16. Deferred Work

- Dedicated **boot-recovery telemetry channel** (new event type / emit from the recovery path) → real
  recovery success-rate + `BOOT_RECOVERY_FAILURE` incidents. Requires a schema+migration change beyond
  this phase's additive scope.
- **Time-bucketed Web Vitals trend** (sparkline) → needs a 4th time-bucket RPC + 30d query-cost review.
- **Incident persistence / ack** (status beyond `candidate`) → new table + RLS; only if operators need
  cross-load state.
- Per-fingerprint **error spike baselines** from a prior-period query (the incident rule already
  accepts a baseline map; not yet wired to a 2nd RPC call).
- Partial error index — pending a real production query plan.
