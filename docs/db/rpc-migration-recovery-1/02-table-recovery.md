# 02 — Table Recovery

| Table | Repo | Test before | Test after | Production | RLS | Policies | Result |
|---|---|---|---|---|---|---|---|
| site_settings | ✗→✓(0457) | ✗ | **✓ created** | ✓ | on | public_read | **DONE (Test)** |
| site_notices | ✗→✓(0457) | ✗ | **✓ created** | ✓ | on | public_read + admin_read_all | **DONE (Test)** |
| support_inquiries | ✗ | ✗ | pending | ✓ | on | self-or-admin select, admin update | PREPARED |
| support_inquiry_attachments | ✗ | ✗ | pending | ✓ | on | self-or-admin select | PREPARED |
| track_ai_predictions | ✗ | ✗ | pending | ✓ | on | admin_read | PREPARED |

## Captured details (all 5, from Production metadata)
- **site_settings:** 7 cols, singleton `check(id=1)`, FK `updated_by→users`, seed row id=1. 
- **site_notices:** 13 cols, checks on `audience`/`display_location`, FK `created_by→users`, partial index `(is_active,priority desc) where is_active`.
- **support_inquiries:** 25 cols (incl PII `user_email/contact_email/contact_phone`), checks on `inquiry_type/status/priority` + non-empty title/body, 4 FKs (ON DELETE SET NULL), 4 indexes.
- **support_inquiry_attachments:** 7 cols, FK `inquiry_id→support_inquiries ON DELETE CASCADE`, 1 index.
- **track_ai_predictions:** 22 cols, unique `(track_id,model_version)`, FK `track_id→tracks CASCADE` + `applied_by→users`, 7 indexes incl 3 GIN on text[] arrays.
Machine-readable: `production-table-definitions.json`. Full DDL lives in the migration files (0457 done; 0458/0459 prepared).
