# Brand Player — Automated Browser QA Harness

`qa_brand_player.js` drives the full persistent-binding brand-player flow with
Playwright + Chromium against a running app URL that is **built with the Test
Supabase env** and has **network egress to the Test Supabase host**.

It is fail-closed on Production: any request to the Production Supabase host
sets `prodViolation` and the process exits `2`. It never prints secrets — the
password is read from `QA_PASSWORD`.

## Why it was not run to completion in the automation session
The automation session's egress policy denied the browser's connection to the
Test Supabase host (`403` at the agent proxy), so login could not complete
there. See `../22-operator-followup-results.md`. Run this on the deployed
Preview (which has Supabase egress) or any host that can reach the Test host.

## Run
```sh
npm i -D playwright   # or set CHROMIUM_PATH to a system Chromium
export QA_BASE_URL="https://<preview-url>"          # or http://127.0.0.1:4173
export QA_EMAIL="qa-brand-user@test.invalid"
export QA_PASSWORD="********"                        # operator-set Test password
export QA_STORE_A="QA-STORE-ALPHA-7X3K9"
export QA_STORE_B="QA-STORE-BETA-4M8P2"
export QA_BRAND_A="b0000000-0000-4000-8000-0000000000a1"
export QA_BRAND_B="b0000000-0000-4000-8000-0000000000b2"
# optional: CHROMIUM_PATH, QA_TEST_HOST, QA_PROD_HOST, QA_SHOTS_DIR
node qa_brand_player.js
```

Covers: login, first store-code connect (asserts 15-track queue / 4 media),
refresh / new-tab / browser-restart auto-entry, controls presence, store A→B
switch, tampered-binding fail-closed, device disconnect, logout blocks
auto-entry. Screenshots + `qa_results.json` are written to `QA_SHOTS_DIR`.

**Not covered (operator/SQL):** revoked & expired binding require a Test-SQL
mutation on `public.brand_player_sessions` (`revoked_at` / `expires_at`) mid-run;
Safari/Edge/mobile matrix, real audio output, and long-run soak are hardware/
browser items. See docs 09, 13–16.
