# 14 — Playback Regression

## This phase changed no player/runtime source code
The only repo changes are: an **un-applied** additive migration file (`0454`) and documentation. Therefore the UX-4/UX-5 playback behavior is unchanged by construction:
- Single global `<Player>` / one audio element — untouched.
- Queue, Scheduler, Crossfade, Heartbeat, Analytics, Playback Recovery — untouched.
- Brand media / logo / artwork fallback, Progress, Seek, Volume, Queue search, Fullscreen — untouched (UX-5 code intact).

Automated regression carried from UX-5: Typecheck ✅ · ESLint ✅ · Unit 112 ✅ · Build ✅ · Migration lint ✅ (with `0454`).

## When the client binding layer is implemented (future)
The design constrains it to auth/binding + storage only — it must not:
- create a second audio element or playback engine,
- clone or re-source the queue,
- reset the store queue before session restore completes,
- bypass scheduler/crossfade/heartbeat/analytics.
Store switching explicitly clears the prior queue to prevent cross-store bleed. These invariants must be re-verified in browser QER (`12`) before merge.
