# 04 — Track Artwork Fallback (Priority 3)

Rendered by `BrandVisualStage` → `ArtworkStage` when mode = `TRACK_ARTWORK`.

- Current track `cover_url`; changes automatically when the track changes (auto-next, manual next, prev, queue select) because it derives from `queue[index].cover_url`.
- Original ratio preserved: foreground `object-contain` (`max-h/w-[86%]`); a blurred, dimmed `object-cover` copy fills letterbox margins so large signage screens aren't harshly cropped.
- Fade on change: the foreground `<img>` is keyed by URL and plays a `fadeIn` (400ms) on remount — **independent of the audio crossfade** (pure CSS on the image element; audio untouched).
- Next cover preloaded via a hidden `<img>` (`queue[index+1].cover_url`).
- Load failure: `onError` adds the URL to a failed set → mode drops to `DEFAULT_FALLBACK`; the app never crashes and never infinitely retries.
- No `cover_url` on the track → mode is `DEFAULT_FALLBACK`.
- Artwork URL is **never logged to console**.
- Changing artwork does not remount the player or touch the audio element, so audio never restarts or stutters.
- Small screens & large displays handled via percentage sizing + `object-contain`/`object-cover` combo.
