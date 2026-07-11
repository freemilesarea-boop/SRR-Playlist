# WEB-OBS-7 — Streaming Quality Intelligence & Playback Experience Analytics

Extends the web-app observability layer (WEB-OBS-1…6) to the **actual music playback experience**:
playback-start success, time-to-first-audio (approx), track-transition/crossfade outcome, buffering /
stall suspicion, preload effectiveness, decoder / media error, playback recovery quality, session
continuity, a composite Streaming Quality Score, release / browser / device comparison, quality-
regression detection, incident detection and an operational advisor. **Observation + analysis ONLY.**
Nothing is executed: no auto playback control, no auto Reload / Rollback / Release-block, no remote
Player control, no notification. Rule-based, **NO ML/AI**. Additive. Preview PR only — no production
merge / deploy / migration apply. Base = `feat/web-obs-6-store-fleet-monitoring` (PR #345).

> Every threshold is a named constant in `src/lib/streamingQuality/thresholds.ts`. Below the
> sample/confidence gates each engine returns INSUFFICIENT_DATA / NOT_AVAILABLE / NO_DATA — never a
> fabricated verdict.

## 1. Non-negotiable safety contract

- **No remote control / no auto action.** The advisor emits *labels* only
  (`INVESTIGATE_START_FAILURE`, `HOLD_RELEASE`, `CHECK_DECODER_SUPPORT`, …). No code path performs a
  Reload, Rollback, Release-block, Vercel-cancel, GitHub change or any remote Player action.
  `computeQualityAdvice()` stamps `automated:false`, `requiresApproval:true`, **`remoteControl:false`**
  on every category (asserted by tests).
- **Behavior-preserving Player instrumentation.** WEB-OBS-7 adds **emit-only** telemetry to
  `Player.tsx` and `useAudioRecoveryManager.ts`. Every added line is an observation after an existing
  signal: no existing conditional / order / return / state transition / setState order / dependency
  array / retry count / recovery condition / reload condition / crossfade duration or start-end
  condition / gain calc / queue swap / preload condition / audio source / currentTime / volume / muted
  / sinkId is changed; **no** `play()`/`pause()`/`load()` call is added; no existing timeout / interval
  / rAF timing or cleanup is changed. `playback_events_v2` semantics are unchanged. The full changed-
  line inventory is in §9. **0 deletions, 0 modifications of existing lines — insertions only.**
- **Emit can never affect playback.** `recordStreamingQuality()` is synchronous, returns `void`, is
  **never awaited**, and its entire body is wrapped in try/catch so it can never throw. A rejected
  flush is swallowed. Playback continues on emit failure; the emit never reaches the Player error
  boundary. Every call site is *additionally* wrapped in its own `try { … } catch { /* fail-open */ }`.
- **currentTime progress ≠ speaker output.** TTFA is measured as request → first `currentTime`
  progress and reported as **TTFA_APPROX** — it never claims proof of audio reaching the speaker
  (`실제 스피커 출력 시점은 브라우저에서 증명 불가`). A `play` event ≠ first audio output; a media
  `error` ≠ a network failure.
- **No fabricated numbers.** Real signal absent → NO_DATA / NOT_AVAILABLE. A small sample can never
  confirm a regression. Store ≠ Session; event count ≠ affected-session / affected-store count. Below
  `MIN_SESSIONS_FOR_SCORE` the score is INSUFFICIENT_DATA, not a guessed number.
- **Server-verified attribution.** `store_id = auth.uid()` (business user == store). The ingest RPC
  rejects a spoofed `p_store_id` — the client never sends a store id and can never claim another store.
- **Privacy.** No raw track id / title / artist / playlist / audio URL / user id / query string /
  token on the wire. Track ids are hashed (FNV-1a base36, ≤16 chars, non-reversible); durations are
  clamped; only a normalized media error code (0–4) + numeric network/ready state are captured.
- **Opt-in emit.** All emit paths are gated behind `VITE_SQ_TELEMETRY_ENABLED` (default **OFF**).
  With the flag off `recordStreamingQuality` is a synchronous no-op. The dashboard read-side is on by
  default (super-admin only) but shows NO_DATA until telemetry is enabled and data arrives.

## 2. Architecture

```
Player (Player.tsx / useAudioRecoveryManager) — EMIT-ONLY, after existing signals, fully fail-open
  └─ recordStreamingQuality (opt-in, sync, never awaited) → ingest_streaming_quality_events (auth.uid())
       → streaming_quality_events (0460, RLS deny-all + super-admin read; store_id = auth.uid())
         ▼
admin_streaming_quality_overview / _stores / _errors  (super-admin · param-bound · SELECT + _sqe_aggregate)
   · pev2_start_funnel read-only from playback_events_v2 (window-level; pev2 semantics unchanged)
         ▼
src/lib/streamingQuality/*  (pure, unit-tested engines — the verdict truth)
   quality (score/classifiers) · analysis (compare/regression/incidents/advice) · thresholds · config
         ▼
streamingQualityApi.getStreamingQualityOverview()  (maps RPC rows → engines, client-side)
         ▼
Admin "스트리밍 품질" tab  (score · dimensions · advisor · media errors · release compare · incidents — READ-ONLY)
```

## 3. Streaming-quality event (`src/lib/streamingQuality/eventSchema.ts`)

Dependency-free wire schema. `SQ_EVENT_VERSION = 1`, `SQ_MAX_BATCH_EVENTS = 40`. Event types:
`first_progress`, `crossfade_completed`, `crossfade_fallback`, `crossfade_aborted`, `preload_ready`,
`preload_failed`, `media_error`, `recovery_attempted`, `recovery_succeeded`, `recovery_failed`. The
envelope carries **no store_id** (server stamps it from `auth.uid()`), an opaque `player_session_id`,
a non-reversible `current_track_hash`, `release` (BUILD_ID), `environment`, `route`, `browser`, `os`,
`device_class`, `visibility_state`, `business_mode`, a clamped `duration_ms`, an allow-listed
`outcome`/`reason`, and — only for `media_error`/`preload_failed` — a normalized `media_code` (0–4)
plus numeric `network_state`/`ready_state`. `parseStreamingQualityEvent`/`parseStreamingQualityBatch`
rebuild from an allow-list, dropping unknown fields and coercing enums.

## 4. Emit + transport (`src/lib/streamingQuality/emit.ts`)

`recordStreamingQuality(input)` is the single Player-facing entry point. It is **synchronous, returns
void, never awaited, never throws** (whole body in try/catch). Behaviour: opt-in gate → per-type flag
→ session-stable sampling (`media_error`/`recovery_failed` always kept) → push to a bounded buffer →
flush via `supabase.rpc('ingest_streaming_quality_events', { p_events, p_store_id: null })`. The flush
is fire-and-forget with a **bounded batch and no retry storm** — a failed flush drops the batch. A
best-effort flush runs on `pagehide`/`visibilitychange→hidden`. The store id is **never** on the wire;
the server derives it from `auth.uid()`.

## 5. Engines (`src/lib/streamingQuality/`)

- **`quality.ts` — `computeStreamingQuality(agg)`**: per-dimension classifiers (start success, TTFA_APPROX
  percentiles, transition/gap, crossfade completion, stall, media-error session-rate, preload readiness,
  recovery success, session continuity) and a 0–100 composite **only over PRESENT components** —
  NO_DATA dimensions are dropped and the remaining weights renormalize, so an absent signal never
  silently scores 0. Below `MIN_SESSIONS_FOR_SCORE` the result is INSUFFICIENT_DATA. `signalCoverage`
  reports which dimensions actually had data. TTFA carries the speaker-output disclaimer.
- **`analysis.ts`**: `compareQualityMetric`, `computeQualityRegression` (needs a real prior baseline;
  small samples → NOT_ENOUGH_DATA), `detectQualityIncidents` (start-failure / media-error / stall /
  TTFA / crossfade-failure / recovery-failure / release-specific spikes, absolute **and** relative
  gate), `computeQualityAdvice` (labels only; every action `requiresApproval:true`, `automated:false`,
  `remoteControl:false`).
- **`thresholds.ts` / `config.ts`**: all named constants; feature flags (emit flags default OFF /
  opt-in; dashboard flags default ON).

## 6. Storage & RPCs (`supabase/migrations/0460_streaming_quality_events.sql`)

Additive. Table `streaming_quality_events` (`store_id uuid not null`, no FK; bucketed columns; media
error code CHECK 0–4; **RLS enable + force** with a single super-admin read policy; 6 indexes incl. a
partial error index). Security-definer RPCs, all `set search_path = public`, super-admin gated via
`_is_super_admin()`, parameterized (no dynamic SQL), allow-listed windows via `_obs_window_interval`,
batch/row-capped:

- `ingest_streaming_quality_events(p_events jsonb, p_store_id uuid)` — derives `store_id` from
  `auth.uid()`, **rejects a spoofed `p_store_id`**, caps the batch at 40, coerces every field through
  an allow-list.
- `_sqe_aggregate(p_scope, p_since, p_env, p_release, p_store)` — SQL helper returning a
  QualityAggregate-shaped jsonb (TTFA via `percentile_cont`, media-error-by-code via `jsonb_object_agg`).
- `admin_streaming_quality_overview` — overall + by-release (via `_sqe_aggregate`) + a **read-only**
  window-level start funnel from `playback_events_v2` (pev2 has no release column, so the funnel is
  window-level only; pev2 is never written).
- `admin_streaming_quality_stores`, `admin_streaming_quality_errors` (by code / browser / release).
- `purge_streaming_quality_events(p_days default 30)` — retention delete on the **new table only**,
  service_role.

**Rollback** = plain `DROP` of the new objects (documented in the migration footer). No existing object
is altered.

### Migration validation (never applied to production)

`0460` was validated against the **real production schema** inside a `BEGIN … ROLLBACK` transaction via
the Supabase MCP `execute_sql` (nothing persisted). Because `_obs_window_interval` (0455) and
production-stubbed `_is_super_admin()→true` differ in the rehearsal, both were created inside the txn.
The rehearsal confirmed: the table + indexes + RLS compile; `ingest` accepts a valid batch, filters an
invalid `event_type`, and **rejects a call with no derivable store (unauthorized)**; `_sqe_aggregate`'s
`percentile_cont` and the `playback_events_v2` read-only join compile against the live schema; the
transaction rolled back leaving no trace. Production migration head remains **0453** — 0460 is **not**
applied.

## 7. Admin dashboard (`src/components/admin/StreamingQualityDashboard.tsx`)

Read-only super-admin tab "스트리밍 품질". Window controls (1h/24h/7d/30d), manual refresh + opt-in
auto-refresh, overview stat cards (Quality Score, Signal Coverage, Sessions, Start Success, TTFA_APPROX
p75, Crossfade, Stall, Media Error, Preload, Recovery, Critical Incidents, pev2 start requests), a
per-dimension status strip, the advisor card (labels only — **no control buttons**), a media-error
breakdown (by code / browser / release), a release-comparison table with regression, and an incident
list. Loading / empty / error / stale states handled. Uses the admin tone system only (`lint:tones`
clean); NO_DATA / NOT_AVAILABLE surfaces are shown honestly.

## 8. Feature flags

| Flag | Default | Effect |
| --- | --- | --- |
| `VITE_SQ_TELEMETRY_ENABLED` | **false (opt-in)** | Master emit gate. Off → `recordStreamingQuality` no-op. |
| `VITE_SQ_TTFA_ENABLED` … `VITE_SQ_MEDIA_ERROR_ENABLED` | true | Per-dimension emit toggles (only matter when master is on). |
| `VITE_SQ_SAMPLE_RATE` | 1 | Session-stable sampling; errors/recovery-failures always kept. |
| `VITE_SQ_DASHBOARD_ENABLED` / `_INCIDENTS` / `_ADVISOR` / `_AUTO_REFRESH` | true | Read-side (super-admin only). |

## 9. Player-related changed-line inventory (emit-only)

All entries are **insertions after an existing signal**; 0 existing lines changed or deleted.
Line numbers are post-change positions in the current file.

### `src/components/player/Player.tsx` (34 insertions)

| Site | Lines | What it does | Why it is behavior-preserving |
| --- | --- | --- | --- |
| import | ~42 (+comment) | `import { recordStreamingQuality }` | Import only. |
| TTFA ref | ~603 | `sqTtfaStartRef` telemetry-only ref | New ref, read only by telemetry; never used in playback logic. |
| TTFA start | ~973 | Set `sqTtfaStartRef` **after** the existing `play_start` pev2 emit | Assignment to a telemetry ref; no branch/return/state change. |
| crossfade outcome | ~1556–1566 | In `completeSwap`, after `audioDebugWarn`: emit `crossfade_{completed,fallback,aborted}` from the existing `reason` | Reads existing `reason`/`startedAt`; does not touch swap/duration/gain. |
| preload ready | ~1741 | After the existing preload `onReady` `audioDebugWarn`: emit `preload_ready` | After existing callback; preload conditions untouched. |
| preload failed | ~1753 | After the existing preload `onErrorEv` `audioDebugWarn`: emit `preload_failed` (+ normalized code) | After existing callback; no source/load change. |
| first_progress | ~1939–1954 | In the **existing** `onTimeUpdate`, after the `lastProgressRef` block: one-shot `first_progress` when `t > 0.05` | Appends to an existing handler; no new listener; guarded one-shot; no currentTime write. |
| media_error | ~2443–2455 | After the **existing** pev2 `player_error` block in `onError`: emit `media_error` (normalized `code` + numeric `networkState`/`readyState`, no URL/title) | After existing error emit; error-handling branch unchanged. |

### `src/hooks/useAudioRecoveryManager.ts` (13 insertions)

| Site | Lines | What it does | Why it is behavior-preserving |
| --- | --- | --- | --- |
| imports | ~top | `recordStreamingQuality` + `SqReason` type | Import only. |
| recovery emit | ~318 (after outcome `audioDebugWarn`) | For **real attempts only** (`success`/`failed`; `skipped`/blocked-autoplay excluded), emit `recovery_attempted` + `recovery_succeeded`/`recovery_failed`, mapping `reason` to the `SqReason` allow-list | After the existing recovery-outcome log; recovery conditions / counters / retry logic untouched. |

Every one of the above call sites is individually wrapped in `try { … } catch { /* fail-open */ }`,
in addition to the fully fail-open `recordStreamingQuality` body.

## 10. What is honestly NOT measured this phase

- **Crossfade & preload for stores**: business mode disables crossfade/preload, so for store scopes
  these are reported **NOT_AVAILABLE**, never fabricated.
- **Transition gap & session continuity**: no dedicated gap/continuity event is emitted this phase →
  `transitionGap` samples 0 (NOT_AVAILABLE) and continuity → INSUFFICIENT_DATA.
- **Real speaker output**: not provable in-browser; TTFA is TTFA_APPROX only.
- **Store name / user identity**: never joined or shown; attribution is `auth.uid()` only.
