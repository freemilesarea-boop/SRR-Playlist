# 08 — Ownership / Subject Isolation

## Applicability
None of the 13 RPCs is user- or owner-facing — all are admin operations on globally-shared, admin-moderated objects (tracks, playlists, CLAP recommendations). The isolation boundary for the RPCs is **admin vs everyone else**, enforced by the in-function admin guard.

## The one ownership surface: `artist_lifetime_streams`
This recovered dependency table carries per-artist stream aggregates and is directly readable (RLS-filtered), not just via admin RPCs:
- `alstreams_self_read` (SELECT): `artist_user_id = auth.uid()` → each artist sees only their own row.
- `alstreams_admin_read` (SELECT): admin sees all rows.
- No INSERT/UPDATE/DELETE policy and no direct write grant → writes only via `snapshot_artist_lifetime_streams` (definer, admin).

`ai_metadata_corrections` is admin-only (`ai_corrections_admin_read`); no self/owner exposure.

## Enforced properties (verified)
1. Caller authenticated (`auth.uid()` non-null) — anon has no table grant → denied.
2. Actor server-derived; client `user_id`/`actor_id` never trusted (no such param).
3. Non-owner cannot read another artist's lifetime streams (RLS row filter).
4. Admin sees all via the admin policy.
5. Internal admin fields (audit actors, raw corrections) never surface in any user path (there is no user path for the corrections table).

## Verification
`12-sql-security-tests.md`: as `authenticated` userB → 1 row, `only_own=true`; as admin → all rows; as anon → permission denied (no grant). Ownership column source is Production's real schema (`artist_user_id`), not assumed.
