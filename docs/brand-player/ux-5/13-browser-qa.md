# 13 — Browser QA

## Status: DEFERRED (not executed)
Live browser QA requires a preview bound to a **Test** Supabase and a valid brand session token (the `/brand/player/:brandId` route redirects without one). Neither is available in this environment. Per the phase ("Preview가 Test 환경을 바라보지 않으면 Browser QA는 BLOCKED 또는 DEFERRED", "확인하지 않은 항목은 PASS로 기록하지 않는다"), **no browser is marked PASS**.

## Checklist (run on a Test-bound preview)
Browsers: Chrome, Safari, Edge. Sizes: 1920×1080, 1366×768; tablet landscape/portrait; mobile landscape/portrait.

Scenarios:
- Brand media / logo-only / artwork-only / fallback rendering.
- Blur background readability on large signage + mobile.
- Progress sync; seek by click / drag / touch / keyboard; `--:--` when duration pending.
- Volume drag + mute/unmute; volume persists across next/prev/exit/refresh.
- Next / Prev; Shuffle & Repeat indicators match policy.
- Queue search (title/artist/Korean); select from results → correct track (original index); current highlighted; live re-sync after auto-next.
- Fullscreen enter/exit; `F` toggle; Space/←/→/Q/Esc; auto-hide after 3s while playing; stays on pause/hover/focus/queue/search/drag.
- Video loop (single video repeats; video→image; image→video; video fail → fallback) with audio unaffected.
- 10+ consecutive track changes; background→foreground; long playback.

## Captures
`docs/screenshots/brand-player-ux-5/` — no real user data, signed URLs, internal track IDs, or secrets.
