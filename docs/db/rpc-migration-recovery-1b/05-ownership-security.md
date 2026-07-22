# 05 — Ownership Security
- **Owner = `auth.uid()`** on create; no `user_id`/`profile_id`/email accepted as owner (create takes none).
- `list_my_inquiries`: `where user_id = auth.uid()`.
- `get_my_inquiry_detail`: `where id=? and (user_id=auth.uid() or admin)` → other users' IDs return `not_found`.
- Attachments: `sia select self or admin` RLS via parent inquiry owner; create inserts attachments only under the caller's new inquiry.
- **Verified on Test:** User B cannot read User A's inquiry (not_found); User B own-list empty; anonymous blocked.
