# 06 — Migration Design (0455)

Idempotent & Production-safe:
- `create table if not exists` (no-op on Production, bootstraps Test); no data deletion; nullable new columns.
- `create or replace function` — verify_store_code/get_brand_player_config replaced with hardened bodies; helpers verbatim/functional.
- RLS enabled on all new tables (default deny + admin-read); anon blocked.
- Grants: revoke public/anon; authenticated on client RPCs; helpers definer-only (no client grant).
- search_path pinned on every SECURITY DEFINER function; safe fixed error tokens.
- verify_store_code gains an optional `p_device_label` (defaulted) → existing 1-arg client call unaffected.

Note: on Production a 1-arg verify_store_code exists; applying 0455 there later must DROP the 1-arg to avoid PostgREST overload ambiguity — documented for the production-apply phase. This phase is Test-only.
