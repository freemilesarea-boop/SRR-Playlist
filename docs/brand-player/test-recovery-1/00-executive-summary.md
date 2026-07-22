# BRAND-TEST-RECOVERY-1 — Executive Summary

> Branch `claude/brand-test-recovery-1` from `claude/brand-player-preview-qa-2` (`91cac07`).
> Migration `0455` + synthetic seed **applied to Test only** (`hao…qorr`, "SRR Playlist Test"). **No Production change; no Production data copied.**

## Outcome
The brand player backend, previously **Production-only** and absent from Test, now runs end-to-end on the Test project. The full flow was certified via SQL (synthetic, rolled back):

```
Test auth context → verify_store_code → Device Binding → verify_brand_device_binding
→ get_brand_player_config → signage JSON + media + music policy + generated playlist (15 tracks)
→ brand_player_heartbeat → revoke → re-entry blocked
```

## Recovered to Test (migration `0455`, functional parity)
- **Tables** (`if not exists`): `brand_media_assets`, `brand_music_policies`, `brand_signage_settings`, `brand_audit_logs`, `brand_store_code_attempts` (rate-limit). Reuses `0454` `brand_player_sessions`/`brand_accounts`/`enterprise_accounts` (no duplicate tables). All RLS-enabled (default deny + admin-read).
- **Functions**: `_brand_audit` + `_brand_signage_json` (verbatim from Production); `_brand_generate_playlist` (**functional-parity** simplified generator — policy filters + scoring + same JSON contract, without the heavy recommendation deps); hardened `verify_store_code` (auth + rate-limit + `expires_at` + `device_label` + user binding, safe errors) and `get_brand_player_config` (binding guard: owner `user_id=auth.uid()` + not-revoked + not-expired + active brand). All `SECURITY DEFINER`, `search_path` pinned, `authenticated`-only, **no anon**; helpers definer-only.

## Synthetic seed (Test only, no PII, no real data)
- 1 synthetic auth user (`qa-brand-user@test.invalid`, password to be set by operator for browser QA — not stored).
- Stores A/B (`QA Synthetic Store A/B` — enterprise_accounts w/ synthetic store codes), Brands A/B, permissive music policy, signage settings, 4 media (logo + 2 images + 1 video, public fixtures), **15 synthetic tracks** (public SoundHelix audio + picsum covers, varied genre/mood/energy).

## Certification (Test, synthetic, rolled back) — 19/19 PASS
anon blocked (verify + config); first-code → success; wrong-code → invalid; binding verify ok; config returns brand + **playlist 15** + media 4 + signage; heartbeat ok; **cross-brand** blocked; **cross-user** `not_owner`/invalid; **revoke** → blocked; **expired** → blocked; **rate-limit** on 6th attempt.

## Parity
Full Production schema was **not** copied. `verify_store_code`/`get_brand_player_config`/signage/audit = functional/near-exact parity; `_brand_generate_playlist` = functional parity (simpler algorithm, identical contract). Deferred (ops-only): admin UI, settlement, contracts, real storage/media, real recommendation ML deps. See `17-production-parity.md`.

## Gates
Migration lint ✅ · Unit 127 ✅ · Typecheck/ESLint/Build (no client change) — see `18-regression-results.md`. No test deleted/weakened.

## Verdict
`READY_FOR_PREVIEW_QA` — Test backend can now run the brand player flow. Next: bind a Vercel Preview to Test env + set the QA user's password, then real-browser QA (previous BLOCKED phase).
