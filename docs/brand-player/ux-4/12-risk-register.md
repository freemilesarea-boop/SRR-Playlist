# 12 — Risk Register (P0/P1/P2)

| ID | Risk | Severity | Status / Mitigation |
|---|---|---|---|
| UX4-R1 | Logo source is the service-level `brand_settings.logo_url`, not a per-franchise logo | **P2** | Data model has no per-brand logo column; the phase forbids duplicate columns when a field exists. Selector is future-proof — a per-brand logo can be slotted ahead without call-site changes. Documented in `02`. |
| UX4-R2 | Live browser QA not executed | **P2** | Automated gates green; interaction verified at code level. Full checklist in `11` to run on a Test-bound preview. |
| UX4-R3 | Full-area touch catcher could intercept an unexpected interactive element in fullscreen | P2 | Catcher is `tabIndex=-1`, disabled while queue open, and sits below the control bar (z-120 vs 121/122); the presentation area has no other interactive content. |
| UX4-R4 | Auto-hide could hide controls during a rapid track-change burst | P2 | Track change calls `reveal()`; hide only fires 3s after the last interaction and only while playing. |

## Compliance
- No DB migration; no Production data change; no secrets/PII in code or docs.
- No change to Playback/Queue/Scheduler/Crossfade/Heartbeat/Reaction/Analytics/Recovery — all movement via existing `next`/`prev`/`jumpTo`/`play`/`pause`; global `<Player>` remains sole audio owner.
- Existing brand-media cycling, video, mixed, per-image duration, fullscreen enter/exit, ESC, autoplay, 24h loop preserved.
- No test deleted or weakened.
