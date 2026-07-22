# 06 — Admin Security
- All 4 admin functions: `if not exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin') then raise 'unauthorized'` **before** any data access.
- `admin_update_inquiry`: actor is `auth.uid()`; validates row exists (`not_found` on 0 rows); status/priority via `coalesce` (invalid values still constrained by table CHECKs).
- **Verified on Test:** non-admin (User A) admin_list → unauthorized; admin list/update succeed; invalid inquiry id → not_found.
- Role source = repo canonical `users.role='admin'` (not guessed).
