# 04 — Runtime Contracts

> Machine-readable: `rpc-contracts.json`. Remote identity args are the authoritative contract; client wrappers must match.

The remote signatures use `p_`-prefixed named params matching the client wrapper conventions (`src/lib/siteNoticesApi.ts`, `siteSettingsApi.ts`, `supportInquiryApi.ts`, `trackAiPredictionsApi.ts`, `adminTrackApi.ts`, `clapCurationApi.ts`). Since the functions exist in Production and the UI calls them there without PGRST202 in production runtime, the client↔remote contract is presently satisfied in Production.

## Contract risks to verify during recovery
- **Named-arg alignment:** Supabase RPC matches by parameter name — the committed migration MUST preserve exact `p_*` names/types from Production (captured), or the client breaks.
- **Return shape:** several return large `TABLE(...)` sets (e.g. `get_admin_track_detail`, `admin_list_support_inquiries`); the TypeScript wrapper types must match the committed definition's columns.
- **Defaults/overloads:** no overloads observed (each name resolves to one signature); preserve any default args when porting.
- **Type mapping:** uuid/text/numeric/timestamptz/text[] all present — keep exact types (esp. `text[]` arrays in `admin_update_track_metadata_full`).

## Per-cluster contract source
- notices/settings → return `SETOF site_notices` / `site_settings` (row types) → the table row type must be recovered first.
- support → jsonb + TABLE with PII columns (contact_email/phone) → keep admin-gated.
- ai-predictions/admin-track → TABLE sets over `tracks` + `track_ai_predictions`.
- clap → TABLE sets over `clap_recommendations`/`playlist_centroids` (tables already present).

No client code change is required this phase; contracts are documented for the recovery migration.
