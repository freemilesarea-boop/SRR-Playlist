# 11 — Test Schema Certification

Applied `0460` (Cluster D) + `0461` (Cluster E) to Test (`hao…qorr`).

## Functions (15) — verified
All report `language plpgsql`, `secdef=true`, `search_path=public`, **anon execute = false**.

| Function | auth execute |
|---|---|
| 13 client RPCs (D+E) | yes |
| `_log_ai_correction`, `snapshot_artist_lifetime_streams` | **no** (internal) |

Signatures/returns match Production identity args; the 7 readers are plpgsql (was sql) — the intended security correction. No unexpected overloads.

## Tables — verified
| Table | cols | RLS | policies |
|---|---|---|---|
| ai_metadata_corrections | 10 | on | ai_corrections_admin_read |
| artist_lifetime_streams | 9 | on | alstreams_admin_read, alstreams_self_read |
| playlists (+2 cols) | +auto_attach_enabled, +auto_attach_threshold | unchanged | — |

FKs (track_id→tracks CASCADE, corrected_by→users, artist_user_id→users CASCADE), indexes (`ai_corrections_field_idx`, `ai_corrections_track_idx`, PKs) present.

## Repo / Test / Production comparison
- **Repo:** now defines all 13 RPCs + 2 dep tables + 2 helpers + 2 playlists columns (`0460`/`0461`).
- **Test:** matches repo (applied + verified).
- **Production:** all present; the 7 readers differ **intentionally** (Prod = sql/no-guard; Repo/Test = plpgsql/guarded); `list_clap_recommendations` has added output casts; writes/tables/columns match 1:1. Delta = the staged security correction (`18`).
