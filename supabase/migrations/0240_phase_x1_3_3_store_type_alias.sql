-- 0240 — Phase X1.3.3 store_type alias 시스템 + winebar 신규
--
-- 문제: 운영 business_category / suitable_store 값과 taxonomy_store_types.name_ko 불일치
--   헬스장 vs 피트니스 / 미용실 vs 뷰티샵 / 다이닝/이자카야 미매핑 등.
--
-- 해결:
--   1. taxonomy_store_types 에 winebar 신규 (와인바 35건 — 별도 가치)
--   2. store_type_alias 테이블 (raw_label → taxonomy_slug)
--   3. normalize_store_label(text) RPC
--   4. auto_place_track / explain / simulate 에서 alias normalize 사용
--
-- 정책:
--   - flowershop: 별도 추가 안 함 (10건 작고 boutique 흡수)
--   - lounge: hotel 흡수 (호텔 라운지 의미)
--   - 다이닝/이자카야/술집/식당: restaurant 흡수
--   - 카페 라운지: hotel 흡수 (라운지 위주)

-- ===== A. taxonomy_store_types 확장 =====
insert into public.taxonomy_store_types(slug, name_ko, name_en, description, sort_order) values
  ('winebar', '와인바', 'Wine Bar', '와인바 / 칵테일바 / 라운지바 — 저녁 분위기 BGM', 45)
on conflict (slug) do update set
  name_ko = excluded.name_ko, name_en = excluded.name_en,
  description = excluded.description, sort_order = excluded.sort_order;

-- ===== B. store_type_alias 테이블 =====
create table if not exists public.store_type_alias (
  id bigserial primary key,
  raw_label text not null,
  taxonomy_slug text not null,
  source text not null default 'seed',  -- 'seed' | 'admin'
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (raw_label)
);

create index if not exists store_type_alias_slug_idx on public.store_type_alias(taxonomy_slug);
create index if not exists store_type_alias_active_idx on public.store_type_alias(is_active) where is_active = true;

alter table public.store_type_alias enable row level security;
drop policy if exists store_type_alias_public_read on public.store_type_alias;
create policy store_type_alias_public_read on public.store_type_alias for select using (is_active);

drop policy if exists store_type_alias_admin_read on public.store_type_alias;
create policy store_type_alias_admin_read on public.store_type_alias for select
  using (exists(select 1 from public.users u where u.id = auth.uid() and u.role = 'admin'));

-- ===== C. Seed (운영 데이터 기반) =====
insert into public.store_type_alias(raw_label, taxonomy_slug, source) values
  -- fitness
  ('헬스장', 'fitness', 'seed'),
  ('피트니스', 'fitness', 'seed'),
  ('Gym', 'fitness', 'seed'),
  ('gym', 'fitness', 'seed'),
  ('GYM', 'fitness', 'seed'),
  ('짐', 'fitness', 'seed'),
  -- beauty_shop
  ('미용실', 'beauty_shop', 'seed'),
  ('뷰티샵', 'beauty_shop', 'seed'),
  ('네일샵', 'beauty_shop', 'seed'),
  ('피부관리샵', 'beauty_shop', 'seed'),
  ('헤어샵', 'beauty_shop', 'seed'),
  ('Beauty Shop', 'beauty_shop', 'seed'),
  ('Salon', 'beauty_shop', 'seed'),
  -- boutique (편집샵 / 플라워샵 흡수)
  ('편집샵', 'boutique', 'seed'),
  ('부티크', 'boutique', 'seed'),
  ('플라워샵', 'boutique', 'seed'),
  ('Boutique', 'boutique', 'seed'),
  ('Select Shop', 'boutique', 'seed'),
  -- winebar (신규 — 와인바 35건)
  ('와인바', 'winebar', 'seed'),
  ('칵테일바', 'winebar', 'seed'),
  ('라운지바', 'winebar', 'seed'),
  ('Wine Bar', 'winebar', 'seed'),
  ('Cocktail Bar', 'winebar', 'seed'),
  -- restaurant (이자카야/다이닝/술집/식당 흡수)
  ('이자카야', 'restaurant', 'seed'),
  ('다이닝', 'restaurant', 'seed'),
  ('술집', 'restaurant', 'seed'),
  ('식당', 'restaurant', 'seed'),
  ('레스토랑', 'restaurant', 'seed'),
  ('Restaurant', 'restaurant', 'seed'),
  -- cafe
  ('카페', 'cafe', 'seed'),
  ('Cafe', 'cafe', 'seed'),
  ('Coffee Shop', 'cafe', 'seed'),
  -- bakery
  ('베이커리', 'bakery', 'seed'),
  ('Bakery', 'bakery', 'seed'),
  -- hospital
  ('병원', 'hospital', 'seed'),
  ('의원', 'hospital', 'seed'),
  ('클리닉', 'hospital', 'seed'),
  ('Hospital', 'hospital', 'seed'),
  -- hotel (라운지 / 카페 라운지 흡수)
  ('호텔', 'hotel', 'seed'),
  ('라운지', 'hotel', 'seed'),
  ('카페 라운지', 'hotel', 'seed'),
  ('Hotel', 'hotel', 'seed'),
  -- office
  ('오피스', 'office', 'seed'),
  ('사무실', 'office', 'seed'),
  ('코워킹', 'office', 'seed'),
  ('Office', 'office', 'seed'),
  -- study_cafe
  ('스터디카페', 'study_cafe', 'seed'),
  ('스터디 카페', 'study_cafe', 'seed'),
  ('독서실', 'study_cafe', 'seed'),
  ('Study Cafe', 'study_cafe', 'seed'),
  -- kids_zone
  ('키즈존', 'kids_zone', 'seed'),
  ('키즈카페', 'kids_zone', 'seed'),
  ('어린이놀이방', 'kids_zone', 'seed'),
  ('Kids Zone', 'kids_zone', 'seed')
