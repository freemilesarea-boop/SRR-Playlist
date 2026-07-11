# WEB-OPS-10 — Unified Operations Platform (Final)

Converges every operational capability built across the WEB-OPT and WEB-OBS series into a **single
Command Center** so an operator manages the whole platform from one place instead of hopping between
dashboards. **This phase adds NO new Player or Streaming feature** — it composes the existing WEB-OBS
super-admin APIs into unified read-only views plus a per-operator workspace. With this phase the WEB
series is complete.

> **Read-only convergence.** Nothing here executes, merges, deploys, rolls back, blocks a release, or
> controls the Player. Existing dashboards / RPCs / operational data are untouched (Player, Playback,
> Queue, Crossfade, Recovery, Scheduler, Audio Output, Telemetry, Playback Events, Streaming Quality,
> Governance all stay READ-only). Rule-based, NO ML/LLM. Additive. Preview PR only — no production
> merge / deploy / migration apply. Base = `feat/web-obs-9-operations-governance` (PR #348).

## 1. Non-negotiable safety contract

- **No new Player/Streaming feature; no execution.** The Command Center only reads and summarizes. No
  code path performs a release merge/deploy/rollback, release-block, or remote Player action.
- **Existing dashboards preserved.** The Store Fleet, Streaming Quality, Operations Intelligence and
  Operations Governance dashboards remain exactly as they were — the Unified Center is an **additional**
  super-admin tab that composes their data. `git diff` modifies no existing dashboard or API file
  (only AdminPage tab-array wiring + new files).
- **No client/Player/operational-data change.** Player / Queue / Playback / Crossfade / Recovery /
  Scheduler / Audio Output are untouched; telemetry / playback-events / streaming-quality / governance
  semantics are unchanged. The only writes are to two **new** per-operator UI-state tables
  (`operations_workspace`, `operations_preferences`) — never to operational data.
- **No fabrication.** Platform Score / SLA / Executive Summary degrade to INSUFFICIENT_DATA below the
  sample floors; MTTR/MTBF are only derived when enough resolved incidents exist; TTFA stays
  TTFA_APPROX. NO_DATA / NOT_AVAILABLE surfaced honestly (e.g. per-store governance/release history).
- **Server-verified & private.** Read RPCs are super-admin gated; workspace/preferences rows are
  owner-scoped by `auth.uid()` (an operator sees only their own layout). No operational RPC meaning is
  changed.

## 2. Architecture

```
WEB-OBS-6/7/8/9 super-admin APIs (READ-ONLY): getOpsOverview · getReleaseReadiness · getGovernanceState
   · getEnterpriseHeatmap · getFleetReplay · getStoreReplay
         ▼   src/lib/platform/*  (rule-based converge engines)
  platformScore · sla · executiveSummary · commandTimeline · search · workspace (pure)
         ▼   platformApi.getPlatformCenter()  (one composed bundle: KPIs + score + SLA + summary + timeline + corpus)
         ▼   0463 RPCs: get/upsert/delete workspace · upsert preferences · admin_operations_search
         ▼   Admin "통합 운영 센터" tab (UnifiedOperationsCenter — 9 tabs, KPIs, unified search, widget workspace)
```

## 3. Engines (`src/lib/platform/`, 13 unit tests)

| Engine | Feature | Degradation |
| --- | --- | --- |
| `platformScore.ts` | **Platform Score** (0–100 from availability + streaming + reliability + governance + incidents + coverage + confidence) | NO_DATA components dropped + renormalized; INSUFFICIENT_DATA below session floor |
| `sla.ts` | **SLA Dashboard** — availability, recovery rate, incident rate, error budget, MTTR/MTBF | MTTR/MTBF null unless ≥2 resolved incidents; INSUFFICIENT below session floor |
| `executiveSummary.ts` | **Executive Summary** (rule-based weekly bullets: Platform Stable / Release Safe / No Critical Regression / N Medium Incident / Recovery Excellent) | below floor → INSUFFICIENT_DATA |
| `commandTimeline.ts` | **Command Timeline** (merge releases + incidents + recommendations + approvals) | empty when no events |
| `search.ts` | **Unified Search** (client corpus across store/enterprise/incident/release/recommendation/decision) | below 2 chars → no results |
| `workspace.ts` | **Workspace & Widget system** (default layout, normalize, native reorder/resize/collapse/favorite) | unknown widgets dropped on load |

## 4. Storage & RPCs (`supabase/migrations/0463_unified_operations_center.sql`)

Additive, minimal. Two new **per-operator UI-state** tables (not operational data): `operations_workspace`
(saved widget layouts) and `operations_preferences` (default window/filters). RLS is owner-scoped
(`user_id = auth.uid()` for select; writes via security-definer RPCs only). RPCs (all super-admin gated):
`get_operations_workspace`, `upsert_operations_workspace`, `delete_operations_workspace`,
`upsert_operations_preferences`, and `admin_operations_search` (searches WEB-OBS-9 `operations_decisions`
by text, read-only). Everything else (Platform Score / SLA / Executive / Timeline) is composed
**client-side** over the existing WEB-OBS RPCs — no heavy new SQL. **Rollback = plain DROP.**

### Migration validation (never applied to production)

`0463` was validated against the **real production schema** inside a `BEGIN … ROLLBACK` transaction via
the Supabase MCP `execute_sql` (nothing persisted; `_is_super_admin()` stubbed true; a minimal
`operations_decisions` created in-txn for the search RPC). Result: `workspace_rows=1 · prefs_rows=1 ·
search=1 · search_short=0` (2-char minimum honored) with the workspace/search functions compiling
against the live schema. (`auth.uid()` is null in the MCP session, so the owner-scoped write RPCs were
verified by compilation + direct table insert rather than through the RPC path.) The transaction
aborted, leaving no trace; a follow-up read confirmed the tables/functions do not exist. **Production
migration head remains 0453 — 0463 is not applied.**

## 5. Dashboard (`UnifiedOperationsCenter.tsx`)

Read-only super-admin tab "통합 운영 센터": a Global Health KPI row (Platform Availability, Streaming
Reliability, Enterprise Health, Store Availability, Critical Incidents, Open Recommendations, Release
Readiness, Governance Queue), a unified search bar, and 9 tabs — **Overview** (Platform Score + Executive
Summary + Command Timeline), **Fleet**, **Enterprise**, **Stores** (Store Digital Twin: playback /
streaming / recovery / incident timelines, read-only), **Streaming**, **Incidents**, **Governance**,
**Executive** (Executive + SLA + Reliability dashboards), and **Workspace** (widget layout with native
drag-reorder, size, collapse, favorite, save). Tone-system only; loading / empty / error / NO_DATA /
INSUFFICIENT_DATA handled throughout.

## 6. Feature flags (`platform/config.ts`, read-side default ON)

`VITE_OPS_CENTER_ENABLED`, `VITE_OPS_EXECUTIVE_ENABLED`, `VITE_OPS_PLATFORM_SCORE_ENABLED`,
`VITE_OPS_WIDGET_LAYOUT_ENABLED`, `VITE_OPS_SLA_ENABLED`, `VITE_OPS_DIGITAL_TWIN_ENABLED`,
`VITE_OPS_TIMELINE_ENABLED`. A flag OFF only hides a section; it can never affect playback, the queue,
crossfade, recovery, a release, or any operational data.

## 7. Data safety

Player / Queue / Playback / Crossfade / Recovery / Scheduler / Audio Output / Telemetry / Playback
Events / Streaming Quality / Governance are all **READ-only** from this phase. `git diff` touches no
Player/audio/queue/crossfade/recovery/scheduler file and modifies no existing dashboard or API. The only
destructive SQL is on the new UI-state tables (RLS setup / revoke / an operator deleting their own saved
layout) or rollback comments. No `pg_cron` / `http` / deploy / release / player-control call exists.

## 8. Rollback

Plain `DROP` of the 2 new tables + 5 new functions (documented in the migration footer). No existing
object is altered, so revert is clean.

## 9. Deferred work

- **Platform snapshot RPCs** (`admin_platform_score` / `admin_executive_report` server-side): folded
  into client composition to avoid duplicating/re-validating heavy SQL — deferred as server-side RPCs.
- **Per-store governance/release history** in the Digital Twin: not held at store granularity →
  NOT_AVAILABLE (full history is in the Governance tab).
- **Rollup scheduling** (from WEB-OBS-8) remains manual/batch — no scheduler added.
- **Browser Runtime tests: NOT RUN** for this phase (no runtime Player surface); the 13 platform unit
  tests + full suite (401) cover the engines. Any browser-only check is reported NOT RUN, never PASS.
- Not applied to production: no merge / deploy / migration apply; 0463 validated by rollback transaction
  only.
