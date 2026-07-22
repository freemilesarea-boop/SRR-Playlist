# BRAND-PLAYER-PREVIEW-QA-2 — Executive Summary

> Branch `claude/brand-player-preview-qa-2` from `claude/brand-device-binding-1` (`9358d5e`).
> **Status: `BLOCKED`.** No Production change; no deploy; no Test DB mutation this phase.

## Why BLOCKED (multiple of the phase's own stop-triggers are met)
This phase requires a Vercel Preview **bound to the Test Supabase project**, real Chrome/Safari/Edge browser QA, and 30 min–2 hr long-run playback. In this environment none of these can be done, and — critically — **the Test project cannot run the end-to-end brand player flow at all**:

1. **Player backend absent from Test.** On Test (`hao…qorr`) `verify_store_code` = **absent**, `get_brand_player_config` = **absent**, and the whole config subsystem (`_brand_generate_playlist`, `_brand_signage_json`, `brand_media_assets`, `brand_music_policies`, `brand_signage_settings`) = **absent**. Only the binding-verification RPCs from `0454` exist. So store-code entry → binding creation → config load → playback **cannot execute** against Test. (Test is a curated settlement+recovery replica; the brand product is Production-only drift.)
2. **No Test-bound Preview possible.** I cannot set Vercel Preview env vars to the Test URL + Test anon-key pair (operator-controlled; the Test anon key is not available here). Deploying with the project's current env risks pointing at the Production host `nso…zvol` — a **P0** the phase forbids — so no deploy was attempted.
3. **No real browsers / no long-run.** Safari and Edge cannot be driven here; even Chromium QA needs a working Test-bound preview + a loginable synthetic brand account + the config RPCs — none present. 30 min–2 hr sessions cannot be run.
4. **No loginable synthetic brand account.** Seeding a brand/enterprise auth user (with a password to log in through the preview) needs admin/service-role seeding, and the store-code + config RPCs it would drive are absent.

Per the phase: "Preview 배포 불가 / Preview 환경변수 변경 권한 없음 / Browser 실행 불가 / Test Synthetic Account 없음 → 즉시 중단하고 BLOCKED로 보고한다."

## What IS certified (verifiable here)
- **Environment isolation:** Test = `haojpuhztegecbrwqorr` ("SRR Playlist **Test**"), Production = `nsoesrvwkxqifjcxzvol` ("SRR Playlist") — distinct refs/hosts/names. Confirmed via `list_projects`.
- **Binding security** was already applied + certified on Test in BRAND-DEVICE-BINDING-1 (`0454`, 18/18 synthetic assertions). Not re-run here (no change).
- **Automated gates on this branch:** Migration lint ✅, Unit 127 ✅ (unchanged), Typecheck/Build carried from base (no source changed this phase).

## What would unblock (operator runbook in docs 01–03)
1. Recover the **full brand product subsystem** to Test (verify_store_code, get_brand_player_config + `_brand_*` helpers, brand_media_assets/music_policies/signage) and seed a synthetic brand/enterprise/store/tracks/media + a loginable brand auth user — Test only, synthetic, no PII.
2. Provision a Vercel Preview of this branch with env = **Test** URL + Test anon key; verify `[SupabaseEnv]` shows `hao…qorr` and never `nso…zvol`.
3. Then run the Chrome/Safari/Edge + long-run runbooks (docs 04–14) and record only actually-observed results.

## Verdict
`BLOCKED` — the certification target cannot be exercised here (Test lacks the player backend; no Test-bound preview; no real browsers/long-run). No PASS is claimed for any browser/preview/long-run item. A precise unblock runbook is provided.
