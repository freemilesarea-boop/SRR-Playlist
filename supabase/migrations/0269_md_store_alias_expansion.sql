-- 0269 — store_type_alias MD-spec 매핑 보강 (X5.4 후속)
--
-- 사용자 결정 (옵션 B): normalize_store_label() 확장 — alias 테이블에 신규 매핑 추가.
-- MD 원문 카테고리 그대로 유지 (restaurant / beauty_shop 단일 통합 금지).
--
-- 변경 사항:
--   (i)  기존 매핑 슬러그 갱신:
--        - 미용실 → beauty_shop → salon
--        - 네일샵 → beauty_shop → nail_shop
--        - 다이닝 → restaurant → fine_dining
--        - 술집 → restaurant → pub
--        - 이자카야 → restaurant → izakaya
--        - 플라워샵 → boutique → flower_shop
--   (ii) 신규 alias 추가 (한국어 카테고리 → MD slug):
--        한식, 일식, 중식, 양식, 파인다이닝, 화원, 서점, 펍, 스튜디오, 쇼룸 등
--
-- 정책:
--   - "식당" → restaurant 는 보존 (DB 에 "식당" 카테고리 잔존, 운영자가 한식/일식 등 재분류)
--   - 자동 삭제 X — 정책 매핑만 갱신
--   - 0268 의 dry_run RPC 는 변경 없음

insert into public.store_type_alias (raw_label, taxonomy_slug, source, is_active) values
  ('미용실',        'salon',               'admin_md_policy_v1', true),
  ('네일샵',        'nail_shop',           'admin_md_policy_v1', true),
  ('다이닝',        'fine_dining',         'admin_md_policy_v1', true),
  ('파인다이닝',    'fine_dining',         'admin_md_policy_v1', true),
  ('술집',          'pub',                 'admin_md_policy_v1', true),
  ('펍',            'pub',                 'admin_md_policy_v1', true),
  ('술집/펍',       'pub',                 'admin_md_policy_v1', true),
  ('이자카야',      'izakaya',             'admin_md_policy_v1', true),
  ('플라워샵',      'flower_shop',         'admin_md_policy_v1', true),
  ('화원',          'flower_shop',         'admin_md_policy_v1', true),
  ('플라워샵/화원', 'flower_shop',         'admin_md_policy_v1', true),
  ('한식',          'korean_restaurant',   'admin_md_policy_v1', true),
  ('한식당',        'korean_restaurant',   'admin_md_policy_v1', true),
  ('일식',          'japanese_restaurant', 'admin_md_policy_v1', true),
  ('일식당',        'japanese_restaurant', 'admin_md_policy_v1', true),
  ('중식',          'chinese_restaurant',  'admin_md_policy_v1', true),
  ('중식당',        'chinese_restaurant',  'admin_md_policy_v1', true),
  ('양식',          'western_restaurant',  'admin_md_policy_v1', true),
  ('양식당',        'western_restaurant',  'admin_md_policy_v1', true),
  ('서점',          'bookstore',           'admin_md_policy_v1', true),
  ('스튜디오',      'studio',              'admin_md_policy_v1', true),
  ('쇼룸',          'showroom',            'admin_md_policy_v1', true)
on conflict (raw_label) do update set
  taxonomy_slug = excluded.taxonomy_slug,
  source        = excluded.source,
  is_active     = true;
