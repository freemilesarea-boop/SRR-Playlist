# 12 — Synthetic Enterprise / Brand / Stores

Seeded on Test (fixed ids, synthetic names, no real data):
- Store A = enterprise `QA Synthetic Store A` (synthetic store code) → Brand A `QA Synthetic Brand A` (cafe).
- Store B = enterprise `QA Synthetic Store B` (synthetic store code) → Brand B `QA Synthetic Brand B` (retail).
- Both owned by the synthetic QA auth user; both active.
- Brand A: permissive music policy + signage settings + 4 media assets.

Store A vs Store B enables the store-switch + cross-brand tests. Raw synthetic store codes live only in `supabase/seed/brand_player_synthetic_test.sql` (test fixtures), not in these docs.
