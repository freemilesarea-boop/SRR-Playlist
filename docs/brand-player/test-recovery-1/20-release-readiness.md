# 20 — Release Readiness

## Completion (§29) — key items
- [x] Test project confirmed / Production isolated / read-only Production inventory
- [x] Brand dependency graph; missing schema identified
- [x] Recovery migration 0455 authored + applied to Test
- [x] enterprise_accounts / brand_accounts / brand_player_sessions runtime
- [x] brand_media_assets / brand_music_policies / brand_signage_settings
- [x] _brand_signage_json / _brand_generate_playlist / verify_store_code / get_brand_player_config / brand_player_heartbeat
- [x] RLS enabled; anonymous / cross-user / cross-brand blocked; revocation; expiration; rate limit
- [x] Synthetic auth user / enterprise / brand / stores A&B / store codes / 15 tracks / logo+images+video
- [x] Store code→binding→config→playlist→signage→heartbeat→revoke→expiry runtime smoke PASS
- [x] Migration lint / Typecheck / ESLint / Unit 127 PASS; Build (no client change)
- [x] No Production DB change / no Production data copy / no secret / no PII output
- [ ] Browser QA — next phase (needs Vercel Preview bound to Test + QA user password)

## Verdict
`READY_FOR_PREVIEW_QA` — the Test backend now runs the full brand player flow (SQL-certified). Next: set the QA auth user password on the Test dashboard + bind a Vercel Preview to the Test env, then execute the browser + long-run runbooks from BRAND-PLAYER-PREVIEW-QA-2.
