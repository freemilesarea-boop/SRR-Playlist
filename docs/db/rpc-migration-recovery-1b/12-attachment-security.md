# 12 — Attachment Security
- `support_inquiry_attachments` RLS `sia select self or admin`: SELECT allowed only if the caller owns the parent inquiry or is admin → **User A cannot read User B's attachment metadata**.
- Attachments created only via `create_support_inquiry` (under the caller's new inquiry) — no arbitrary inquiry_id injection for attachments by users.
- `inquiry_id → support_inquiries ON DELETE CASCADE`: deleting an inquiry removes its attachments.
- `file_url` stores a path/URL; **Storage bucket/policy is separate and NOT changed this phase** (no Production Storage change). Signed-URL/bucket privacy is a Storage-layer concern for a later phase.
- No dedicated user attachment-download RPC in Cluster B (attachments surfaced via own/admin detail functions, both ownership-scoped).
