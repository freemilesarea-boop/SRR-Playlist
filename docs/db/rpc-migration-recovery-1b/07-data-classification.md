# 07 — Data Classification
Machine-readable: `cluster-b-data-classification.json`.
- **User-visible (own only):** id, type, title, body, status, priority, timestamps, own attachments, admin_note (likely the reply).
- **Admin-only:** all inquiries, user_email, contact_email/phone, admin_note, assigned_admin_id, other users' context.
- **Sensitive:** user_email, contact_email, contact_phone, file_url (storage path).
- **P3 observation:** own-detail/list expose `admin_note` + `assigned_admin_id` to the inquiry owner. No cross-user leak (verified). Left verbatim to preserve the client contract (changing the return shape would break `supportInquiryApi.ts` + UI). Recommend confirming whether `admin_note` is the intended user-facing reply; if internal-only, split in a future contract-change phase.
