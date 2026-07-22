# 03 — Synthetic Test Data

## Status: NOT PREPARED (BLOCKED)
The Test project lacks the brand product backend, so meaningful synthetic player data cannot be created/exercised this phase. Present on Test: 12 `auth.users` (from unrelated work) — but no loginable synthetic **brand** account tied to a working store-code/config flow.

| Item | Test status |
|---|---|
| Test auth user (loginable brand account) | not prepared (needs admin/service-role seed + password) |
| Test enterprise account | table exists (minimal bootstrap from `0454`); no synthetic row |
| Test brand account | table exists (minimal); no synthetic row |
| Test store code | **`verify_store_code` absent** → flow can't run |
| Test playlist / ≥10 tracks | `_brand_generate_playlist` absent; tracks table exists but no brand playlist path |
| Track artwork / brand logo / image / video | `brand_media_assets` absent |
| Brand signage settings | `brand_signage_settings` absent |
| Player config | **`get_brand_player_config` absent** |

## Why not seed it here
Creating only rows is insufficient — the **RPCs and helper functions** the player depends on are absent from Test. Recovering the entire brand product subsystem to Test (verify_store_code, get_brand_player_config, `_brand_generate_playlist`, `_brand_signage_json`, `_brand_audit`, media/policy/signage tables) plus seeding a password-loginable brand auth user is a large recovery effort beyond a "Preview QA" phase, and it still would not unblock the Vercel-env / real-browser / long-run requirements.

## Operator runbook (Test only, synthetic, no PII)
1. Recover the brand product subsystem to Test (from Production read-only defs, the proven method) — RPCs + helpers + media/policy/signage tables.
2. Seed: 1 synthetic enterprise (`QA Test HQ`), 1 brand (`QA Test Brand`), store codes `QA Test Store A/B` (synthetic, not real), ≥10 synthetic tracks with artwork, 1 brand logo, 1 image, 1 video, signage settings.
3. Create a loginable synthetic brand auth user (test-only email, no PII).
4. Confirm `verify_store_code` + `get_brand_player_config` succeed for the synthetic store before browser QA.

Naming: `QA Test Brand` / `QA Test Store` / `QA Main Player`. No real store names, no real store codes, no Production data copy.
