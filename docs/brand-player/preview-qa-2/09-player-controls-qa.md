# 09 — Player Controls QA (UX-5)

## Status: BLOCKED / NOT RUN (needs working player on a Test-bound preview)

## Runbook
- Progress: current/total time; seek click/drag/touch/keyboard; reset on track change; crossfade-safe.
- Volume: 0/50/100%, mute/unmute + restore, persists across next/refresh/fullscreen-exit.
- Queue: open; title/artist search (Korean/English); no-result; current highlighted; original-index selection; upcoming section; select-after-search.
- Fullscreen: button/F/Escape/Q/Space/Arrows; search-input & slider focus guards; auto-hide; mouse/touch.

Underlying pure logic is unit-tested (127 tests); browser behavior remains to be observed.
