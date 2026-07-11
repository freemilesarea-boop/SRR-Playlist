# AI-MUSIC-2 — Intelligent Playlist Generation & Optimization

Builds a rule-based **playlist BUILDER** on top of the AI-MUSIC-1 foundation (Store Profile · Track Profile
· Compatibility · Recommendation · Discovery). It actually *generates* a proposed playlist for a store, but
**no real playlist is ever changed until operator approval** — every output is **Simulation Only**. **No real
LLM or generative AI**: the builder composes named-threshold rules over READ-ONLY existing telemetry + store
learning + track metadata.

> **Absolute constraints honored.** No production merge / deploy / migration apply. No change to Player /
> Playback / Queue / Crossfade / Recovery / Scheduler / Audio Output / existing Telemetry / Streaming
> Quality / Governance / settlement / ranking (exposure) / real playlist-generation logic / store data. The
> AI is read-only and generates **proposals / simulations** only. Base = `feat/ai-music-1-foundation`
> (AI-MUSIC-1, PR #350). Production migration head remains **0453**; migrations 0464 + 0465 are validated but
> **not applied**.

## 1. Non-negotiable safety contract

- **Simulation Only.** A generated playlist is a *proposal* stamped `requiresApproval:true`,
  `automated:false`, `simulationOnly:true` (asserted by tests). No engine or RPC queues, generates, deploys,
  or plays a real playlist, and none executes an operating policy. Persisted rows (`ai_generated_playlists`
  / `ai_playlist_candidates` / `ai_playlist_simulations`) are advisory snapshots for operator review.
- **Read-only over existing data.** The builder's only new server read is per-track recent-7-day play counts
  (fatigue signal) from `playback_events_v2`; store/track/compatibility inputs reuse the AI-MUSIC-1 read
  RPCs. No existing table/RLS/data/algorithm is modified; the new `ai_*` tables are isolated.
- **Rule-based, not a model.** Builder, diversity optimizer, fatigue prevention, energy curve, time &
  industry intelligence, candidate comparison, and playlist confidence are all named-threshold rules
  (`aiPlaylist/thresholds.ts`). Confidence is a rule blend, **capped at 92** — never certainty.
- **No fabrication.** Below the pool floor → INSUFFICIENT_DATA; a signal absent → NO_DATA. Store not ready →
  no build. Weather remains an honest placeholder (no data this phase).
- **Server-verified & opt-in.** RPCs are super-admin gated (`_is_super_admin()`), security-definer,
  param-bound, row-capped. Flags `VITE_AI_PLAYLIST_BUILDER_ENABLED` / `..._COMPARE_ENABLED` /
  `..._SIMULATION_ENABLED` default **OFF** and sit behind the AI-MUSIC master flag `VITE_AI_MUSIC_ENABLED`.

## 2. Architecture

```
AI-MUSIC-1 (READ-ONLY): StoreProfile · TrackProfile · Compatibility  ─┐
Existing telemetry (READ-ONLY): playback_events_v2 recent-7d plays ───┤→ engine inputs
                                                                       ▼
  src/lib/aiPlaylist/*  (pure, rule-based — NO LLM)
   timeIntelligence · industryIntelligence · energyCurve · fatiguePrevention ·
   diversityOptimizer · playlistBuilder(+explainability) · candidateComparison · confidence
                                                                       ▼
  aiPlaylistApi: generateWithSimulation() / compareStorePlaylists()  (compose client-side)
                                                                       ▼
  0465 security-definer RPCs (super-admin · param-bound): builder read + advisory record/compare/simulation
                                                                       ▼
  Admin "AI Playlist Builder" tab (6 sub-tabs — READ-ONLY; every persist is an advisory snapshot)
```

The build flow follows the spec: **Store → Time → Industry → Mood → (Weather placeholder) → Learning →
Playlist**, then energy-curve ordering + diversity de-streak + fatigue prevention.

## 3. Engines (`src/lib/aiPlaylist/`, 20 unit tests)

| Engine | Feature (task) | Degradation |
| --- | --- | --- |
| `playlistBuilder.ts` | **Playlist Builder** (1) — scores the pool (compat + industry + time + learning + freshness), selects, orders to the energy curve, de-streaks; per-track **Explainability** (9) | pool < floor or store not ready → INSUFFICIENT_DATA |
| `diversityOptimizer.ts` | **Diversity Optimizer** (2) — Artist(≈genre proxy)/Genre/Mood/BPM/Energy diversity; `localDestreak` (curve-preserving) + `optimizeDiversity` (aggressive) | measures null when no signal |
| `fatiguePrevention.ts` | **Fatigue Prevention** (3) — recent-7-day repeat → pick-score penalty + playlist fatigue risk | 0 recent → no penalty |
| `energyCurve.ts` | **Energy Curve** (4) — target Low→Medium→High→Medium→Low + fit scoring | null when no energies comparable |
| `timeIntelligence.ts` | **Time Intelligence** (5) — hour → Coffee/Lunch/Afternoon/Dinner/Closing slot | null hour → whole-day plan |
| `industryIntelligence.ts` | **Industry Intelligence** (6) — 9 industries (카페/병원/헬스/와인바/쇼룸/호텔/오피스/네일샵/스터디카페) → target genres/moods/energy/instrumental | general fallback |
| `candidateComparison.ts` | **Candidate Comparison** (8) — A/B/C strategies → composite score → Best | INSUFFICIENT → no best |
| `confidence.ts` | **Playlist Confidence** (10) — pool/store/compat/learning/curve blend → HIGH/MEDIUM/LOW/INSUFFICIENT (≤92) | store not ready → INSUFFICIENT_DATA |
| *(reused)* AI-MUSIC-1 `simulatePlaylist` | **Playlist Simulation** (7) — predicted skip/complete/diversity/fatigue/compatibility | SIMULATION ONLY |

## 4. Storage & RPCs (`supabase/migrations/0465_ai_playlist_builder.sql`)

Additive. Three isolated tables (`ai_generated_playlists`, `ai_playlist_candidates`,
`ai_playlist_simulations`; RLS deny-all + super-admin read; writes only via security-definer RPCs). RPCs:
`admin_ai_playlist_builder` (READ — recent-7d per-track plays = fatigue signal), `admin_ai_playlist_candidates`
(READ — saved proposals), `record_ai_generated_playlist` / `admin_ai_playlist_compare` /
`admin_ai_playlist_simulation` (advisory writes — record only, nothing deployed/played). **Rollback = plain
DROP.**

### Migration validation (never applied to production)

`0465` was validated against the **real production schema** inside a `BEGIN … ROLLBACK` transaction via the
Supabase MCP `execute_sql` (nothing persisted; `_is_super_admin()` stubbed true). All five RPCs exercised
successfully: `builder_ok=true · gen_ok=true · cand_count=1 · cmp_stored=2 · sim_ok=true`
(`total7d=0` — this preview DB has sparse `playback_events_v2.business_id` data, same as AI-MUSIC-1). A
follow-up read confirmed the three tables / five functions **do not exist** and the real `_is_super_admin()`
is unchanged. No table-name collisions (checked before writing). **Production migration head remains 0453 —
0464 + 0465 are not applied.**

## 5. Dashboard (`AiPlaylistBuilderDashboard.tsx`)

Read-only super-admin tab "AI Playlist Builder" — **master-flag gated (default OFF)**. Store selector + hour
/ length / strategy controls + 6 sub-tabs: **Builder** (generate proposal — picks table with per-track *why*
+ actual-vs-target energy-curve view + save), **Simulation** (predicted skip/complete/diversity/fatigue/
compatibility), **Compare** (A/B/C → Best table + save), **Optimize** (before/after diversity from the local
de-streak), **Discovery** (saved-proposal history), **Confidence** (HIGH/MEDIUM/LOW breakdown). Tone-system
only; loading / empty / INSUFFICIENT_DATA handled; each persist button stores an advisory snapshot only.

## 6. Feature flags (`aiPlaylist/config.ts`, all default OFF)

`VITE_AI_PLAYLIST_BUILDER_ENABLED`, `VITE_AI_PLAYLIST_COMPARE_ENABLED`, `VITE_AI_PLAYLIST_SIMULATION_ENABLED`
— all default OFF, and all sit behind the AI-MUSIC master flag `VITE_AI_MUSIC_ENABLED` (also OFF). A flag OFF
only hides Builder UI/analysis; it can never affect playback, the queue, real playlist generation,
settlement, ranking, streaming, or any existing data.

## 7. Data safety

Player / Playback / Queue / Crossfade / Recovery / Scheduler / Audio Output / Streaming Quality / Governance
/ Settlement / Ranking (exposure) / real Playlist-generation logic / Store data are all **READ-only** —
`git diff` modifies no such existing file (the only existing file touched is `AdminPage.tsx`, an additive
8-line tab wiring) and no existing table/RLS/algorithm. The only destructive SQL is on the new `ai_*` tables
(RLS setup / revoke) or rollback comments; the only writes are advisory snapshots into the new tables.

## 8. Rollback

Plain `DROP` of the 3 new tables + 5 new functions (documented in the migration footer). No existing object
is altered, so revert is clean.

## 9. Deferred work

- **Artist-level balance** uses a genre proxy — `tracks` has no reliable artist id, so true artist diversity
  is deferred (surfaced honestly in the Optimize tab).
- **Weather** remains a NOT_AVAILABLE placeholder in the build flow (no data source yet).
- **Real deployment** is intentionally out of scope: the builder only *proposes*; wiring an approved proposal
  into a real playlist requires a separate operator-approval + apply path (future phase), never automatic.
- **Browser Runtime tests: NOT RUN** (no runtime Player surface); engines covered by 20 unit tests + the full
  suite (440). Any browser-only check is reported NOT RUN, never PASS.
- Not applied to production: no merge / deploy / migration apply; 0465 validated by rollback transaction only.
