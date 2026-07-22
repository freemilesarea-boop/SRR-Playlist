# 13 — Playback Regression

## Unchanged by construction
The auth/binding work touches only storage, RPC wrappers, an access-state resolver, and three page actions. It does **not** modify:
- the single global `<Player>` / audio element,
- queue navigation, scheduler, crossfade,
- heartbeat playback payload (only the RPC's server-side guard changed; the client `brandPlayerHeartbeat` signature/return is unchanged),
- analytics, playback recovery,
- progress, seek, volume, queue search, fullscreen,
- brand media / logo / artwork visual stage.

## Stop/switch use official paths
- Device disconnect / store switch call `pause()` (existing store command) + navigation; they do not manipulate the audio element or clone/reset the queue by hand.
- Store switch relies on the next brand's `setQueue(...)` to replace the queue (existing behavior).

## Gates
Typecheck ✅ · ESLint ✅ · Unit 127 ✅ (incl. existing 112) · Build ✅ · Migration lint ✅. No existing test deleted or weakened.

## To confirm in browser QA (next phase)
That auto-entry / logout / disconnect / switch do not cause audio remount, duplicate audio, or queue loss — the invariants above make this expected, but they require real-browser observation before merge.
