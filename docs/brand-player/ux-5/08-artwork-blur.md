# 08 — Artwork Blur Background

`BrandVisualStage` → `ArtworkStage` (TRACK_ARTWORK mode).

Layers (Spotify-style):
1. **Background** — same cover, `object-cover` (fills screen), `scale-125` (hides blur edges), `blur-3xl`, `opacity-40`.
2. **Dark overlay** — `bg-black/45` for readability.
3. **Foreground** — same cover, `object-contain`, `max-h/w-[86%]`, centered, shadow; keyed by URL so it fades in on track change.
4. **Preload** — hidden `<img>` of the next cover.

## Guarantees
- Background image is identical to the foreground cover.
- Small screens & large signage handled via percentage sizing.
- **Failure parity** — both background and foreground use the same URL and the same `onError` → adding the URL to the failed set drops the whole mode to `DEFAULT_FALLBACK` (no half-broken state).
- **Reduced motion** — the background opacity transition is `motion-safe:` only.
- **No console output** of artwork URLs.
- Low-spec devices: a single blurred `<img>` + overlay (no canvas / no per-pixel work).
