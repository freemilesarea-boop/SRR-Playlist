# 02 — Progress & Time

`src/lib/playbackTime.ts` (pure) + `src/components/brand/BrandPlaybackProgress.tsx`.

## Time formatting
`formatPlaybackTime(seconds)` → `m:ss`, or `h:mm:ss` for ≥1h. Guards NaN/Infinity/negative → `0:00`. No `Date` object allocated per render.

Tested: 0, 9, 59, 60, 65, 3599, 3600, 3661, 7325, NaN, Infinity, negative.

## Progress
`playbackProgress(currentTime, duration)` = clamped `currentTime/duration` with divide-by-zero / NaN / overflow guards. `isDurationPending(d)` → show `--:--` and read-only bar. `progressToSeconds(ratio, d)` maps a bar position back to seconds (clamped).

## Render isolation
`BrandPlaybackProgress` **subscribes to `currentTime`/`duration` itself**, so per-tick updates re-render only this component — not `BrandFullscreenControls`, `BrandVisualStage`, or the page. The control bar subscribes to queue/index/playing/shuffle/repeat (not currentTime), so it doesn't re-render each second.

## Sync across transitions
Progress derives from store `currentTime`, which `next`/`prev`/`jumpTo`/`setQueue` reset to 0 and `seekTo` sets — so track change, auto/manual next, prev, queue select, recovery, and background return all reflect immediately. During crossfade the store tracks the active track's time (brand mode disables crossfade), so no wrong-track progress.
