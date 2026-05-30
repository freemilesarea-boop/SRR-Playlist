-- 0228 — Phase X1.0 DEUDDA DSP Taxonomy 시스템
--
-- 목적: AI 메타 추론 엔진 가동 전 전 플랫폼 공통 분류 체계 정의.
-- DEUDDA = 매장 BGM DSP → "매장 적합성" 중심 설계.
--
-- 4개 카테고리: genre / mood / store_type / daypart
-- 공통 컬럼: id / slug (PK) / name_ko / name_en / description / is_active / sort_order / created_at
--
-- 사용처:
--   - Modal worker CLAP zero-shot 분류 시 텍스트 프롬프트로 사용 (slug → "this is X music")
--   - admin UI 분류 드롭다운/필터
--   - track_ai_predictions (Phase X1.1+) 예측 결과 컬럼이 이 slug 들을 참조

-- 공통 구조의 4 테이블

create table if not exists public.taxonomy_genres (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name_ko text not null,
  name_en text not null,
  description text,
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.taxonomy_moods (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name_ko text not null,
  name_en text not null,
  description text,
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.taxonomy_store_types (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name_ko text not null,
  name_en text not null,
  description text,
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.taxonomy_dayparts (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name_ko text not null,
  name_en text not null,
  description text,
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

-- 활성 행 검색용 인덱스 (공개 read 자주 사용)
create index if not exists taxonomy_genres_active_idx     on public.taxonomy_genres(is_active, sort_order) where is_active = true;
create index if not exists taxonomy_moods_active_idx      on public.taxonomy_moods(is_active, sort_order) where is_active = true;
create index if not exists taxonomy_store_types_active_idx on public.taxonomy_store_types(is_active, sort_order) where is_active = true;
create index if not exists taxonomy_dayparts_active_idx   on public.taxonomy_dayparts(is_active, sort_order) where is_active = true;

-- RLS — 공개 read (활성 행만), admin write (RPC 경유)
alter table public.taxonomy_genres     enable row level security;
alter table public.taxonomy_moods      enable row level security;
alter table public.taxonomy_store_types enable row level security;
alter table public.taxonomy_dayparts   enable row level security;

drop policy if exists tax_genres_public_read     on public.taxonomy_genres;
drop policy if exists tax_moods_public_read      on public.taxonomy_moods;
drop policy if exists tax_store_types_public_read on public.taxonomy_store_types;
drop policy if exists tax_dayparts_public_read   on public.taxonomy_dayparts;

create policy tax_genres_public_read      on public.taxonomy_genres      for select using (is_active);
create policy tax_moods_public_read       on public.taxonomy_moods       for select using (is_active);
create policy tax_store_types_public_read on public.taxonomy_store_types for select using (is_active);
create policy tax_dayparts_public_read    on public.taxonomy_dayparts    for select using (is_active);

drop policy if exists tax_genres_admin_read     on public.taxonomy_genres;
drop policy if exists tax_moods_admin_read      on public.taxonomy_moods;
drop policy if exists tax_store_types_admin_read on public.taxonomy_store_types;
drop policy if exists tax_dayparts_admin_read   on public.taxonomy_dayparts;

create policy tax_genres_admin_read      on public.taxonomy_genres      for select using (exists(select 1 from public.users u where u.id=auth.uid() and u.role='admin'));
create policy tax_moods_admin_read       on public.taxonomy_moods       for select using (exists(select 1 from public.users u where u.id=auth.uid() and u.role='admin'));
create policy tax_store_types_admin_read on public.taxonomy_store_types for select using (exists(select 1 from public.users u where u.id=auth.uid() and u.role='admin'));
create policy tax_dayparts_admin_read    on public.taxonomy_dayparts    for select using (exists(select 1 from public.users u where u.id=auth.uid() and u.role='admin'));

-- ===== Seed 데이터 (1차 버전) =====

-- Genre 15종 — 매장 BGM 빈도 + Spotify/YT Music 표준 교집합
insert into public.taxonomy_genres(slug, name_ko, name_en, description, sort_order) values
  ('pop',       '팝',       'Pop',           '대중적인 팝 음악',                              10),
  ('kpop',      'K-Pop',    'K-Pop',         '한국 팝',                                      20),
  ('hiphop',    '힙합',     'Hip-Hop',       '힙합 / 랩',                                    30),
  ('rnb',       'R&B',      'R&B',           'R&B / 소울',                                   40),
  ('rock',      '록',       'Rock',          '록 / 얼터너티브 / 인디 록',                    50),
  ('indie',     '인디',     'Indie',         '인디 팝 / 포크',                               60),
  ('jazz',      '재즈',     'Jazz',          '재즈 / 스무스 재즈',                            70),
  ('classical', '클래식',   'Classical',     '클래식 / 뉴 에이지 / 챔버',                    80),
  ('lofi',      '로파이',   'Lo-fi',         'Lo-fi / chill / 스터디 음악',                  90),
  ('edm',       'EDM',      'EDM',           '일렉트로닉 댄스',                              100),
  ('house',     '하우스',   'House',         '하우스 / 디스코',                              110),
  ('acoustic',  '어쿠스틱', 'Acoustic',      '어쿠스틱 / 포크',                              120),
  ('ballad',    '발라드',   'Ballad',        '발라드 / 슬로우',                              130),
  ('jpop',      'J-Pop',    'J-Pop',         '일본 팝 / 시티팝',                              140),
  ('ost',       'OST',      'OST',           '영화 / 드라마 / 게임 사운드트랙',              150)
on conflict (slug) do update set
  name_ko = excluded.name_ko, name_en = excluded.name_en,
  description = excluded.description, sort_order = excluded.sort_order;

-- Mood 11종
insert into public.taxonomy_moods(slug, name_ko, name_en, description, sort_order) values
  ('calm',       '차분한',   'Calm',           '잔잔하고 안정된 분위기',                     10),
  ('warm',       '따뜻한',   'Warm',           '온기 있는 / 친근한 분위기',                   20),
  ('bright',     '밝은',     'Bright',         '밝고 산뜻한 분위기',                         30),
  ('happy',      '행복한',   'Happy',          '경쾌하고 행복한 분위기',                     40),
  ('emotional',  '감성적인', 'Emotional',      '감성적이고 서정적인 분위기',                 50),
  ('dreamy',     '몽환적인', 'Dreamy',         '몽환적이고 환상적인 분위기',                 60),
  ('chic',       '세련된',   'Chic',           '세련된 / 도시적인 분위기',                   70),
  ('luxurious',  '고급스러운', 'Luxurious',    '고급스럽고 우아한 분위기',                   80),
  ('energetic',  '에너지있는', 'Energetic',    '활기차고 에너지 넘치는 분위기',              90),
  ('trendy',     '트렌디한', 'Trendy',         '최신 유행 / 힙한 분위기',                    100),
  ('focused',    '집중되는', 'Focused',        '집중과 몰입에 적합한 분위기',                110)
on conflict (slug) do update set
  name_ko = excluded.name_ko, name_en = excluded.name_en,
  description = excluded.description, sort_order = excluded.sort_order;

-- Store Type 11종 — 매장 BGM 핵심 카테고리
insert into public.taxonomy_store_types(slug, name_ko, name_en, description, sort_order) values
  ('cafe',         '카페',         'Cafe',           '커피숍 / 디저트 카페',                       10),
  ('hospital',     '병원',         'Hospital',       '병원 / 의원 / 한의원',                       20),
  ('hotel',        '호텔',         'Hotel',          '호텔 라운지 / 로비',                         30),
  ('restaurant',   '레스토랑',     'Restaurant',     '레스토랑 / 와인바 / 파인 다이닝',           40),
  ('fitness',      '피트니스',     'Fitness',        '헬스장 / 요가 / 필라테스',                   50),
  ('boutique',     '편집샵',       'Boutique',       '편집샵 / 의류 / 잡화 매장',                  60),
  ('office',       '오피스',       'Office',         '사무실 / 코워킹 스페이스',                   70),
  ('study_cafe',   '스터디 카페',  'Study Cafe',     '스터디 카페 / 독서실',                       80),
  ('bakery',       '베이커리',     'Bakery',         '베이커리 / 디저트 전문',                     90),
  ('beauty_shop',  '뷰티샵',       'Beauty Shop',    '미용실 / 네일샵 / 스파',                    100),
  ('kids_zone',    '키즈존',       'Kids Zone',      '키즈 카페 / 어린이 놀이 공간',              110)
on conflict (slug) do update set
  name_ko = excluded.name_ko, name_en = excluded.name_en,
  description = excluded.description, sort_order = excluded.sort_order;

-- Daypart 6종
insert into public.taxonomy_dayparts(slug, name_ko, name_en, description, sort_order) values
  ('morning',     '아침',       'Morning',        '오전 6-10시 — 잔잔하고 산뜻한 시작',         10),
  ('brunch',      '브런치',     'Brunch',         '오전 10-12시 — 가벼운 브런치 분위기',        20),
  ('afternoon',   '오후',       'Afternoon',      '12-17시 — 활기차거나 차분한 오후',           30),
  ('rush',        '퇴근시간',   'Rush Hour',      '17-19시 — 퇴근 / 저녁 준비',                 40),
  ('evening',     '저녁',       'Evening',        '19-23시 — 저녁 식사 / 모임',                 50),
  ('late_night',  '심야',       'Late Night',     '23시 이후 — 심야 라운지 / 휴식',            60)
on conflict (slug) do update set
  name_ko = excluded.name_ko, name_en = excluded.name_en,
  description = excluded.description, sort_order = excluded.sort_order;

-- ===== RPC =====
-- 공개: 활성 항목만
create or replace function public.list_taxonomy_genres()
returns setof public.taxonomy_genres language sql security definer set search_path = public stable
as $$ select * from public.taxonomy_genres where is_active order by sort_order, slug $$;

create or replace function public.list_taxonomy_moods()
returns setof public.taxonomy_moods language sql security definer set search_path = public stable
as $$ select * from public.taxonomy_moods where is_active order by sort_order, slug $$;

create or replace function public.list_taxonomy_store_types()
returns setof public.taxonomy_store_types language sql security definer set search_path = public stable
as $$ select * from public.taxonomy_store_types where is_active order by sort_order, slug $$;

create or replace function public.list_taxonomy_dayparts()
returns setof public.taxonomy_dayparts language sql security definer set search_path = public stable
as $$ select * from public.taxonomy_dayparts where is_active order by sort_order, slug $$;

grant execute on function public.list_taxonomy_genres()     to anon, authenticated, service_role;
grant execute on function public.list_taxonomy_moods()      to anon, authenticated, service_role;
grant execute on function public.list_taxonomy_store_types() to anon, authenticated, service_role;
grant execute on function public.list_taxonomy_dayparts()   to anon, authenticated, service_role;

-- admin: 전체 (비활성 포함)
create or replace function public.admin_list_taxonomy(p_kind text)
returns table (
  id uuid, slug text, name_ko text, name_en text, description text,
  is_active boolean, sort_order int, created_at timestamptz
)
language plpgsql security definer set search_path = public stable
as $$
begin
  if not exists (select 1 from public.users u where u.id = auth.uid() and u.role='admin') then
    raise exception 'unauthorized';
  end if;
  if p_kind = 'genre' then
    return query select t.id, t.slug, t.name_ko, t.name_en, t.description, t.is_active, t.sort_order, t.created_at
      from public.taxonomy_genres t order by t.sort_order, t.slug;
  elsif p_kind = 'mood' then
    return query select t.id, t.slug, t.name_ko, t.name_en, t.description, t.is_active, t.sort_order, t.created_at
      from public.taxonomy_moods t order by t.sort_order, t.slug;
  elsif p_kind = 'store_type' then
    return query select t.id, t.slug, t.name_ko, t.name_en, t.description, t.is_active, t.sort_order, t.created_at
      from public.taxonomy_store_types t order by t.sort_order, t.slug;
  elsif p_kind = 'daypart' then
    return query select t.id, t.slug, t.name_ko, t.name_en, t.description, t.is_active, t.sort_order, t.created_at
      from public.taxonomy_dayparts t order by t.sort_order, t.slug;
  else
    raise exception 'unknown kind: %', p_kind;
  end if;
end;
$$;
revoke all on function public.admin_list_taxonomy(text) from public, anon;
grant execute on function public.admin_list_taxonomy(text) to authenticated, service_role;

-- admin: upsert (slug 기준) — 신규 추가 + 기존 행 갱신
create or replace function public.admin_upsert_taxonomy(
  p_kind text, p_slug text, p_name_ko text, p_name_en text,
  p_description text default null, p_is_active boolean default true, p_sort_order int default 100
)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.users u where u.id = auth.uid() and u.role='admin') then
    raise exception 'unauthorized';
  end if;
  if p_slug is null or length(trim(p_slug))=0 then raise exception 'slug required'; end if;
  if p_name_ko is null or p_name_en is null then raise exception 'name_ko/name_en required'; end if;

  if p_kind = 'genre' then
    insert into public.taxonomy_genres(slug, name_ko, name_en, description, is_active, sort_order)
    values (p_slug, p_name_ko, p_name_en, p_description, p_is_active, p_sort_order)
    on conflict (slug) do update set
      name_ko = excluded.name_ko, name_en = excluded.name_en,
      description = excluded.description, is_active = excluded.is_active, sort_order = excluded.sort_order;
  elsif p_kind = 'mood' then
    insert into public.taxonomy_moods(slug, name_ko, name_en, description, is_active, sort_order)
    values (p_slug, p_name_ko, p_name_en, p_description, p_is_active, p_sort_order)
    on conflict (slug) do update set
      name_ko = excluded.name_ko, name_en = excluded.name_en,
      description = excluded.description, is_active = excluded.is_active, sort_order = excluded.sort_order;
  elsif p_kind = 'store_type' then
    insert into public.taxonomy_store_types(slug, name_ko, name_en, description, is_active, sort_order)
    values (p_slug, p_name_ko, p_name_en, p_description, p_is_active, p_sort_order)
    on conflict (slug) do update set
      name_ko = excluded.name_ko, name_en = excluded.name_en,
      description = excluded.description, is_active = excluded.is_active, sort_order = excluded.sort_order;
  elsif p_kind = 'daypart' then
    insert into public.taxonomy_dayparts(slug, name_ko, name_en, description, is_active, sort_order)
    values (p_slug, p_name_ko, p_name_en, p_description, p_is_active, p_sort_order)
    on conflict (slug) do update set
      name_ko = excluded.name_ko, name_en = excluded.name_en,
      description = excluded.description, is_active = excluded.is_active, sort_order = excluded.sort_order;
  else
    raise exception 'unknown kind: %', p_kind;
  end if;
end;
$$;
revoke all on function public.admin_upsert_taxonomy(text, text, text, text, text, boolean, int) from public, anon;
grant execute on function public.admin_upsert_taxonomy(text, text, text, text, text, boolean, int) to authenticated, service_role;

create or replace function public.admin_toggle_taxonomy(p_kind text, p_slug text, p_active boolean)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.users u where u.id = auth.uid() and u.role='admin') then
    raise exception 'unauthorized';
  end if;
  if p_kind = 'genre' then
    update public.taxonomy_genres set is_active = p_active where slug = p_slug;
  elsif p_kind = 'mood' then
    update public.taxonomy_moods set is_active = p_active where slug = p_slug;
  elsif p_kind = 'store_type' then
    update public.taxonomy_store_types set is_active = p_active where slug = p_slug;
  elsif p_kind = 'daypart' then
    update public.taxonomy_dayparts set is_active = p_active where slug = p_slug;
  else
    raise exception 'unknown kind: %', p_kind;
  end if;
end;
$$;
revoke all on function public.admin_toggle_taxonomy(text, text, boolean) from public, anon;
grant execute on function public.admin_toggle_taxonomy(text, text, boolean) to authenticated, service_role;

create or replace function public.admin_delete_taxonomy(p_kind text, p_slug text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.users u where u.id = auth.uid() and u.role='admin') then
    raise exception 'unauthorized';
  end if;
  if p_kind = 'genre' then
    delete from public.taxonomy_genres where slug = p_slug;
  elsif p_kind = 'mood' then
    delete from public.taxonomy_moods where slug = p_slug;
  elsif p_kind = 'store_type' then
    delete from public.taxonomy_store_types where slug = p_slug;
  elsif p_kind = 'daypart' then
    delete from public.taxonomy_dayparts where slug = p_slug;
  else
    raise exception 'unknown kind: %', p_kind;
  end if;
end;
$$;
revoke all on function public.admin_delete_taxonomy(text, text) from public, anon;
grant execute on function public.admin_delete_taxonomy(text, text) to authenticated, service_role;
