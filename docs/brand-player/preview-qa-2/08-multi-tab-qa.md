# 08 — Multi-tab QA

## Status: BLOCKED / NOT RUN

## Runbook
- Tab A connects → Tab B auto-recovers (shared localStorage + server re-verify).
- Logout / disconnect / store-switch propagate via storage events.
- Two-tab simultaneous audio policy (must not double-play; if it does → P1+).
- No queue/binding state conflict; no infinite redirect / validation loop.
