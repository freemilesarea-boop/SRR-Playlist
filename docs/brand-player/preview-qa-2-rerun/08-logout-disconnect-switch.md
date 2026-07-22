# 08 — Logout / Disconnect / Store Switch

## Status: BLOCKED / NOT RUN
Runbook: Logout → playback stop + queue clear + local binding removed + Supabase signout + login page; re-visit no auto-entry; old token reuse fails; re-login requires store code. Disconnect → server revoke + local clear + stop + code screen; auth kept; old token fails; refresh no auto-entry. Switch A→B → A stops/clears/binding-revoked, B binding+config+queue, no A residue, no scope mixing. (Backend revoke/switch primitives SQL-certified.)