on conflict (raw_label) do update set
  taxonomy_slug = excluded.taxonomy_slug,
  source = excluded.source,
  is_active = true;

-- ===== D. normalize_store_label RPC =====
-- input: 운영 label (business_category / suitable_store)
-- output: taxonomy_store_types.slug 또는 NULL (매핑 없음)
create or replace function public.normalize_store_label(p_label text)
returns text
language sql
security definer
set search_path = public
stable
as $$
  select a.taxonomy_slug
  from public.store_type_alias a
  where a.is_active and lower(btrim(a.raw_label)) = lower(btrim(coalesce(p_label, '')))
  limit 1;
$$;
grant execute on function public.normalize_store_label(text) to anon, authenticated, service_role;

-- ===== E. Admin RPC — alias 관리 =====
create or replace function public.admin_list_store_aliases()
returns table (id bigint, raw_label text, taxonomy_slug text, taxonomy_name_ko text,
               source text, is_active boolean, created_at timestamptz)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if not exists (select 1 from public.users u where u.id = auth.uid() and u.role='admin') then
    raise exception 'unauthorized';
  end if;
  return query
  select a.id, a.raw_label, a.taxonomy_slug,
    (select g.name_ko from public.taxonomy_store_types g where g.slug = a.taxonomy_slug),
    a.source, a.is_active, a.created_at
  from public.store_type_alias a
  order by a.taxonomy_slug, a.raw_label;
end; $$;
revoke all on function public.admin_list_store_aliases() from public, anon;
grant execute on function public.admin_list_store_aliases() to authenticated, service_role;

create or replace function public.admin_upsert_store_alias(p_raw_label text, p_taxonomy_slug text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.users u where u.id = auth.uid() and u.role='admin') then
    raise exception 'unauthorized';
  end if;
  if not exists (select 1 from public.taxonomy_store_types where slug = p_taxonomy_slug) then
    raise exception 'unknown taxonomy_slug: %', p_taxonomy_slug;
  end if;
  insert into public.store_type_alias(raw_label, taxonomy_slug, source, is_active)
  values (btrim(p_raw_label), p_taxonomy_slug, 'admin', true)
  on conflict (raw_label) do update set
    taxonomy_slug = excluded.taxonomy_slug,
    source = 'admin',
    is_active = true;
end; $$;
revoke all on function public.admin_upsert_store_alias(text, text) from public, anon;
grant execute on function public.admin_upsert_store_alias(text, text) to authenticated, service_role;

create or replace function public.admin_delete_store_alias(p_raw_label text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.users u where u.id = auth.uid() and u.role='admin') then
    raise exception 'unauthorized';
  end if;
  delete from public.store_type_alias where raw_label = btrim(p_raw_label);
end; $$;
revoke all on function public.admin_delete_store_alias(text) from public, anon;
grant execute on function public.admin_delete_store_alias(text) to authenticated, service_role;
