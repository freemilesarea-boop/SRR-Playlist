# 07 — Admin Security Hardening

## Over-exposed readers fixed (7)
All were, in Production, `SECURITY DEFINER` + `language sql` + granted to `authenticated` with **no in-function admin check** → any logged-in user could read internal admin/QC/curation data (RLS bypassed by DEFINER). These are the remaining 7 of the 10 P2 over-exposed readers from DB-SCHEMA-RECONCILIATION-1 (3 fixed in Clusters A/C).

| Reader | Cluster | Fix |
|---|---|---|
| get_admin_track_detail | D | plpgsql + admin guard |
| list_admin_tracks_with_ai | D | plpgsql + admin guard |
| ai_correction_stats | D | plpgsql + admin guard |
| list_severe_metadata_mismatches | D | plpgsql + admin guard |
| list_clap_curation_playlists | E | plpgsql + admin guard |
| list_clap_recommendations | E | plpgsql + admin guard + explicit output casts |
| list_clap_auto_approved | E | plpgsql + admin guard |

## Controls applied (all 7)
- Admin check (`auth.uid()` + `users.role='admin'`) **before any row access**.
- Unauthorized → `raise exception 'unauthorized'` (zero rows/columns returned).
- Return column list byte-identical to Production (contract preserved).
- Numeric `p_limit` cap; server-fixed stable ordering; no dynamic SQL; no user-controlled sort/filter string.

## Admin writes (6) — verified guard present
Each begins with the identical admin guard and derives actor from `auth.uid()`. `admin_purge_all_tracks` additionally requires an exact confirm token (`DELETE_ALL_TRACKS`). No client-supplied actor id is accepted anywhere.

## Verification
On Test, all 15 functions report `plpgsql`, `secdef=true`, `search_path=public`, **anon execute = false**; the 13 client RPCs grant `authenticated`, the 2 internal helpers grant no client role. See `11-test-schema-certification.md`.
