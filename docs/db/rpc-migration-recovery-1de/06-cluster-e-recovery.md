# 06 — Cluster E Recovery (`0461`)

Backing tables (`clap_recommendations`, `playlists`, `playlist_tracks`, `playlist_centroids`) already exist in Test/repo — only functions + two Production-only `playlists` columns recovered.

## Column recovery (Production-only drift on `playlists`)
- `auto_attach_enabled boolean not null default true`
- `auto_attach_threshold numeric not null default 65.00`

Written by `set_playlist_auto_attach`, read by `list_clap_curation_playlists`. Added via `add column if not exists` (matches Production types/defaults/nullability).

## Readers (security-fixed: `sql`→`plpgsql` + admin guard, contract preserved)
- `list_clap_curation_playlists()` → table(10) — per-playlist curation overview (track/centroid/pending/auto-approved counts + auto-attach config), released playlists only.
- `list_clap_recommendations(uuid, integer default 20)` → table(20) — pending CLAP recs for a playlist, by total_score desc. **Explicit casts** `t.duration::numeric`, `t.energy_level::text` added to satisfy the declared return contract against Test's integer columns (return types unchanged).
- `list_clap_auto_approved(integer default 50)` → table(14) — auto-approved attachments, by reviewed_at desc.

## Writes (verbatim — already admin-guarded)
- `rollback_clap_auto_attach(uuid)` → void — validates rec exists + status `auto_approved`; detaches from `playlist_tracks`; sets status `rejected`, `reviewed_by=auth.uid()`. Curation logic unchanged.
- `set_playlist_auto_attach(uuid, boolean, numeric)` → void — validates threshold 0–100; updates the two playlist columns.

## Grants
`revoke all from public` on all 5; `authenticated` execute; **no anon**. No CLAP scoring / recommendation / playlist-ordering logic altered.
