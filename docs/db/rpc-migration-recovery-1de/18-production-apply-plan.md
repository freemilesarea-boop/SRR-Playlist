# 18 — Production Apply Plan (NOT executed this phase)

Production apply is deferred to a dedicated phase (`RPC-PRODUCTION-APPLY-1`). This is the prepared runbook. **No Production change was made in RPC-MIGRATION-RECOVERY-1DE.**

## Preflight
1. Confirm target ref = Production (`nso…zvol`), not Test.
2. Snapshot current `pg_get_functiondef` of the 7 readers (rollback source).
3. Confirm the 13 functions + `ai_metadata_corrections` + `artist_lifetime_streams` + `playlists.auto_attach_*` **already exist** in Production → tables/columns are baseline no-ops.
4. Hash-compare the 6 writes (repo vs Production) → expect identical → no change.

## Changes to apply
- `CREATE OR REPLACE` the **7 readers** (plpgsql + admin guard; `list_clap_recommendations` with output casts) — security correction.
- Writes / helpers / tables / columns: **no change** (already match; re-assert is a no-op).

## Grant correction (Production)
- `revoke all … from public` + `grant execute … to authenticated` for the 7 readers; confirm **no anon** on all 15 functions.
- Optionally tighten the recovered tables' grants (Production currently grants anon+authenticated full CRUD; recovery target is authenticated SELECT only) — **stage as a separate, reviewed grant-tightening step** since it changes existing Production table ACLs.

## RLS / policy
Verify RLS + policies on `ai_metadata_corrections` (admin_read) and `artist_lifetime_streams` (admin_read, self_read) exist in Production (they do); no change needed.

## Apply order
1. Preflight snapshots. 2. `CREATE OR REPLACE` 7 readers. 3. Reader grant correction. 4. (staged) table grant tightening. 5. RLS/policy verify. 6. Smoke tests. 7. Grant re-verify.

## Lock risk
`CREATE OR REPLACE FUNCTION` locks the function only; no table rewrite. Negligible.

## Rollback
Re-apply snapshotted prior reader defs + original grants. Writes/tables/columns untouched.

## Smoke tests (Production, non-destructive)
- User smoke: an artist reads own `artist_lifetime_streams` row (self_read).
- Admin reader smoke: admin calls each of the 7 readers → returns; non-admin → `unauthorized`.
- Admin write smoke: verify guard on writes (do **not** run destructive purge/delete on real data; use a reversible/guarded probe).
- Playlist/curation smoke: `list_clap_curation_playlists` returns; `set_playlist_auto_attach` toggles a test playlist (revert after).
- Exposure check: reader output carries no raw payload/actor.

## Sequencing
Run in `RPC-PRODUCTION-APPLY-1`, combining all clusters' reader security corrections + grant tightening into one reviewed Production change window.
