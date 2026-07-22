# 11 — Data Exposure Tests
Machine-readable: `cluster-b-exposure-results.json`.
- **Cross-user read:** BLOCKED — User B `get_my_inquiry_detail(User A id)` → not_found.
- **Cross-user list:** BLOCKED — User B own list empty (User A's inquiry not visible).
- **Anonymous:** BLOCKED — create + admin_list raise unauthorized.
- **Other users' PII (email/phone/contact):** never returned to a non-owner non-admin (RLS self-or-admin + function `auth.uid()` scoping).
- **admin_note/assigned_admin_id:** returned only on the caller's own inquiry (owner) or to admins — P3 observation, no cross-user exposure.
