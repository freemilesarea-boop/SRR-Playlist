# AI-MUSIC-6 — Shadow Playlist Resolution & Runtime Certification (Preview)

> Phase status: **Preview only.** Nothing here is merged to production, deployed, or applied to the production
> database. Migration `0469` is **validated but NOT applied** — the production migration head stays `0453`. All
> feature flags default **OFF**. Rule-based (no LLM/ML, no external experiment SaaS, no new WebSocket).

## 1. What this phase is

Computes what a store *would* resolve to under a pilot override **in parallel** with the authoritative existing
resolution, compares the two, and **certifies runtime-integration readiness** — WITHOUT ever changing the real
playlist, queue, or playback. The existing result is always used for actual playback; the shadow result is
analysis/log/dashboard only. Every shadow failure **fails open** to the existing result. No runtime integration
and no canary is performed (readiness caps at `READY_FOR_MANUAL_CANARY_REVIEW`; no canary is ever started).

## 2. Existing resolution audit (traced from code)

There is **no single unified resolver**. Two engines both mutate one shared client-side `usePlayerStore` queue,
mounted on different pages:

```
Store Session (storeId = auth.user.id; no stores table — business-plan user.id IS the store id)
  ├─ /business      → useBusinessAutoSwitch → getCurrentSchedule (earliest active time-matched)
  │                    → fetchPlaylistTracks(playlistId, storeId) → setQueue        [SCHEDULE]
  │                    fallback: findFallbackPlaylist(business_category, daypart)    [FALLBACK]
  └─ /store/player  → useFranchisePolicySync → get_store_active_music_policy
                       (60s poll; applied immediately on entry, else at next track boundary; fail-open)
                       → matched_slot.playlist_id → setQueue                          [BRAND_ENTERPRISE]
```

- **Precedence (as coded):** on `/store/player` the franchise policy is layered last and effectively wins
  whenever a policy exists; otherwise the business-schedule queue stands. There is no code that ranks the two
  engines — franchise wins by being applied on the player page.
- **Queue is client-side** (`playerStore.setQueue`, daily-seeded shuffle). **No playlist-content version
  exists** — the only `version_number` is the franchise *policy-assignment* version, not a track-set version.
- **Attribution:** `store_id = auth.user.id` (= `auth.uid()` server-side); `player_session_id` exists only in
  the telemetry layer, not the resolver. Refresh re-applies the franchise policy immediately on mount.

## 3. Shadow architecture

- **Resolver contract** (`types.ts`): a captured `ExistingResolution` (authoritative) + the store's pilot
  binding form the `ShadowResolverInput`; the output is a `ShadowResolution` with source/version/reason/flags.
- **Shadow resolver** (`shadowResolver.ts`): takes the finalized existing result as the base and **only overlays
  a valid, version-pinned, live treatment override**. It does NOT re-resolve schedule/franchise/fallback (the
  real resolver already decided that). Priority: `valid treatment override → existing result`.
- **Fail-open**: control store, no assignment, flag off, conflict, non-active override, expiry, missing
  candidate, version mismatch, or any shadow error → returns the **existing** result.
- **Divergence** (`divergence.ts`): `SAME_RESULT / EXPECTED_TREATMENT_DIVERGENCE /
  UNEXPECTED_CONTROL_DIVERGENCE(critical) / VERSION_MISMATCH / CANDIDATE_MISSING / POLICY_CONFLICT /
  SCHEDULE_CONFLICT / ASSIGNMENT_CONFLICT / EXPIRED_OVERRIDE / RESOLVER_ERROR / UNKNOWN`. `actualPlaylistUnchanged`
  is an invariant on every result.
- **Events** (`events.ts`): low-frequency, privacy-safe — only FNV-1a hashes of ids. Never titles, track lists,
  audio URLs, artist names, PII, raw stacks, raw queries, or tokens.

## 4. Certification & readiness

- **Control preservation**: a single control divergence → `FAIL` → certification `BLOCKED`.
- **Treatment eligibility**: approval/assignment/version-pin/candidate/override/expiry/conflict/rollback/
  existing-fallback/queue/track-RPC checks → `READY / REVIEW_REQUIRED / BLOCKED`.
- **Fail-open certification**: 17 synthetic failure cases must all preserve the existing result.
- **Coverage**: `SUFFICIENT / PARTIAL / LOW / NO_DATA / INSUFFICIENT_DATA` by session count.
- **Certification score** (0..100, advisory): weighted (control preservation dominant); components with **no
  data are excluded, not zeroed** (weights renormalized); a control divergence or fail-open failure or resolver
  error-rate breach → `BLOCKED`; thin evidence → `INSUFFICIENT_DATA`. **100 never means real playback success.**
- **Integration readiness**: `NOT_READY / SHADOW_ONLY / READY_FOR_PREVIEW_RUNTIME_TEST /
  READY_FOR_MANUAL_CANARY_REVIEW / BLOCKED / INSUFFICIENT_DATA` — capped at `READY_FOR_MANUAL_CANARY_REVIEW`;
  `actualCanaryStarted:false` always.

## 5. Runtime hot-path safety & the shadow hook

A safe hook point was **proven** by the audit: a new isolated `useEffect` keyed on the resolved playlist id,
running after the existing resolver finalizes. Implemented as `useShadowResolutionProbe` and mounted in
`StorePlayerPage` beside the existing WEB-OBS-6 telemetry hooks (same fail-open, flag-gated pattern):

