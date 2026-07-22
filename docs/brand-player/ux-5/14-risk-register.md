# 14 — Risk Register (P0/P1/P2)

| ID | Risk | Severity | Status / Mitigation |
|---|---|---|---|
| UX5-R1 | New `seekTo` touches `audio.currentTime` | **P1** | Applied **only** in the audio owner (`Player.tsx`) behind track-identity + crossfade-skip + duration-clamp guards; UI never touches the DOM; no analytics event; heartbeat reads synced `currentTime`. Covered by logic review; browser QA pending. |
| UX5-R2 | Live browser QA not executed | **P2** | Automated gates green; interaction verified at code level. Checklist in `13`. |
| UX5-R3 | Shuffle/Repeat shown read-only (no toggle) | **P2** | Intentional — brand player enforces shuffle+repeat-all for 24h; a toggle would fight the policy. Indicators read the real store, always accurate. |
| UX5-R4 | 최근 재생 section omitted | **P2** | The player has no history stack; per spec no fake history is created. Can be added if a real history feature lands. |
| UX5-R5 | Very large queue (>~2000) renders all rows | **P2** | Rows are lightweight + lazy thumbnails; no heavy virtualization added (per "avoid over-optimization"). Windowing can slot behind the same API later. |

## Compliance
- No new audio element / playback engine; no cloned queue; no separate queue/volume/shuffle/repeat state.
- No scheduler bypass; no crossfade/heartbeat change; no analytics gap; no arbitrary DOM `currentTime` change (owner-only, guarded).
- Filtered index never confused with original index (`jumpTo(originalIndex)`, unit-tested).
- No DB migration; no Production data change; no secrets / signed URLs / PII / internal track IDs output.
- No existing test deleted or weakened.
