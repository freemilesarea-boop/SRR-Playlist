# 06 — Test Schema Certification

## Cluster A (applied)
Verified on Test `hao…qorr` via read-only metadata:
- **Tables:** `site_notices`, `site_settings` exist, **RLS enabled** (both).
- **Functions (7):** all exist; identity args **match Production**:
  - `get_site_settings()` → grants `anon,authenticated`
  - `list_active_site_notices()` → grants `anon,authenticated`
  - `admin_list_site_notices()` → `authenticated` (+ internal admin guard)
  - `admin_upsert_site_notice(uuid,text,text,boolean,text,text,timestamptz,timestamptz,integer,boolean)` → `authenticated`
  - `admin_toggle_site_notice(uuid,boolean)`, `admin_delete_site_notice(uuid)`, `admin_update_site_settings(boolean,boolean,text,text)` → `authenticated`
- **Security fix functionally verified:** non-admin call to `admin_list_site_notices` raises `unauthorized`; public reader callable.
- **Repository ⇄ Test:** match for Cluster A. **Repository ⇄ Production:** contract (signature/return) matches; security-fixed reader is an **intended drift** (repo/Test stricter than current Production until prod apply).

## Clusters B–E
Not applied → **not certified** on Test (definitions captured only). Do not report as matched.
