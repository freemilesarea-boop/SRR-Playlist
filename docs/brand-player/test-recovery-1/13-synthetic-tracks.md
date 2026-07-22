# 13 — Synthetic Tracks

15 synthetic tracks seeded (test-only, no real metadata):
- Public test audio (SoundHelix MP3s), picsum covers.
- Varied: 5 genres (Lo-fi/Jazz/House/Ambient/Pop), 5 moods, energy 1–5, tempo slow/medium/fast, some instrumental.
- `release_status = null` (passes the playlist generator; avoids the release-metadata trigger), `visibility_status = approved`, playable audio_url + cover_url.

`_brand_generate_playlist(brandA, 300)` returns **15** tracks → satisfies the ≥10 requirement for next/prev/search/selection/auto-advance QA. No PII, no rights issues (public test audio).
