# AI-MUSIC-1 — Intelligent Music Operating System Foundation

Builds the first foundation layer of an AI Music OS on top of the operations platform (WEB-OPT / WEB-OBS
/ WEB-OPS). **No real LLM or generative AI** — a rule-based / statistical engine over the existing
telemetry + store learning + track metadata, all **read-only**. Every output is a **Recommendation** or a
**Simulation** — the AI never auto-generates or auto-distributes a playlist and never executes an
operating policy.

> **Absolute constraints honored.** No production merge / deploy / migration apply. No change to Player /
> Playback / Queue / Crossfade / Recovery / Scheduler / Audio Output / existing Telemetry / Streaming
> Quality / Governance / settlement algorithm / ranking (exposure) algorithm / playlist-generation logic /
> store data. The AI is read-only. Base = `feat/web-ops-10-unified-operations` (PR #349). Production
> migration head remains **0453**; migration 0464 is validated but **not applied**.

## 1. Non-negotiable safety contract

- **Recommendation / Simulation only.** No engine or RPC queues, generates, deploys, or plays a playlist,
  and none executes an operating policy. Every recommendation is stamped `requiresApproval:true`,
  `automated:false`; every simulation carries `simulationOnly:true` (asserted by tests). The Discovery
  Pool is explicitly gated (Candidate → Pilot → Evaluation → Recommended Expansion → Approved → General)
  and never auto-distributes.
- **Read-only over existing data.** The 0464 RPCs only SELECT from `tracks`, `track_audio_features`,
  `track_ai_metadata`, `playback_events_v2`, `track_store_behavior_scores`, `store_track_reactions`,
  `business_profiles`, `audio_qc_reports`. No existing table/RLS/data/algorithm is modified; the new
  `ai_music_*` tables are isolated (renamed to avoid colliding with the pre-existing `ai_store_profiles`).
- **Rule-based, not a model.** Store/track profiles, compatibility, playlist intelligence, learning,
  the music director, recommendations, simulation and confidence are all named-threshold rules
  (`thresholds.ts`). AI confidence is a rule blend of evidence breadth, **capped at 94** — never
  certainty.
- **No fabrication.** Below the sample floors → INSUFFICIENT_DATA (store/track profiles, compatibility,
  simulation, confidence); a signal absent → NO_DATA. Seasonal / weather / holiday patterns are honest
  **NOT_AVAILABLE** rule placeholders (no such data this phase).
- **Server-verified & opt-in.** RPCs are super-admin gated (`_is_super_admin()`), security-definer,
  param-bound, row-capped. The master feature flag `VITE_AI_MUSIC_ENABLED` defaults **OFF** (opt-in).

## 2. Architecture

```
Existing music/store/learning data (READ-ONLY): tracks (+ track_audio_features, track_ai_metadata) ·
  playback_events_v2 · track_store_behavior_scores · store_track_reactions · business_profiles · audio_qc_reports
         ▼   0464 security-definer RPCs (super-admin · param-bound · SELECT) → engine input shapes
  admin_ai_store_list · admin_ai_store_aggregate · admin_ai_track_profiles · admin_ai_discovery (+ advisory writes)
         ▼   src/lib/aiMusic/*  (pure, rule-based engines — NO LLM)
  storeProfile · trackProfile · compatibility · playlistIntelligence · learning · director · recommendation · simulation · confidence · discovery
         ▼   aiMusicApi.getAiStoreIntelligence()  (composes the per-store bundle client-side)
         ▼   Admin "AI Music OS" tab (8 sub-tabs — READ-ONLY; recommendation/discovery snapshots are advisory only)
```

## 3. Rule Engine — engines (`src/lib/aiMusic/`, 19 unit tests)

| Engine | Feature | Degradation |
| --- | --- | --- |
| `storeProfile.ts` | **Store Intelligence Profile** (genre/mood/instrumental/vocal/energy pref, skip/completion/like/dislike, active hours) | < sample floor → INSUFFICIENT_DATA; seasonal/weather/holiday → NOT_AVAILABLE |
| `trackProfile.ts` | **Track Intelligence Profile** (genre/mood/energy/bpm bucket/time-of-day/industry suitability + replay/skip/completion perf + learning confidence) | perf NO_DATA below play floor |
| `compatibility.ts` | **Store ↔ Track Compatibility** (EXCELLENT/GOOD/ACCEPTABLE/WEAK/UNSUITABLE) | present-only components; INSUFFICIENT_DATA when store thin |
| `playlistIntelligence.ts` | **Playlist Intelligence** (diversity/fatigue/genre-mood-artist balance/energy curve/repeat/instrumental ratio) | < track floor → INSUFFICIENT_DATA |
| `learning.ts` | **Learning Engine** (skip/complete/like/dislike/replay → affinity) | < signal floor → INSUFFICIENT_DATA |
| `director.ts` | **AI Music Director** (static industry day-part rules — cafe/hospital/gym/winebar/…; NO LLM) | general fallback |
| `recommendation.ts` | **Recommendation Engine** (recommend/exclude track + genre/mood) | advisory; OBSERVE gate on low confidence |
| `simulation.ts` | **Playlist Simulation** (predict skip/completion/diversity/fatigue/compatibility) | SIMULATION ONLY; INSUFFICIENT below floor |
| `confidence.ts` | **AI Confidence** (sample/store history/track history/learning & signal coverage → HIGH/MEDIUM/LOW/INSUFFICIENT) | capped 94 |
| `discovery.ts` | **Discovery Pool** (gated stages, no auto-deploy) | INSUFFICIENT on thin pilot |

## 4. Storage & RPCs (`supabase/migrations/0464_ai_music_foundation.sql`)

Additive. Four isolated `ai_music_*` tables (`ai_music_store_profiles`, `ai_music_track_profiles`,
`ai_music_recommendations`, `ai_music_discovery_candidates`; RLS deny-all + super-admin read; writes only
via security-definer RPCs). Read RPCs aggregate REAL data into the engine input shapes:
`admin_ai_store_list`, `admin_ai_store_aggregate` (playback_events_v2 by `business_id` + tracks +
audio_features + reactions + business_type), `admin_ai_track_profiles` (tracks + audio_features +
`track_store_behavior_scores` lateral + `audio_qc_reports` lateral). Advisory write RPCs:
`upsert_ai_discovery_candidate`, `record_ai_recommendation` (record only — nothing deployed/played).
**Rollback = plain DROP.**

### Migration validation (never applied to production)

`0464` was validated against the **real production schema** inside a `BEGIN … ROLLBACK` transaction via
the Supabase MCP `execute_sql` (nothing persisted; `_obs_window_interval` created in-txn since 0455 isn't
in prod at head 0453; `_is_super_admin()` stubbed true). The complex track-profile joins returned **50
real tracks** (`tracks=50`); the store-aggregate join compiled (`store_agg.plays=0` — this preview DB has
sparse `playback_events_v2.business_id` data); discovery + recommendation writes succeeded
(`discovery=1 · rec=true`). A **collision check** caught that `ai_store_profiles` already exists (migration
0163); all four new tables were renamed to `ai_music_*`, and a follow-up rollback-txn confirmed the
existing `ai_store_profiles` RLS is **unchanged** (`relforcerowsecurity=false`, its original state). The
transaction aborted; a read confirmed the new tables/functions do not exist. **Production migration head
remains 0453 — 0464 is not applied.**

## 5. Dashboard (`AiMusicOsDashboard.tsx`)

Read-only super-admin tab "AI Music OS" — **master-flag gated (default OFF)**. Store selector + 8 sub-tabs:
**Stores** (profile), **Tracks** (profiles), **Compatibility** (ranked table), **Discovery** (gated pool
with advisory stage advance), **Recommendations** (advisory list + save snapshot), **Learning** (affinity
+ music-director plan), **Simulation** (predicted outcomes, simulation-only), **Confidence** (rule
breakdown). Tone-system only; loading / empty / error / NO_DATA / INSUFFICIENT_DATA handled.

## 6. Feature flags (`aiMusic/config.ts`, master default OFF)

`VITE_AI_MUSIC_ENABLED` (master, OFF), `VITE_AI_RECOMMENDATIONS_ENABLED`, `VITE_AI_SIMULATION_ENABLED`,
`VITE_AI_DISCOVERY_ENABLED`, `VITE_AI_LEARNING_ENABLED` — all default OFF (opt-in). A flag OFF only hides
AI-Music UI/analysis; it can never affect playback, the queue, playlist generation, settlement, ranking,
or any existing data.

## 7. Data safety

Player / Playback / Queue / Crossfade / Recovery / Scheduler / Audio Output / Streaming Quality /
Governance / Settlement / Ranking (exposure) / Playlist-generation logic / Store data are all **READ-only**
— `git diff` modifies no such existing file and no existing table/RLS/algorithm. The only destructive SQL
is on the new `ai_music_*` tables (RLS setup / revoke) or rollback comments; the only writes are advisory
snapshots into the new tables.

## 8. Rollback

Plain `DROP` of the 4 new tables + 6 new functions (documented in the migration footer). No existing
object is altered, so revert is clean.

## 9. Deferred work

- **Pilot completion/skip stats** for the Discovery evaluator are currently placeholder-estimated in the
  API until a per-candidate pilot-stats source is wired; the engine already accepts real pilot stats.
- **Artist-level balance** in Playlist Intelligence uses a genre proxy (`tracks.artist` is free text, not
  an artist id) — a true artist-balance metric is deferred.
- **Real-time learning writeback**: this phase only READS store learning; it does not write learning
  memory or change any learning/ranking algorithm.
- **Seasonal / weather / holiday** patterns are NOT_AVAILABLE rule placeholders (no data source yet).
- **Browser Runtime tests: NOT RUN** (no runtime Player surface); engines covered by 19 unit tests + the
  full suite (420). Any browser-only check is reported NOT RUN, never PASS.
- Not applied to production: no merge / deploy / migration apply; 0464 validated by rollback transaction
  only.
