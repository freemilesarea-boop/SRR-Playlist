# AI-MUSIC-4 — Controlled Playlist Experimentation & Pilot Rollout Intelligence

Builds a rule-based **experiment design & analysis** layer on top of AI-MUSIC-1~3: AI-generated playlist
candidates are never applied to all stores at once — they are validated on a limited set of stores through a
**controlled experiment & pilot rollout intelligence** system. **This is a design / analysis / recommendation
system, NOT an execution system.** **No LLM / No ML / No statistical-significance library.** The AI never
starts a pilot, assigns a store to a group, deploys a playlist, expands, stops, or rolls back.

> **Absolute constraints honored.** No production merge / deploy / migration apply. No change to Player /
> Playback / Queue / Crossfade / Preload / Recovery / Scheduler / Audio Output / sinkId / existing Playlist /
> Playlist-generation / Ranking / Settlement / Streaming Quality / Governance / Store & Track source data /
> AI-MUSIC-1~3 engine meaning / Service Worker / CDN. Base = `feat/ai-music-3-adaptive-learning` (AI-MUSIC-3,
> PR #352). Production migration head remains **0453**; migrations 0464–0467 are validated but **not applied**.

Every output is one of: `RECOMMENDATION_ONLY` · `SIMULATION_ONLY` · `DRAFT` · `NOT_STARTED` · `NO_DATA` ·
`NOT_AVAILABLE` · `INSUFFICIENT_DATA`, and carries `requiresApproval:true`, `automated:false` (rollout also
`remoteControl:false`, `actualDeployment:false`).

## 1. Signal Audit (작업 1) — what actually exists

- **Available (real prod, READ-ONLY):** `playback_events_v2` — playback COUNT, DISTINCT `session_id`
  (sessions), `event_type` + `completion_percent` (complete/skip), `browser`, `device_type`, `os`,
  `store_type_slug`, `playlist_id` (version-change detection); `store_track_reactions` (dislike);
  `business_profiles.business_type` (industry); `franchise_stores` (`store_id → franchise_id`, enterprise
  spillover, best-effort); `tracks` / `track_audio_features` (profile & compatibility coverage).
- **NOT_AVAILABLE (no prod source — WEB-OBS 0459/0460 not applied):** `streaming_quality_events` → streaming
  quality / TTFA / stall / media-error / recovery guardrails; `store_fleet_events` → store incident/health; no
  `release_version` → release attribution/regression; no `region`/`city` → region diversity.
- **Consequence (honest):** the streaming/incident **guardrail metrics have no real prod source**, so they
  degrade to `NOT_AVAILABLE` — the engines accept them and light up when the source lands, but nothing is
  fabricated. Region diversity is not used (no signal). **Store, Session, and Playback counts are kept
  strictly distinct throughout.**

## 2. Architecture

```
AI-MUSIC-1~3 (READ-ONLY) + real ops data (playback + reactions + franchise)
        ▼   0467 RPCs (super-admin · param-bound · SELECT · Store/Session/Playback distinct)
  admin_ai_experiment_eligibility (per-store signals) · admin_ai_experiment_outcome (observational arm agg) ·
  admin_ai_experiment_history · admin_ai_experiment_recommendation (+ Draft/Snapshot/Review writes)
        ▼   src/lib/aiExperiments/* (pure, rule-based — NO LLM/ML/stats-lib)
  eligibility · pilotRecommendation · groupDesign · experimentPlan · metrics · guardrail · contamination ·
  outcome · lift · rollout(stop/continue/expand) · learningFeedback · explainV3
        ▼   aiExperimentsApi (compose client-side)
        ▼   Admin "AI Experiments" tab (11 sub-tabs — READ-ONLY; Draft/Review/Audit only, no start/deploy/assign)
```

## 3. Engines (`src/lib/aiExperiments/`, 39 unit tests)

| Engine | Feature (작업) | Degradation |
| --- | --- | --- |
| `eligibility.ts` | **Experiment Eligibility** (2) — ELIGIBLE / REVIEW_REQUIRED / TEMPORARILY_EXCLUDED / INELIGIBLE / INSUFFICIENT_DATA + blocking reasons + warnings | < sample floor → INSUFFICIENT_DATA; missing guardrail signal → warning (not a fake block) |
| `pilotRecommendation.ts` | **Pilot Store Recommendation** (3) — diverse eligible picks + exclusions + diversity coverage | < min eligible → INSUFFICIENT_DATA (never invents a store id) |
| `groupDesign.ts` | **Control / Treatment Design** (4) — session-balanced split, spillover/duplicate detection | BALANCED / ACCEPTABLE / IMBALANCED / CONTAMINATION_RISK / INSUFFICIENT_DATA |
| `experimentPlan.ts` | **Experiment Plan** (5) — DRAFT plan; never auto-approved | REVIEW_REQUIRED when groups undesignable |
| `metrics.ts` | **Metrics** (6) — primary/secondary/guardrail with numerator/denominator documented; lift with zero-denominator guard | no relative delta when denominator absent |
| `guardrail.ts` | **Guardrail Evaluation** (9) — PASS / WARNING / FAIL / NOT_AVAILABLE / INSUFFICIENT_DATA, constants | absent source → NOT_AVAILABLE (no fabricated pass) |
| `contamination.ts` | **Contamination Detection** (12) — CLEAN / SUSPECTED / CONTAMINATED / UNKNOWN | unknown when sources unverifiable |
| `outcome.ts` | **Experiment Outcome** (7) + **Lift** (8) — classification + `DIRECTIONAL_ONLY` (no p-values) | small per-arm sample → INSUFFICIENT_DATA (no winner from small sample) |
| `rollout.ts` | **Rollout** (10) + **Stop/Continue/Expand** (11) — recommendation only, expansion gated on guardrail PASS | INSUFFICIENT_DATA below floors |
| `learningFeedback.ts` | **Learning Feedback** (14) — recommendationOnly, applied:false | HOLD on contaminated/insufficient |
| `explainV3.ts` | **Explainability v3** (15) — operator-facing reasons + missing signals | — |

**Guardrail-first rule:** a good primary metric alone never triggers expansion — the guardrail must also
PASS. A completion improvement with a streaming/stall/media-error/incident regression → `ROLLBACK_RECOMMENDED`
or `CONTINUE_PILOT`, never expansion.

## 4. Storage & RPCs (`supabase/migrations/0467_ai_music_experiments.sql`)

Additive. Five isolated tables (`ai_music_experiments`, `ai_music_experiment_groups` — *recommended*
assignments (draft), never connected to playback —, `ai_music_experiment_snapshots`,
`ai_music_experiment_recommendations`, `ai_music_experiment_audit`; RLS deny-all + super-admin read; writes
only via security-definer RPCs). Read RPCs: `admin_ai_experiment_eligibility` (per-store signals),
`admin_ai_experiment_outcome` (observational arm aggregation for two provided store-id lists —
directional only), `admin_ai_experiment_history`, `admin_ai_experiment_recommendation`. Advisory writes:
`record_ai_experiment_draft`, `record_ai_experiment_snapshot`, `record_ai_experiment_review` (audit +
manual-approval status transition only — never OBSERVING auto). **Rollback = plain DROP.**

### Migration validation (never applied to production)

`0467` was validated against the **real production schema** inside a `BEGIN … ROLLBACK` transaction via
Supabase MCP with **synthetic** UUIDs (nothing persisted; `_is_super_admin()` stubbed true). All 7 RPCs + the
`_ai_experiment_arm` helper executed: `elig_ok=true` (the complex per-store aggregation with `mode() WITHIN
GROUP`, laterals and coverage ratios compiled; `elig_stores=0` because the preview DB has sparse
`playback_events_v2.business_id`), `out_ok=true` with `ctrl_stores=2 / treat_stores=2` (arm store-count
distinct), `draft_ok=true` (`controlStored=2 / treatmentStored=2`), `snap_ok=true`,
`rev_action=APPROVE_FOR_MANUAL_SETUP` (audit + status transition), `hist_count=1`. No table-name collisions;
a follow-up read confirmed the 5 tables / 8 functions do not exist and `_is_super_admin()` is unchanged.
**Production migration head remains 0453 — 0464–0467 are not applied.**

## 5. Dashboard (`AiExperimentsDashboard.tsx`)

Read-only super-admin tab "AI Experiments" — **master-flag gated (default OFF)**. 11 sub-tabs: Overview,
Eligibility, Pilot Stores, Plans, Control/Treatment, Metrics, Guardrails, Outcomes, Rollout, History,
Explainability. **Only Draft / Review (manual approve) / Audit buttons** — there is no experiment-start,
store-assignment, or playlist-deploy button. Loading / empty / error / NO_DATA / NOT_AVAILABLE /
INSUFFICIENT_DATA states are handled; guardrail sources are shown NOT_AVAILABLE honestly; outcomes are labeled
observational + directional-only.

## 6. Feature flags (`aiExperiments/config.ts`, all default OFF)

`VITE_AI_EXPERIMENTS_ENABLED`, `VITE_AI_PILOT_RECOMMENDATION_ENABLED`, `VITE_AI_EXPERIMENT_ANALYSIS_ENABLED`,
`VITE_AI_ROLLOUT_RECOMMENDATION_ENABLED`, `VITE_AI_EXPERIMENT_AUDIT_ENABLED` — all default OFF, behind the
AI-MUSIC master flag `VITE_AI_MUSIC_ENABLED` (also OFF). The kill switch only hides Experiment UI/analysis; it
can never touch the Player or Playback.

## 7. Query performance

Read RPCs are param-bound and row/array-capped (eligibility ≤ 500 stores, arm arrays ≤ 200, history ≤ 200).
The eligibility aggregation is a single windowed scan of `playback_events_v2` with `mode() WITHIN GROUP` +
two lateral lookups; indexes exist on the new tables (`status`, `experiment_id`, `store_id`, `created_at`).
Real cost numbers are **not fabricated** — the preview DB has sparse `business_id` data, so only synthetic
validation ran; production cost is a projection, not a measurement.

## 8. Data safety

Player / Playback / Queue / Crossfade / Preload / Recovery / Scheduler / Audio Output / sinkId / existing
Playlist / Playlist-generation / Ranking / Settlement / Streaming Quality / Governance / Store & Track source
data / Service Worker / CDN are all **READ-only** — `git diff` modifies no such existing file (the only
existing file touched is `AdminPage.tsx`, an additive 8-line tab wiring) and no existing table/RLS/algorithm.
The only destructive SQL is on the new `ai_music_experiment*` tables (RLS setup / revoke) or rollback comments.
No `DROP`/`TRUNCATE`/`DELETE`/`UPDATE` on any existing table; no `grant public`, no RLS disable, no pg_cron, no
HTTP/deploy/player-control.

## 9. Rollback

Plain `DROP` of the 5 new tables + 8 new functions (documented in the migration footer). No existing object is
altered, so revert is clean.

## 10. Manual QA (Browser Runtime: NOT RUN)

Browser runtime was **NOT RUN** (no runtime Player surface; the Experiment layer is admin-only analysis).
Manual QA when a reviewer opens the Preview with the flags on: (1) AI Experiments tab loads with Overview
cards; (2) Eligibility lists stores with distinct Playback vs Session counts; (3) Pilot Stores shows diversity
+ exclusions; (4) Control/Treatment shows a session-balanced split with contamination flags; (5) Guardrails
show NOT_AVAILABLE (no streaming source); (6) Outcomes show DIRECTIONAL_ONLY; (7) Rollout shows
automated=false / requiresApproval=true / actualDeployment=false; (8) only Draft/Review/Audit buttons exist —
no start/deploy/assign. Any browser-only check is reported NOT RUN, never PASS.

## 11. Deferred work

- **Streaming/Incident guardrails, TTFA, stall, media-error, recovery, critical-incident** are NOT_AVAILABLE
  until WEB-OBS 0459/0460 land in prod; the engines already accept them.
- **Statistical significance** is intentionally not implemented — outcomes are `DIRECTIONAL_ONLY` (no
  fabricated p-values). A future phase may add a proper significance test.
- **Enterprise spillover** uses a best-effort `franchise_stores.store_id = business_id` join; when the id
  spaces don't match it yields null (no false grouping) — a verified store↔enterprise map is deferred.
- **Region / device-family diversity** deferred (no region signal; device is coarse `device_type`).
- **Real experiment assignment / rollout execution** is out of scope by design — this phase only recommends;
  any real change requires a separate operator-approved manual setup, never automatic.
- Not applied to production: no merge / deploy / migration apply; 0467 validated by synthetic rollback
  transaction only. **Browser Runtime NOT RUN.**
