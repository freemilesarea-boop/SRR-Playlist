# 15 — Release Readiness

## Completion checklist (§24)
- [x] Current time / total time
- [x] Progress bar
- [x] Safe seek (added on the owner path, guarded) — interactive, not read-only
- [x] Volume slider + Mute toggle, synced to real player state
- [x] Shuffle + Repeat status (read-only, real state)
- [x] Queue search (title/artist/album, Korean/English/number, empty-result)
- [x] Original queue index preserved (`jumpTo(originalIndex)`)
- [x] 현재 재생 / 다음 재생 sections
- [x] 최근 재생 only if real history exists → **omitted** (no history)
- [x] Artwork blur background + centered contain foreground
- [x] Logo background improved (neutral dark gradient)
- [x] Display-mode fade
- [x] Video loop preserved (unit-asserted)
- [x] `F` fullscreen shortcut
- [x] Auto-hide reinforced (pause/hover/focus/queue/search/drag)
- [x] Touch + keyboard accessibility
- [x] Existing audio instance kept; no queue/scheduler/crossfade/heartbeat/analytics change
- [x] Typecheck / ESLint / Unit(112) / Build — PASS
- [ ] Browser QA — DEFERRED (no Test-bound preview; `13`)
- [x] No Production DB change / no migration / no secret / no PII output

## Changed files
- `src/lib/playbackTime.ts` (new) + `.test.ts`
- `src/lib/queueSearch.ts` (new) + `.test.ts`
- `src/components/brand/BrandPlaybackProgress.tsx` (new)
- `src/components/brand/BrandVolumeControl.tsx` (new)
- `src/components/brand/BrandQueueSearch.tsx` (new)
- `src/components/brand/BrandFullscreenControls.tsx` (progress/volume/shuffle-repeat/hold/layout)
- `src/components/brand/BrandQueueDrawer.tsx` (search + sections + original-index)
- `src/components/brand/BrandVisualStage.tsx` (mode fade + blur overlay + logo bg)
- `src/store/playerStore.ts` (`seekTo`/`liveSeek`/`consumeLiveSeek`)
- `src/components/player/Player.tsx` (owner-only seek apply)
- `src/pages/BrandPlayerPage.tsx` (`F` toggle)
- `src/lib/brandDisplayMode.test.ts` (video-loop tests)
- `docs/brand-player/ux-5/*`

## Verdict
`READY_FOR_PREVIEW_QA`
