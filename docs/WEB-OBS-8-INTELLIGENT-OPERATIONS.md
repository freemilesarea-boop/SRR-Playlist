# WEB-OBS-8 — Intelligent Operations & Predictive Streaming Analytics

Extends the streaming-quality layer (WEB-OBS-7) into an **operations-intelligence** layer: instead of
just observing quality, it lets an operator **predict**, **root-cause**, gauge **impact** and set
**priority** in one place — all **rule-based / statistical, NO ML, NO LLM**. Everything is **observation +
analysis ONLY.** Nothing is executed: no auto playback control, no auto Reload / Rollback / Release-block,
no remote Player control, no notifications. Additive. Preview PR only — no production merge / deploy /
migration apply. Base = `feat/web-obs-7-streaming-quality-intelligence` (PR #346).

> This phase adds **zero** client/Player emit. It is pure analysis + a long-term warehouse + a dashboard
> over the telemetry WEB-OBS-7 already emits. Player / Queue / Playback / Crossfade / Recovery /
> Scheduler / Audio Output are **untouched**. Every engine degrades to NO_DATA / NOT_AVAILABLE /
> INSUFFICIENT_DATA rather than fabricating.

## 1. Non-negotiable safety contract

- **No client/Player change at all.** No file under `src/components/player/`, `src/hooks/` audio paths,
  the queue, crossfade, recovery, scheduler or audio output is modified. `git diff` for this phase
  touches only new `src/lib/streamingOps/*`, a new `src/lib/api/streamingOpsApi.ts`, two exported symbols
  in the existing `streamingQualityApi.ts`, a new admin dashboard, an AdminPage tab wiring, a new
  migration, and docs. `playback_events_v2` and `streaming_quality_events` semantics are unchanged
  (read-only).
- **No remote control / no automation.** The predictive warning, release risk and advisor emit *labels
  and recommendations only*, each stamped `requiresApproval:true`, `automated:false`,
  `remoteControl:false` (asserted by tests). No code path performs a Reload, Rollback, Release-block or
  remote Player action.
- **Rule-based, not a model.** A "prediction" is a **rule-derived likelihood band** from multiple
  signals trending worse at once — not a probability from a trained model. Root-cause "confidence" is a
  rule score from how complete the observed evidence chain is, **capped below 100** (the browser can
  never fully prove causation).
- **No fabricated numbers.** currentTime progress ≠ speaker output → TTFA stays **TTFA_APPROX**. A small
  sample can never assert a release risk, a regression, a prediction or a browser/device-wide failure —
  below the sample floors the engines return INSUFFICIENT_DATA. Event count ≠ affected sessions ≠
  affected stores; Store ≠ Session.
- **Server-verified attribution & privacy.** All RPCs are super-admin gated (`_is_super_admin()`),
  security-definer, `set search_path = public`, parameter-bound (no dynamic SQL), window allow-listed
  (`_obs_window_interval`) and row/bucket-capped. Replay rows are PII-free (event type + hash + numeric
  codes; no track title / URL / user id / UA / token).

## 2. Architecture

```
streaming_quality_events (0460, READ-ONLY) + playback_events_v2 (READ-ONLY) + franchise_stores→franchises (READ-ONLY)
         ▼   0461 security-definer RPCs (super-admin · param-bound · SELECT + one write: the rollup warehouse)
  _sqe_agg_scope · admin_streaming_quality_matrix / _timeseries / _replay / _fleet_replay / _enterprise
  rollup_streaming_quality (hour/day) · purge_streaming_quality_rollup (tiered retention)
         ▼   src/lib/streamingOps/*  (pure, rule-based engines — the verdict truth)
  reliability · coverage · matrix · heatmap(release/enterprise) · trend · predictive(warning/release-risk/progressive) · replay · rootCause
         ▼   streamingOpsApi.ts  (maps RPC rows → engines, client-side; reuses WEB-OBS-7 rowToAggregate)
         ▼   Admin "운영 인텔리전스" tab (OperationsDashboardV2 — READ-ONLY, no control buttons)
```

## 3. Engines (`src/lib/streamingOps/`, 21 unit tests)

| Engine | Feature(s) | Honest degradation |
| --- | --- | --- |
| `reliability.ts` | **Streaming Reliability Index** (0–100) + sub-components (Availability, Start, Transition, Recovery, Media, Continuity, Buffering) | NOT_AVAILABLE sub-components dropped + weights renormalize; INSUFFICIENT_DATA below confidence |
| `coverage.ts` | **Quality Coverage** (per-signal observed share) | crossfade/preload NONE in business mode |
| `matrix.ts` | **Browser / Device Matrix** + concentration flag | thin cell → INSUFFICIENT_DATA; only observed dimension values appear |
| `heatmap.ts` | **Release Heatmap** (score/Δ/regression/incidents/affected stores) + **Enterprise Heatmap** (brand→store) | enterprise NOT_AVAILABLE when no mapping |
| `trend.ts` | **Quality Trend** (min→hour→day→…) | INSUFFICIENT_DATA below usable-bucket floor; gaps kept null |
| `predictive.ts` | **Predictive Warning**, **Release Risk**, **Progressive Incident** | likelihood/risk bands; INSUFFICIENT_DATA on thin samples |
| `replay.ts` | **Store Replay** + **Fleet Replay** timelines | bounded steps; PII-free |
| `rootCause.ts` | **Root-Cause Evidence** chain + capped confidence | UNKNOWN / null confidence below min links |

The matrix explicitly does **not** invent cells the client cannot distinguish: the emit browser
allow-list is `edge/samsung/chrome/safari/firefox/other`, so "Electron", "Android WebView" and
"iOS Safari" are not separable — they fold into `other`/`safari`+os and simply do not appear as their own
rows (honest, not fabricated).

## 4. Storage & RPCs (`supabase/migrations/0461_streaming_ops_intelligence.sql`)

Additive. One new table `streaming_quality_rollup` (hour/day cost-aware rollup — the **only** write
target; RLS deny-all + super-admin read; the established codebase pattern was purge-only, so this rollup
is a new, clearly-flagged pattern). Functions: `_sqe_agg_scope` (superset of 0460's `_sqe_aggregate`,
**identical JSON shape** so the client `rowToAggregate` is reused, plus a `stores` distinct-count key);
`rollup_streaming_quality` / `purge_streaming_quality_rollup` (service_role); and the admin query RPCs
`admin_streaming_quality_matrix` (browser/device/os), `_timeseries` (bucketed, predictive/trend),
`_replay` (store/session, PII-free), `_fleet_replay` (per-bucket store-state counts), `_enterprise`
(`franchise_stores.store_id = auth.uid()` → `franchises.name`). **Rollback = plain DROP** of the new
table + functions; no existing object altered.

### Long-term warehouse & cost-aware rollup

Raw `streaming_quality_events` retain ~30d (0460's purge). The rollup warehouse folds high-frequency raw
events into per-`(hour, store, release, env, browser, os, device)` and daily rows so long-term retention
(hourly ~90d, daily ~365d via `purge_streaming_quality_rollup`) is cheap — the operator keeps trend
history without storing every raw event forever.

### Migration validation (never applied to production)

`0461` was validated against the **real production schema** inside a `BEGIN … ROLLBACK` transaction via
the Supabase MCP `execute_sql` (nothing persisted). Because `_obs_window_interval` (0455) and
`streaming_quality_events` (0460) are not in production (head 0453), both were created inside the txn and
`_is_super_admin()` was stubbed true. With a real `users.id` seeded into `franchise_stores` and ~24 events
across 2 browsers / 2 releases, every RPC compiled and returned correct shapes:
`matrix.cells=2 · ts.buckets=25 · replay.rows=24 · fleet.snaps=1 · ent.brands=1 · rollup.rolled=2 ·
purge.ok=true`. The `stores` distinct-count key was separately re-verified with past-dated rows
(`stores:2, sessions:4`). The transaction aborted (via `RAISE EXCEPTION`), leaving no trace; a follow-up
read confirmed the rollup table, RPCs and test brand do not exist. **Production migration head remains
0453 — 0461 is not applied.**

## 5. Feature coverage (spec §1–18)

1 Streaming Replay Timeline · 2 Incident Timeline (progressive) · 3 Browser Quality Matrix ·
4 Device Matrix · 5 Release Heatmap · 6 Enterprise Heatmap · 7 Store Replay (24h) · 8 Predictive Warning ·
9 Release Risk · 10 Progressive Incident · 11 Streaming Reliability Index · 12 Quality Trend ·
13 Fleet Replay · 14 Root-Cause Evidence · 15 Quality Coverage · 16 Long-term Warehouse ·
17 Cost-aware Rollup · 18 Operations Dashboard v2 — all delivered read-only.

## 6. What is honestly NOT fully realized this phase

- **Release-scoped affected stores** come from the new `stores` distinct-count on `_sqe_agg_scope`
  (real). The **pev2 start funnel** remains window-level (pev2 has no release column) — unchanged from
  WEB-OBS-7.
- **Rollup scheduling**: `rollup_streaming_quality` is a manual/batch function (service_role); this phase
  adds no scheduler. The warehouse schema + rollup/purge functions exist; wiring a cron is out of scope.
- **Real speaker output / crossfade & preload for stores / session continuity**: inherited NOT_AVAILABLE
  from WEB-OBS-7 (business mode disables crossfade/preload; continuity not emitted).
- **Browser granularity**: Electron / Android WebView / iOS-Safari are not separately detectable and are
  not shown as distinct matrix rows.
