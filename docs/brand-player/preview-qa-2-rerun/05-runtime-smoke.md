# 05 — Runtime Smoke

## Backend runtime smoke: PASS (SQL, prior phase; re-verified this phase)
On Test: brands 2, stores 2, tracks 15, media 4, `_brand_generate_playlist` → 15, QA user present, verify_store_code + get_brand_player_config present. Full flow (code→binding→config→playlist→signage→heartbeat→revoke→expiry→cross-user/brand→rate-limit) = 19/19 PASS (docs/brand-player/test-recovery-1/15-runtime-smoke.md).

## Browser/HTTP runtime smoke: BLOCKED
Requires a deployed Test-bound Preview (03/04). When available: HTTP 200, login page, `[SupabaseEnv]`=hao…qorr, Network host = hao…qorr only (never nso…zvol), no console errors.
