# 04 — RPC Recovery
All 7 recovered verbatim (signatures verified match Production on Test).
| RPC | Local before | Test after | Security | Result |
|---|---|---|---|---|
| create_support_inquiry | ✗ | ✓ | auth.uid() owner | DONE |
| list_my_inquiries | ✗ | ✓ | user_id=auth.uid() | DONE |
| get_my_inquiry_detail | ✗ | ✓ | own-or-admin | DONE |
| admin_list_support_inquiries | ✗ | ✓ | admin guard | DONE |
| admin_get_support_inquiry_detail | ✗ | ✓ | admin guard | DONE |
| admin_support_inquiry_summary | ✗ | ✓ | admin guard | DONE |
| admin_update_inquiry | ✗ | ✓ | admin guard | DONE |
