# AI-MUSIC-3 — Adaptive Music Intelligence & Continuous Learning

Builds a rule-based **continuous learning loop** on top of AI-MUSIC-1 (foundation) and AI-MUSIC-2 (playlist
builder): it learns from **real operation data** (playback + reactions) to keep improving playlist scores,
track reputations, and drift over time — the *Adaptive Intelligence* layer. **No real LLM / reinforcement-
learning model** — a rule/statistical engine, all **read-only**. Every output is a **Recommendation**; the
AI never changes the real Player / Playback / Queue / Playlist / ranking / settlement until operator approval.

> **Absolute constraints honored.** No production merge / deploy / migration apply. No change to Player /
> Playback / Queue / Playlist / Ranking / Settlement / Streaming / Governance / existing data. The AI is read-
> only and produces recommendations only. Base = `feat/ai-music-2-playlist-builder` (AI-MUSIC-2, PR #351).
> Production migration head remains **0453**; migrations 0464 + 0465 + 0466 are validated but **not applied**.

## 1. Non-negotiable safety contract

- **Recommendation only.** The loop recommends the next playlist score, track reputation, expansion stage,
  and drift; it never applies them. Every result is stamped `requiresApproval:true` / `automated:false`
  (loop + discovery expansion), and persisted rows are advisory snapshots for operator review.
- **Read-only over existing data.** The 0466 RPCs only SELECT from `playback_events_v2`,
  `store_track_reactions`, `track_store_behavior_scores`, `tracks`. No existing table/RLS/data/algorithm is
  modified; the new `ai_*` tables are isolated.
- **Rule-based, not a model.** Reinforcement (reward/penalty), adaptive score, reputation, evolution,
  exploration, discovery expansion, seasonal/time/industry learning, drift, and explainability v2 are all
  named-threshold rules (`aiLearning/thresholds.ts`).
- **No fabrication.** Below the sample floors → INSUFFICIENT_DATA; a signal absent → NO_DATA. Seasonal /
  time learning show INSUFFICIENT_DATA when no segment source is wired (honest — no fabricated season verdict).
- **Server-verified & opt-in.** RPCs are super-admin gated (`_is_super_admin()`), security-definer,
  param-bound, row-capped. Flags `VITE_AI_LEARNING_ENGINE_ENABLED` / `..._REPUTATION_ENABLED` /
  `..._ADAPTIVE_ENABLED` / `..._PLAYLIST_HISTORY_ENABLED` default **OFF**, behind the AI-MUSIC master flag.

## 2. Architecture — the loop

```
Store → Playlist(AI-MUSIC-2) → Playback → Reaction → Learning → Next Playlist
                                   │ (READ-ONLY real data)
                                   ▼   0466 RPCs (super-admin · param-bound · SELECT)
  admin_ai_learning (reward/penalty signals) · admin_ai_track_reputation (behavior scores) ·
  admin_ai_playlist_history · admin_ai_drift · admin_ai_adaptive_score (+ advisory record RPCs)
                                   ▼   src/lib/aiLearning/* (pure, rule-based — NO LLM/RL)
  reinforcement · adaptiveScore · reputation · evolution · exploration · discoveryExpansion ·
  seasonal/time/industry learning · drift · explainV2 · learningLoop
                                   ▼   aiLearningApi (compose client-side)
                                   ▼   Admin "AI Adaptive Learning" tab (7 sub-tabs — READ-ONLY, advisory snapshots)
```

## 3. Engines (`src/lib/aiLearning/`, 28 unit tests)

| Engine | Feature (task) | Degradation |
| --- | --- | --- |
| `reinforcement.ts` | **Reinforcement Rules** (3) — reward = complete/like/long-session, penalty = skip/dislike/repeat-fatigue → net | < play floor → INSUFFICIENT_DATA |
| `adaptiveScore.ts` | **Adaptive Playlist Score** (2) — EMA-smoothed step: Yesterday → Today → Next + trend | < signal floor → INSUFFICIENT_DATA |
| `reputation.ts` | **Track Reputation** (4) — Excellent / Good / Weak / **Recovering** (weak→up) | < play floor → NO_DATA |
| `evolution.ts` | **Playlist Evolution** (5) — V1 → Vn + per-version delta + trend | < 2 versions → INSUFFICIENT_DATA |
| `exploration.ts` | **Exploration vs Exploitation** (6) — 80% best / 20% discovery split | ratio clamped to bounds |
| `discoveryExpansion.ts` | **Discovery Expansion** (7) — Pilot → Small → Medium → Large → Global (approval-gated) | < play floor → INSUFFICIENT_DATA |
| `segmentLearning.ts` | **Seasonal / Time / Industry learning** (8/9/10) — per-segment summary + best segment | no segment source → INSUFFICIENT_DATA |
| `drift.ts` | **Playlist Drift** (11) — TV-distance of genre/mood/energy from the original intent → LOW/MEDIUM/HIGH | nothing comparable → INSUFFICIENT_DATA |
| `explainV2.ts` | **Explainability v2** (12) — 8 factors (Genre/Mood/Energy/Learning/Discovery/Industry/Time/Confidence) | absent signal → NO_DATA |
| `learningLoop.ts` | **Continuous Learning** (1) — reinforcement → adaptive score → next-recommendation score | INSUFFICIENT_DATA below floors |

## 4. Storage & RPCs (`supabase/migrations/0466_ai_learning_engine.sql`)

Additive. Four isolated tables (`ai_playlist_versions`, `ai_learning_history`, `ai_track_reputation`,
`ai_playlist_drift`; RLS deny-all + super-admin read; writes only via security-definer RPCs). Read RPCs:
`admin_ai_learning` (reward/penalty aggregation from `playback_events_v2` + reactions), `admin_ai_track_reputation`
(completion/skip/like/replay from `track_store_behavior_scores`), `admin_ai_playlist_history`, `admin_ai_drift`,
`admin_ai_adaptive_score`. Advisory writes: `record_ai_playlist_version`, `record_ai_learning_snapshot`,
`record_ai_track_reputation`, `record_ai_playlist_drift`. **Rollback = plain DROP.**

### Migration validation (never applied to production)

`0466` was validated against the **real production schema** inside a `BEGIN … ROLLBACK` transaction via the
Supabase MCP `execute_sql` (nothing persisted; `_is_super_admin()` stubbed true). All 9 RPCs exercised OK:
`learn_ok=true · rep_count=100` (real tracks via the behavior-scores lateral) `· version/snapshot/reputation/drift
record all ok · history/drift/adaptive reads =1 each` (`learn_plays=0` — the preview DB has sparse
`playback_events_v2.business_id` data, same as AI-MUSIC-1/2). No table-name collisions; a follow-up read
confirmed the 4 tables / 9 functions do not exist and `_is_super_admin()` is unchanged. **Production migration
head remains 0453 — 0464 + 0465 + 0466 are not applied.**

## 5. Dashboard (`AiAdaptiveLearningDashboard.tsx`)

Read-only super-admin tab "AI Adaptive Learning" — **master-flag gated (default OFF)**. Store selector +
prior-score / month / hour controls + 7 sub-tabs: **Learning** (reinforcement → adaptive Yesterday→Today→Next +
save snapshot + saved history), **Evolution** (V1→Vn), **Drift** (persisted drift), **Discovery**
(exploration 80/20 + expansion ladder), **Reputation** (Excellent/Good/Weak/Recovering over real behavior
scores + save), **Seasonal** (season/day-part rule mapping, INSUFFICIENT_DATA honest), **Explainability**
(8-factor). Tone-system only; loading / empty / INSUFFICIENT_DATA / NO_DATA handled; every persist is advisory.

## 6. Feature flags (`aiLearning/config.ts`, all default OFF)

`VITE_AI_LEARNING_ENGINE_ENABLED`, `VITE_AI_REPUTATION_ENABLED`, `VITE_AI_ADAPTIVE_ENABLED`,
`VITE_AI_PLAYLIST_HISTORY_ENABLED` — all default OFF, behind the AI-MUSIC master flag `VITE_AI_MUSIC_ENABLED`
(also OFF). A flag OFF only hides learning UI/analysis; it can never affect playback, the queue, real playlist
generation, ranking, settlement, streaming, or any existing data.

## 7. Data safety

Player / Playback / Queue / Playlist / Ranking (exposure) / Settlement / Streaming / Governance / Store data
are all **READ-only** — `git diff` modifies no such existing file (the only existing file touched is
`AdminPage.tsx`, an additive 8-line tab wiring) and no existing table/RLS/algorithm. The only destructive SQL
is on the new `ai_*` tables (RLS setup / revoke) or rollback comments; the only writes are advisory snapshots.

## 8. Rollback

Plain `DROP` of the 4 new tables + 9 new functions (documented in the migration footer). No existing object is
altered, so revert is clean.

## 9. Deferred work

- **Seasonal / Time / Industry learning** aggregates are not wired to a server source yet (the engines accept
  real per-segment aggregates); the dashboard shows INSUFFICIENT_DATA honestly until a segment source lands.
- **Playlist Evolution / Drift** populate as AI-MUSIC-2 proposals are recorded as versions and drift snapshots
  over time; empty until snapshots exist.
- **Explainability v2** full 8-factor (Genre/Mood/Energy/Industry/Time) is produced per-pick in the AI Playlist
  Builder; the learning tab shows Learning/Confidence from reputation and marks the rest NO_DATA.
- **Applying a learned score** to a real playlist is intentionally out of scope — the loop only recommends;
  any real change requires a separate operator-approval + apply path (future phase), never automatic.
- **Browser Runtime tests: NOT RUN** (no runtime Player surface); engines covered by 28 unit tests + the full
  suite (468). Any browser-only check is reported NOT RUN, never PASS.
- Not applied to production: no merge / deploy / migration apply; 0466 validated by rollback transaction only.
