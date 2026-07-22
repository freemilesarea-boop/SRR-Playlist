# 03 — Logo Fallback (Priority 2)

Rendered by `BrandVisualStage` when mode = `BRAND_LOGO`.

- No empty-state text.
- Centered (`flex items-center justify-center`).
- Original ratio preserved via `object-contain`.
- Over-enlargement clamped: `max-h-[40%] max-w-[55%]` (small logos scale up but never fill/distort; low-res logos aren't blown up past their box).
- Background: existing brand gradient (`from-slate-900 to-black`) — safe neutral.
- Persistent: never auto-dismisses or transitions to another empty state (mode only changes if valid media appears or config changes).
- Fullscreen: same component/markup renders inside the presentation container, so it is identical in fullscreen.
- `onError` on the logo `<img>` marks the URL failed → mode falls through to artwork/fallback (no broken-image box left on a signage screen).

Source: service/brand `brand_settings.logo_url` via `useBrandStore`. Loaded idempotently in `BrandPlayerPage` (`loadBrandSettings()`), so the kiosk route (outside `AppShell`) still has it.
