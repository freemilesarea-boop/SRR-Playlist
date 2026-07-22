# 05 — Migration Manifest

| # | File | Cluster | Contents | Apply order | Status |
|---|---|---|---|---|---|
| 0457 | site_notices_settings_recover.sql | A | 2 tables + RLS + policies + 7 fns (1 sec-fix) + grants | 1 | **APPLIED to Test + verified** |
| 0458 | support_inquiries_recover.sql | B | 2 tables + RLS + 7 fns + grants | 2 | PREPARED |
| 0459 | track_ai_predictions_recover.sql | C | 1 table + RLS + 4 fns (2 sec-fix) + grants | 3 | PREPARED |
| 0460 | admin_track_rpc_recover.sql | D | 8 fns (4 sec-fix) + grants (deps: tracks, track_ai_predictions) | 4 | PREPARED |
| 0461 | clap_curation_rpc_recover.sql | E | 5 fns (3 sec-fix) + grants (deps present) | 5 | PREPARED |

- One migration per domain cluster (not 31-in-one). Tables before functions.
- Rollback: functions `create or replace` back to captured prior def; tables `drop ... if exists` (Test only; **never drop in Production**).
- Numbers start at 0457 to avoid collision with in-flight settlement 0454–0456.
