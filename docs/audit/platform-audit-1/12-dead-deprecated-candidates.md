# 12 — Dead / Deprecated Candidate List

> PLATFORM-AUDIT-1 · READ-ONLY. **Nothing deleted this phase.** Candidates require confirmation + regression tests before any removal (separate DB-CLEANUP / CODE-CLEANUP phase).

## DB tables (0 src references)
| Symbol | Past purpose | Refs | Runtime reachable | Verdict | Before removal |
|---|---|---|---|---|---|
| `_x6_playlist_archive_snapshot` (0282) | one-off backfill snapshot | 0 | no | **DEAD** | confirm not read by any RPC |
| `_x6_schedule_fix_snapshot` (0282) | one-off backfill snapshot | 0 | no | **DEAD** | same |
| `signup_debug_events` (0022) | signup debugging | 0 | no | **DEAD/leftover** | confirm no trigger writes |
| `store_archetype_seed_candidates` (0171) | superseded seed | 0 | no | DEAD candidate | verify not seeded |
| `artist_settlements_v2`, `settlement_items_v2`, `settlement_generation_runs_v2`, `streaming_revenues_v2` (0420) | settlement V2 shadow | 0 | no (shadow) | **shadow — NOT dead until rollout decision** | confirm V2 rollout intent before touching |

## DB functions (defined, never called from `src`)
- **147 `_`-prefixed** internal/trigger helpers — expected, NOT dead (used inside other SQL / triggers).
- **123 non-underscore** — many server-only (cron/edge/trigger entry points), NOT dead. Genuine dead-endpoint candidates needing manual review (no caller found in src or SQL):
  `admin_backfill_audio_features`, `admin_cleanup_mismatched_placements`, `admin_find_mismatched_placements`, `admin_list_store_aliases`/`admin_upsert_store_alias`/`admin_delete_store_alias`, `admin_list_artist_invite_codes`/`admin_generate_artist_invite_code`, `admin_list_watch_uploaders`, `admin_list_worker_secret_keys`/`admin_set_worker_secret`, `admin_seed_contract_template`.
  → Verify no admin UI path or scheduled job calls these before deprecating. Full list: scratchpad `defined_not_called.txt` (agent output).

## Client RPC calls with no committed definition (inverse — potential dead OR out-of-band)
29 names (see `07-api-integration-audit.md` §C, R-03). Either the migrations were never committed (→ commit them) or the calls are dead (→ remove). **Do not assume dead** without live-DB check — several (support-inquiries, site-notices) look like live features.

## Deprecated / superseded code
| Symbol | Note | Verdict |
|---|---|---|
| `tools/embedding_worker/worker.py` (OpenL3) | deprecated 2026-05-31, model mismatch, no caller | **DEPRECATED** — safe to archive |
| `0231` placement auto-block (−1000) | rolled back to observe-mode by `0232` | superseded (kept for history) |
| Settlement V2 admin tabs (`settlement-v2`, `streaming-v2`) | superOnly, backed by 0-ref shadow tables | pending rollout decision |
| QC v1 noise thresholds | 100% false-positive, recalibrated in `0227` | superseded |

## Frontend files
- **No file-level dead code.** Only 4 unreferenced files, all legitimate entry points (`sw.ts`, `audioAnalysisWorker.ts`, `loudnessWorker.ts` via `new Worker(new URL())`, `test/setup.ts`). No action.
- Dead *exports within* files not exhaustively proven (low priority given file-level cleanliness).

## Duplicate candidates (consolidation, not deletion)
- 8 signup forms (`src/components/auth/*`) — high overlap.
- 4 overlays (Emergency/Announcement/GlobalStoreAudio/BrandPresentation).
- Scattered formatting utils (≥5 files) — no central module.
- 7+ settlement components.

## Summary
- **Confirmed DEAD (safe candidates):** 3 tables (`_x6_*`×2, `signup_debug_events`), 1 deprecated python worker.
- **Shadow / pending decision:** settlement V2 table set + tabs (do NOT remove without rollout call).
- **Needs live-DB verification:** 29 undefined client RPCs, ~13 uncalled admin RPCs.
- All removals deferred to a dedicated cleanup phase with regression coverage.
