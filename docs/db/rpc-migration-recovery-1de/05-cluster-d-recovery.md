# 05 — Cluster D Recovery (`0460`)

## Dependency objects (Production-only, recovered for Test)
- **Table `ai_metadata_corrections`** (10 cols): id PK, track_id FK→tracks CASCADE, field_name, ai_value, artist_value, admin_value (NN), ai_confidence numeric(4,3), prediction_model, corrected_by FK→users, corrected_at NN default now(). Indexes: `(field_name, corrected_at desc)`, `(track_id)`. RLS + `ai_corrections_admin_read`.
- **Table `artist_lifetime_streams`** (9 cols): artist_user_id PK FK→users CASCADE, total/completed/eligible_payout streams bigint, total_listened_seconds bigint, first/last_streamed_at, last_snapshotted_at NN default now(), notes. RLS + `alstreams_admin_read` + `alstreams_self_read`.
- **`_log_ai_correction(...)`** — internal insert helper (no admin guard by design; no client grant).
- **`snapshot_artist_lifetime_streams()`** — admin-guarded aggregate of `stream_events` → `artist_lifetime_streams` (no settlement calc changed; verbatim).

## Readers (security-fixed: `sql`→`plpgsql` + admin guard, contract preserved)
- `get_admin_track_detail(uuid)` → table(60) — full admin detail joining `track_ai_predictions`.
- `list_admin_tracks_with_ai(integer default 1000)` → table(18) — non-hidden, non-removed, newest first.
- `ai_correction_stats()` → table(7) — per-field AI-vs-admin accuracy aggregate over `ai_metadata_corrections`.
- `list_severe_metadata_mismatches(integer default 100)` → table(10) — mood/genre-vs-AI mismatch QC queue.

## Writes (verbatim — already admin-guarded)
- `admin_hard_delete_track(uuid)` → table(6) — **revenue-safe**: if `settlement_items`/`streaming_revenues` reference the track, soft-hide (preserve revenue) else hard delete; returns storage refs for cleanup.
- `admin_purge_all_tracks(text)` → table(5) — requires `p_confirm='DELETE_ALL_TRACKS'`; snapshots lifetime streams first; loops `admin_hard_delete_track`.
- `admin_update_track_metadata_full(uuid, 25 optional)` → void — coalesce-update; logs AI corrections via `_log_ai_correction`. Validates energy 1–5, bpm 0–400.
- `bulk_delete_severe_mismatches(numeric default 0.6, integer default 100)` → table(2) — deletes high-confidence QC mismatches via `admin_hard_delete_track`.

## Grants
`revoke all from public` on all 10 functions; `authenticated` execute on the 8 client RPCs; **no grant** on the 2 internal helpers; **no anon**. Tables: `authenticated` SELECT only (RLS-filtered).
