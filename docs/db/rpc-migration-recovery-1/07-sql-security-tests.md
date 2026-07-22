# 07 — SQL Security Tests

## Executed on Test (Cluster A)
| Actor | Test | Result |
|---|---|---|
| no-auth (auth.uid() null) | `admin_list_site_notices()` | **raises `unauthorized`** (guard) ✅ |
| public/anon | `list_active_site_notices()` | callable, returns rows ✅ |
| — | signature match vs Production | ✅ |

Executed via a Test-only `do $$ ... $$` block (synthetic; no Production execution, no user data).

## Planned (clusters B–E, on apply)
- **anon:** public settings/notices allowed; admin readers/writers + inquiry internals blocked.
- **authenticated non-admin:** own inquiry create/read; other users' inquiries blocked; admin readers/writers blocked; other users' AI predictions blocked.
- **admin:** readers/writers allowed; audit actor recorded; invalid input rejected.
- **service_role:** only where required.
- **IDOR:** inquiry ownership via `auth.uid()`; attachments scoped via parent inquiry.