- No `await` in the render/playback path — synchronous effect body; ingest is fire-and-forget and swallows
  every error.
- Does not change `setQueue` inputs, the queue, the resolved playlist, existing dependency arrays, polling, or
  timeouts — it adds only a brand-new isolated effect.
- Hard-gated (master + resolution flag on, kill switch off, ingest flag on — all default OFF), so in
  prod/default it returns immediately: **zero network, zero behavior change**. UI-side sampling limits volume.
- Runtime pilot-binding lookup is not wired this phase, so the probe records the observed existing resolution
  (no-assignment) only — it never overlays a candidate and never affects playback.

## 6. Database / RPC (0469, NOT applied)

3 isolated tables — `ai_music_shadow_sessions`, `ai_music_shadow_resolution_events` (hash-only),
`ai_music_shadow_certifications` — + 7 SECURITY DEFINER functions. The migration does not even READ base
tables. `ingest_ai_shadow_resolution_events` is callable by `authenticated`, attributes every row to
**`auth.uid()`** (never a client-supplied store id), batch-caps at 50, and allowlists the divergence type.
Admin reads (`overview/sessions/divergences/trace/certification`) and `record_ai_shadow_certification` are
super-admin gated with row/time caps; readiness is clamped to the allowed set. `search_path` pinned, params
bound, no dynamic SQL. RLS super-admin read; writes via RPC only. Rollback SQL is in the migration footer.

## 7. Feature flags (all default OFF)

| Env var | Controls |
|---|---|
| `VITE_AI_MUSIC_ENABLED` | Master (inherited) |
| `VITE_AI_SHADOW_RESOLUTION_ENABLED` | Shadow evaluation |
| `VITE_AI_SHADOW_EVENT_INGEST_ENABLED` | Decision-event ingestion |
| `VITE_AI_SHADOW_CERTIFICATION_ENABLED` | Certification snapshot recording |
| `VITE_AI_SHADOW_DASHBOARD_ENABLED` | Runtime Certification dashboard visibility |
| `VITE_AI_SHADOW_SAMPLING_RATE` | Fraction of eligible sessions evaluated (default 0.1) |
| `VITE_AI_SHADOW_KILL_SWITCH` | ON → disable shadow evaluation only (existing resolution untouched) |

The kill switch (or any gate OFF) disables ONLY shadow evaluation/UI — it can never change the real playlist
resolution, queue, playback, ranking, or settlement.

## 8. Privacy & query cost

Events store hashes only (store/session/playlist) — no titles/tracks/URLs/PII/stacks/queries/tokens. Batch cap
50/ingest; admin reads capped at 500 rows / 90 days; indexes on `(store_uid, evaluated_at)`,
`(session_hash, evaluated_at)`, `(divergence_type, evaluated_at)`, `experiment_id`. Store/session counts are
unknown, so no traffic/cost totals are fabricated; sampling + retention are provided as controls.

## 9. Migration validation (rollback-transaction, NOT applied)

`BEGIN … stub _is_super_admin + set_config JWT sub … exercise … RAISE 'VALIDATION_OK' … (abort)`:

```
VALIDATION_OK :: ingested=8 sessions=6 badDiv=UNKNOWN readiness=READY_FOR_MANUAL_CANARY_REVIEW capOk
```

- all 8 events attributed to `auth.uid()` (0 rows with a different store_uid)
- bogus divergence coerced to `UNKNOWN`; session upsert counters correct
- overview aggregates correct (8 evals / 6 sessions / 1 resolver error / 0 control divergence)
- batch cap enforced (60 → 50); invalid status/readiness coerced

Post-abort read confirmed **0 tables and 0 functions persisted** and the real `_is_super_admin` intact.

## 10. Data safety

Diff touches only `src/lib/aiShadow/*`, `src/lib/api/aiShadowApi.ts`, `src/hooks/useShadowResolutionProbe.ts`,
`AiRuntimeCertificationDashboard.tsx`, `src/pages/AdminPage.tsx` (additive tab wiring), `src/pages/
StorePlayerPage.tsx` (import + one isolated hook call, no existing lines modified), and `0469_*.sql`. **No**
`Player.tsx`, `playerStore`, `useFranchisePolicySync`, `useBusinessAutoSwitch`, `get_playlist_tracks`,
crossfade/preload/recovery/scheduler, `setQueue` inputs, ranking, settlement, service worker, or CDN config is
changed. The actual playlist resolution result and the queue input are unchanged.

## 11. Deferred runtime integration

Live pilot-binding lookup, production canary, actual pilot rollout, and automatic guardrail action are **out of
scope** and deferred. This phase produces the shadow layer + certification + a dormant, proven-safe probe only.

## 12. Verification

- `npm run build` (lint + `tsc -b` + vite) — clean · `npm run lint:tones` — clean · `npm run lint:migrations` — clean
- `npx vitest run src/lib/aiShadow/` — 38 tests pass
- Rollback-txn validation vs production — `VALIDATION_OK`, nothing persisted
- Browser runtime: **NOT RUN** (Preview manual QA only — the probe is flag-gated OFF; actual playlist must be
  verified unchanged during manual QA before any flag is enabled)
