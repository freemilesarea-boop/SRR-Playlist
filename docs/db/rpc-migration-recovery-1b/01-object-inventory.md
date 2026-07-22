# 01 — Object Inventory

## Tables (Production-only → recovered)
| Table | Cols | Owner col | Sensitive | RLS |
|---|---|---|---|---|
| support_inquiries | 25 | user_id | user_email, contact_email, contact_phone, admin_note, assigned_admin_id, browser_user_agent | on |
| support_inquiry_attachments | 7 | (via inquiry_id) | file_url (storage path) | on |

## RPCs
| RPC | Purpose | Caller | R/W | Ownership | Admin-only | Sensitive return |
|---|---|---|---|---|---|---|
| create_support_inquiry | submit inquiry | user | W | auth.uid() | no | no (own) |
| list_my_inquiries | own list | user | R | user_id=auth.uid() | no | no |
| get_my_inquiry_detail | own detail | user | R | user_id=auth.uid() or admin | no | own only |
| admin_list_support_inquiries | all inquiries | admin | R | — | yes | yes (PII) |
| admin_get_support_inquiry_detail | inquiry + business/artist | admin | R | — | yes | yes |
| admin_support_inquiry_summary | aggregates | admin | R | — | yes | no |
| admin_update_inquiry | status/priority/note/assign | admin | W | — | yes | no |
