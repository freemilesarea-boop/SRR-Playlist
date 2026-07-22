# 13 — Long-run QA

## Status: BLOCKED (not executed)
No environment to run 30 min–2 hr continuous playback here. **No long-run duration is reported as PASS.**

## Runbook (on the Test-bound preview)
Run continuous playback and record the **actual** observed duration only:
- ≥ 30 min (target), ideally 2 hr.
- Automatic track transitions; brand image/video cycling.
- Supabase session refresh occurs (observe token auto-refresh, no re-login).
- Heartbeat continues (`brand_player_heartbeat`).
- Queue preserved; fullscreen preserved.
- Memory does not grow unbounded (DevTools memory timeline).
- Event listeners do not accumulate (DevTools listeners count).
- Exactly one audio element; no duplicate/overlapping audio.
- No repeated auth-recovery loops; device binding re-verifies without user friction.

## Reporting rule
Report only the duration actually run (e.g. "verified 35 min"). **Do not report 24-hour PASS** unless a 24-hour run was actually performed.
