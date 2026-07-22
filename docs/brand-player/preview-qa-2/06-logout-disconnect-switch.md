# 06 — Logout / Disconnect / Store Switch QA

## Status: BLOCKED / NOT RUN

## Runbook
- Brand logout: player stops; queue cleared; local binding refs removed; Supabase session removed; login page; re-visit does NOT auto-enter; old device token re-use fails; re-login requires store code.
- This device disconnect: server binding revoked; local ref removed; player stops; store-code screen; Supabase login kept; old token re-use fails; refresh does not auto-enter.
- Store switch (needs Store A + Store B synthetic): A stops + queue cleared + A binding revoked/inactive; B binding created; B config loads; no A tracks/media residue; no analytics/heartbeat scope mixing. If Store B synthetic data is unavailable → record DEFERRED.
- Confirm exit-fullscreen / leave-route / close-browser are NOT treated as logout.
