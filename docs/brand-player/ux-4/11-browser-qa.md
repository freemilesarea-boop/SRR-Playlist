# 11 — Browser QA

## Status: DEFERRED (not executed)
Live browser QA requires a running preview bound to a Test Supabase **and** a valid brand session token (the `/brand/player/:brandId` route redirects to `/brand` without one). Neither a Test-bound preview nor a synthetic brand session is available in this environment. Per the phase rule ("확인하지 않은 Browser는 PASS로 보고하지 않는다"), no browser is marked PASS.

## Checklist to run when a Test-bound preview + brand code are available
Desktop: Chrome, Safari, Edge. Sizes: 1920×1080, 1366×768, large signage, small tablet landscape, mobile portrait.

Scenarios:
- Brand media present → cycles as before.
- Media removed, logo set → centered logo, no empty text.
- No media/logo, playing → current cover shows; advance 10+ tracks → cover follows, audio uninterrupted.
- No assets at all → gradient + service logo (no instructional text).
- Enter fullscreen → controls show; idle 3s while playing → hide; move mouse to bottom / tap → reveal.
- Next / Prev / Play-Pause from the bar; ESC and Exit button leave fullscreen; nothing else does.
- Open queue → current highlighted + auto-scrolled; select a track → transitions + highlight updates; queue stays synced across auto-next.
- Background→foreground return; portrait/landscape.

## Captures
Place QA screenshots under `docs/screenshots/brand-player-ux-4/`. Do not include real user data, storage signed URLs, or secrets in captures.
