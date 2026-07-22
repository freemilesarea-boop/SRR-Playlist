# 08 — Grant Review
| RPC | anon | authenticated | Guard |
|---|---|---|---|
| create_support_inquiry | ✗ | ✓ | auth.uid() |
| list_my_inquiries | ✗ | ✓ | user_id=auth.uid() |
| get_my_inquiry_detail | ✗ | ✓ | own-or-admin |
| admin_* (4) | ✗ | ✓ | internal admin check |

`revoke all ... from public` on all 7; **no anon**; no PUBLIC-default. Verified on Test: execute grants = `authenticated` (+ owner postgres) for all 7. Grant alone never used for admin authorization — always paired with the in-function check.
