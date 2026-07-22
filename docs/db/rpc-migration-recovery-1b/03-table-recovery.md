# 03 — Table Recovery
| Table | Repo | Test before | Test after | Production | RLS | Policies | Result |
|---|---|---|---|---|---|---|---|
| support_inquiries | ✗→✓(0458) | ✗ | **✓** | ✓ | on | self-or-admin select, admin update | DONE |
| support_inquiry_attachments | ✗→✓(0458) | ✗ | **✓** | ✓ | on | self-or-admin select (via parent) | DONE |

Exact columns/checks/FKs/indexes reproduced from Production metadata (machine-readable `cluster-b-table-definitions.json`). FK targets (users, business_profiles, artist_profiles, admin_notifications) confirmed present in Test before apply.
