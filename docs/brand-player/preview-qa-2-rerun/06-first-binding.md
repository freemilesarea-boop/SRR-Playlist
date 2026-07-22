# 06 — First Login / Store Code / Binding

## Status: BLOCKED / NOT RUN (needs Test-bound Preview + browser login)
Runbook: Preview → login (qa-brand-user) → /brand → enter Store A code → verify_store_code → binding → config → 15-track queue → playback. Verify: code entered once; store code NOT in localStorage/sessionStorage/URL/console/analytics; opaque device token only; no token hash / other-brand info exposed; media 4; heartbeat ok.
Backend for this is SQL-certified (05); browser observation pending.
