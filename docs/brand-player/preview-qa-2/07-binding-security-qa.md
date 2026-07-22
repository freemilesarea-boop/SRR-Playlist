# 07 — Binding Security QA (browser)

## Status: BLOCKED / NOT RUN (server-side already certified; browser-level pending)

## Runbook
- Tampered token: edit part of the localStorage token → auto-entry fails, local token cleared, store-code screen, no internal error shown (fail-closed).
- Revoked token: revoke the binding server-side → next entry fails; heartbeat fails; REVOKED/code-required.
- Expired token: expire only a synthetic binding on Test → auto-entry fails; config/heartbeat fail; expiry message; code re-entry.
- Cross-user: put User A token in User B browser → not_owner; no player entry; no other brand/store info; local token cleared.
- Never record real token values.

Server certification (Test, synthetic, 18/18) is in docs/brand-player/device-binding-1/11-rls-rpc-certification.md.
