# 10 — SQL Security Tests (executed on Test)
Synthetic users in a rolled-back transaction (`session_replication_role=replica` for FK bypass; no real data; no Production execution). Sentinel `ALL_PASS_ROLLBACK` = every assertion passed + data undone.

| # | Actor | Test | Result |
|---|---|---|---|
| 1 | anon | create_support_inquiry | unauthorized ✅ |
| 2 | anon | admin_list_support_inquiries | unauthorized ✅ |
| 3 | User A | create → owner column | = auth.uid() ✅ |
| 4 | User A | list_my_inquiries | count 1 ✅ |
| 5 | User A | admin_list_support_inquiries | unauthorized ✅ |
| 6 | User B | get_my_inquiry_detail(User A id) | not_found ✅ |
| 7 | User B | list_my_inquiries | count 0 ✅ |
| 8 | Admin | admin_list_support_inquiries | ≥1 ✅ |
| 9 | Admin | admin_update_inquiry | ok ✅ |
| 10 | Admin | admin_update_inquiry(random id) | not_found ✅ |
