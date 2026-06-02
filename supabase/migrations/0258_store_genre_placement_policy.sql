-- 0258 — 매장별 장르/보컬 배치 정책 (Store Genre Placement Policy v1)
--
-- 첨부 "매장별 장르 배치" 문서를 기준으로 매장(store_type)별 허용 장르/보컬 정책을 DB 에 반영한다.
--
-- 절대 원칙 (사용자 spec):
--   - 기존 playlist_tracks 자동 삭제 금지. 위반은 review_needed / admin_qc_queue 후보로만 전환.
--   - 정책 수정은 관리자(role='admin')만 가능.
--   - 신규 업로드/재검수/자동배치 모두 이 정책을 경유.
--
-- 구성:
--   A. store_genre_placement_rules (정책 본체)
--   B. genre_aliases / store_policy_aliases (정규화 테이블)
--   C. store_policy_enforcement (매장별 hard/soft + 기본 severity)
--   D. normalize_policy_genre / normalize_policy_store_type (정규화 RPC)
--   E. seed (문서의 20개 매장 전부)
--   F. check_store_genre_policy (track × store 판정)
--   G. _record_store_genre_qc (QC 큐 적재 helper)
--   H. auto_place_track v4 (정책 hard/soft guardrail 반영)
--   I. admin_backfill_store_genre_policy_review (전체 백필 + dry_run)
--   J. admin RPC (목록/요약/토글/priority/위반 목록)
--   K. admin_qc_rules 등록 (3개 issue_type)

-- =====================================================================
-- A. 정책 본체
-- =====================================================================
create table if not exists public.store_genre_placement_rules (
  id                    uuid primary key default gen_random_uuid(),
  store_type            text not null,           -- 문서 원문 라벨 (예: '병원/클리닉')
  normalized_store_type text not null,           -- 정규화 슬러그 (예: 'hospital')
  genre                 text not null,           -- 문서 원문 장르 라벨 (예: 'Lo-fi Instrumental')
  normalized_genre      text not null,           -- 정규화 장르 슬러그 (예: 'lofi')
  vocal_policy          text not null check (vocal_policy in ('vocal','instrumental','vocal_rap')),
  is_allowed            boolean not null default true,
  priority              int not null default 100,
  source                text not null default 'admin_policy_v1',
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (normalized_store_type, normalized_genre, vocal_policy, source)
);
create index if not exists ix_sgpr_store on public.store_genre_placement_rules(normalized_store_type, is_allowed);
create index if not exists ix_sgpr_genre on public.store_genre_placement_rules(normalized_genre);

alter table public.store_genre_placement_rules enable row level security;
drop policy if exists sgpr_public_read on public.store_genre_placement_rules;
create policy sgpr_public_read on public.store_genre_placement_rules for select using (true);
drop policy if exists sgpr_admin_write on public.store_genre_placement_rules;
create policy sgpr_admin_write on public.store_genre_placement_rules for all to authenticated
  using (exists (select 1 from public.users u where u.id = auth.uid() and u.role='admin'))
  with check (exists (select 1 from public.users u where u.id = auth.uid() and u.role='admin'));

-- =====================================================================
-- B. 정규화 테이블
-- =====================================================================
create table if not exists public.genre_aliases (
  id               bigserial primary key,
  raw_label        text not null,
  normalized_genre text not null,
  created_at       timestamptz not null default now(),
  unique (raw_label)
);
create index if not exists ix_genre_aliases_norm on public.genre_aliases(normalized_genre);

create table if not exists public.store_policy_aliases (
  id                    bigserial primary key,
  raw_label             text not null,
  normalized_store_type text not null,
  created_at            timestamptz not null default now(),
  unique (raw_label)
);
create index if not exists ix_store_policy_aliases_norm on public.store_policy_aliases(normalized_store_type);

alter table public.genre_aliases enable row level security;
alter table public.store_policy_aliases enable row level security;
drop policy if exists genre_aliases_read on public.genre_aliases;
create policy genre_aliases_read on public.genre_aliases for select using (true);
drop policy if exists genre_aliases_admin on public.genre_aliases;
create policy genre_aliases_admin on public.genre_aliases for all to authenticated
  using (exists (select 1 from public.users u where u.id = auth.uid() and u.role='admin'))
  with check (exists (select 1 from public.users u where u.id = auth.uid() and u.role='admin'));
drop policy if exists store_policy_aliases_read on public.store_policy_aliases;
create policy store_policy_aliases_read on public.store_policy_aliases for select using (true);
drop policy if exists store_policy_aliases_admin on public.store_policy_aliases;
create policy store_policy_aliases_admin on public.store_policy_aliases for all to authenticated
  using (exists (select 1 from public.users u where u.id = auth.uid() and u.role='admin'))
  with check (exists (select 1 from public.users u where u.id = auth.uid() and u.role='admin'));

-- =====================================================================
-- C. 매장별 enforcement (hard/soft) + 기본 severity
--    문서 §6, §7 기준:
--      hard block : 병원/호텔/파인다이닝/서점 (조용/앰비언트 위주) → HIGH
--      soft       : 술집/헬스/편집샵 → LOW
--      그 외       : soft → MEDIUM
-- =====================================================================
create table if not exists public.store_policy_enforcement (
  normalized_store_type text primary key,
  enforcement           text not null check (enforcement in ('hard','soft')),
  default_severity      text not null check (default_severity in ('LOW','MEDIUM','HIGH','CRITICAL')),
  updated_at            timestamptz not null default now()
);
alter table public.store_policy_enforcement enable row level security;
drop policy if exists spe_read on public.store_policy_enforcement;
create policy spe_read on public.store_policy_enforcement for select using (true);
drop policy if exists spe_admin on public.store_policy_enforcement;
create policy spe_admin on public.store_policy_enforcement for all to authenticated
  using (exists (select 1 from public.users u where u.id = auth.uid() and u.role='admin'))
  with check (exists (select 1 from public.users u where u.id = auth.uid() and u.role='admin'));

insert into public.store_policy_enforcement(normalized_store_type, enforcement, default_severity) values
  ('hospital','hard','HIGH'),
  ('hotel','hard','HIGH'),
  ('fine_dining','hard','HIGH'),
  ('bookstore','hard','HIGH'),
  ('cafe','soft','MEDIUM'),
  ('winebar','soft','MEDIUM'),
  ('office','soft','MEDIUM'),
  ('nail_shop','soft','MEDIUM'),
  ('pub','soft','LOW'),
  ('gym','soft','LOW'),
  ('select_shop','soft','LOW'),
  ('hair_salon','soft','MEDIUM'),
  ('korean_food','soft','MEDIUM'),
  ('japanese_food','soft','MEDIUM'),
  ('chinese_food','soft','MEDIUM'),
  ('western_food','soft','MEDIUM'),
  ('izakaya','soft','MEDIUM'),
  ('studio','soft','MEDIUM'),
  ('flower_shop','soft','MEDIUM'),
  ('showroom','soft','MEDIUM')
on conflict (normalized_store_type) do update set
  enforcement = excluded.enforcement,
  default_severity = excluded.default_severity,
  updated_at = now();

-- =====================================================================
-- D. 정규화 RPC
-- =====================================================================
create or replace function public.normalize_policy_genre(p_label text)
returns text
language sql
security definer
set search_path = public
stable
as $$
  select a.normalized_genre
  from public.genre_aliases a
  where lower(btrim(a.raw_label)) = lower(btrim(coalesce(p_label, '')))
  limit 1;
$$;
grant execute on function public.normalize_policy_genre(text) to anon, authenticated, service_role;

create or replace function public.normalize_policy_store_type(p_label text)
returns text
language sql
security definer
set search_path = public
stable
as $$
  select a.normalized_store_type
  from public.store_policy_aliases a
  where lower(btrim(a.raw_label)) = lower(btrim(coalesce(p_label, '')))
  limit 1;
$$;
grant execute on function public.normalize_policy_store_type(text) to anon, authenticated, service_role;

-- =====================================================================
-- E. SEED — genre_aliases
-- =====================================================================
insert into public.genre_aliases(raw_label, normalized_genre) values
  ('Indie Pop','indie_pop'),('indie pop','indie_pop'),('indie-pop','indie_pop'),('indiepop','indie_pop'),('인디팝','indie_pop'),('인디 팝','indie_pop'),('인디','indie_pop'),
  ('K-R&B','krnb'),('krnb','krnb'),('k r&b','krnb'),('k-rnb','krnb'),('케이알앤비','krnb'),
  ('Jazz','jazz'),('재즈','jazz'),
  ('R&B','rnb'),('rnb','rnb'),('알앤비','rnb'),
  ('Lo-fi','lofi'),('lofi','lofi'),('lo fi','lofi'),('로파이','lofi'),
  ('Jazzhop','jazzhop'),('jazz hop','jazzhop'),('jazz-hop','jazzhop'),
  ('Cafe Music','cafe_music'),('cafe-music','cafe_music'),('카페뮤직','cafe_music'),('카페 음악','cafe_music'),
  ('Piano','piano'),('피아노','piano'),
  ('Ambient','ambient'),('앰비언트','ambient'),
  ('Meditation','meditation'),('명상','meditation'),
  ('Alternative','alternative'),('얼터너티브','alternative'),('alt','alternative'),
  ('House','house'),('하우스','house'),
  ('Electronic','electronic'),('electronica','electronic'),('EDM','electronic'),('일렉트로닉','electronic'),
  ('Synthwave','synthwave'),('신스웨이브','synthwave'),
  ('POP','pop'),('Pop','pop'),('팝','pop'),
  ('Disco','disco'),('디스코','disco'),
  ('City Pop','city_pop'),('citypop','city_pop'),('city-pop','city_pop'),('시티팝','city_pop'),('시티 팝','city_pop'),
  ('Ballad','ballad'),('발라드','ballad'),
  ('Acoustic','acoustic'),('어쿠스틱','acoustic'),
  ('Folk','folk'),('포크','folk'),
  ('J-Pop','jpop'),('jpop','jpop'),('제이팝','jpop'),
  ('Retro Pop','retro_pop'),('retropop','retro_pop'),('retro-pop','retro_pop'),('레트로팝','retro_pop'),
  ('Funk','funk'),('펑크','funk'),
  ('Soul','soul'),('소울','soul'),
  ('Classical','classical'),('클래식','classical'),
  ('Blues','blues'),('블루스','blues'),
  ('J-Rock','jrock'),('jrock','jrock'),('제이록','jrock'),
  ('Hip-Hop','hiphop'),('Hip Hop','hiphop'),('hiphop','hiphop'),('힙합','hiphop'),
  ('Hip-Hop Vocal/Rap','hiphop'),('Hip Hop Vocal','hiphop'),
  ('K-Hip Hop','khiphop'),('khiphop','khiphop'),('k-hiphop','khiphop'),('k hip hop','khiphop'),('케이힙합','khiphop'),
  ('K-Hip Hop Vocal/Rap','khiphop'),
  ('Drum & Bass','dnb'),('drum and bass','dnb'),('dnb','dnb'),('d&b','dnb'),('드럼앤베이스','dnb'),
  ('Phonk','phonk'),
  ('UK Garage','uk_garage'),('uk-garage','uk_garage'),('ukgarage','uk_garage'),
  ('K-POP','kpop'),('kpop','kpop'),('k-pop','kpop'),('케이팝','kpop'),
  ('Reggaeton','reggaeton'),('레게톤','reggaeton'),
  ('Lounge','lounge'),('라운지','lounge'),
  ('Chillhop','chillhop'),('chill hop','chillhop'),('칠합','chillhop'),
  ('Rock','rock'),('록','rock'),('락','rock')
on conflict (raw_label) do update set normalized_genre = excluded.normalized_genre;

-- =====================================================================
-- E2. SEED — store_policy_aliases
-- =====================================================================
insert into public.store_policy_aliases(raw_label, normalized_store_type) values
  ('카페','cafe'),('Cafe','cafe'),('cafe','cafe'),('커피숍','cafe'),
  ('병원','hospital'),('클리닉','hospital'),('병원/클리닉','hospital'),('의원','hospital'),('Hospital','hospital'),('Clinic','hospital'),
  ('편집샵','select_shop'),('셀렉트샵','select_shop'),('Select Shop','select_shop'),
  ('미용실','hair_salon'),('헤어샵','hair_salon'),('Hair Salon','hair_salon'),
  ('한식','korean_food'),('한식당','korean_food'),('Korean Food','korean_food'),
  ('일식','japanese_food'),('일식당','japanese_food'),('Japanese Food','japanese_food'),
  ('중식','chinese_food'),('중식당','chinese_food'),('Chinese Food','chinese_food'),
  ('양식','western_food'),('양식당','western_food'),('Western Food','western_food'),
  ('파인다이닝','fine_dining'),('다이닝','fine_dining'),('파인다이닝/다이닝','fine_dining'),('Fine Dining','fine_dining'),
  ('이자카야','izakaya'),('Izakaya','izakaya'),
  ('술집','pub'),('펍','pub'),('술집/펍','pub'),('Pub','pub'),
  ('와인바','winebar'),('Wine Bar','winebar'),('와인 바','winebar'),
  ('헬스','gym'),('헬스장','gym'),('피트니스','gym'),('Gym','gym'),
  ('호텔','hotel'),('라운지','hotel'),('호텔/라운지','hotel'),('호텔 라운지','hotel'),('Hotel','hotel'),('Lounge','hotel'),
  ('사무실','office'),('오피스','office'),('Office','office'),
  ('네일샵','nail_shop'),('네일','nail_shop'),('Nail Shop','nail_shop'),
  ('스튜디오','studio'),('Studio','studio'),
  ('서점','bookstore'),('북스토어','bookstore'),('Bookstore','bookstore'),
  ('플라워샵','flower_shop'),('화원','flower_shop'),('플라워샵/화원','flower_shop'),('꽃집','flower_shop'),
  ('쇼룸','showroom'),('Showroom','showroom'),('전시장','showroom')
on conflict (raw_label) do update set normalized_store_type = excluded.normalized_store_type;

-- =====================================================================
-- E3. SEED — store_genre_placement_rules (문서 20개 매장 전부)
--   (normalized_store_type, store_type, genre, normalized_genre, vocal_policy)
-- =====================================================================
insert into public.store_genre_placement_rules
  (normalized_store_type, store_type, genre, normalized_genre, vocal_policy, source)
values
  -- 카페
  ('cafe','카페','Indie Pop Vocal','indie_pop','vocal','admin_policy_v1'),
  ('cafe','카페','K-R&B Vocal','krnb','vocal','admin_policy_v1'),
  ('cafe','카페','Jazz Vocal','jazz','vocal','admin_policy_v1'),
  ('cafe','카페','R&B Vocal','rnb','vocal','admin_policy_v1'),
  ('cafe','카페','Lo-fi Instrumental','lofi','instrumental','admin_policy_v1'),
  ('cafe','카페','Jazzhop Instrumental','jazzhop','instrumental','admin_policy_v1'),
  ('cafe','카페','Cafe Music Instrumental','cafe_music','instrumental','admin_policy_v1'),
  ('cafe','카페','Indie Pop Instrumental','indie_pop','instrumental','admin_policy_v1'),
  ('cafe','카페','R&B Instrumental','rnb','instrumental','admin_policy_v1'),
  ('cafe','카페','K-R&B Instrumental','krnb','instrumental','admin_policy_v1'),
  -- 병원/클리닉
  ('hospital','병원/클리닉','Piano Instrumental','piano','instrumental','admin_policy_v1'),
  ('hospital','병원/클리닉','Ambient Instrumental','ambient','instrumental','admin_policy_v1'),
  ('hospital','병원/클리닉','Meditation Instrumental','meditation','instrumental','admin_policy_v1'),
  ('hospital','병원/클리닉','Lo-fi Instrumental','lofi','instrumental','admin_policy_v1'),
  ('hospital','병원/클리닉','Jazz Instrumental','jazz','instrumental','admin_policy_v1'),
  -- 편집샵
  ('select_shop','편집샵','Alternative Vocal','alternative','vocal','admin_policy_v1'),
  ('select_shop','편집샵','House Vocal','house','vocal','admin_policy_v1'),
  ('select_shop','편집샵','Electronic Vocal','electronic','vocal','admin_policy_v1'),
  ('select_shop','편집샵','Synthwave Vocal','synthwave','vocal','admin_policy_v1'),
  ('select_shop','편집샵','Electronic Instrumental','electronic','instrumental','admin_policy_v1'),
  ('select_shop','편집샵','House Instrumental','house','instrumental','admin_policy_v1'),
  ('select_shop','편집샵','Synthwave Instrumental','synthwave','instrumental','admin_policy_v1'),
  ('select_shop','편집샵','Alternative Instrumental','alternative','instrumental','admin_policy_v1'),
  -- 미용실
  ('hair_salon','미용실','POP Vocal','pop','vocal','admin_policy_v1'),
  ('hair_salon','미용실','K-R&B Vocal','krnb','vocal','admin_policy_v1'),
  ('hair_salon','미용실','City Pop Vocal','city_pop','vocal','admin_policy_v1'),
  ('hair_salon','미용실','Indie Pop Vocal','indie_pop','vocal','admin_policy_v1'),
  ('hair_salon','미용실','Lounge Instrumental','lounge','instrumental','admin_policy_v1'),
  ('hair_salon','미용실','Disco Instrumental','disco','instrumental','admin_policy_v1'),
  ('hair_salon','미용실','House Instrumental','house','instrumental','admin_policy_v1'),
  ('hair_salon','미용실','POP Instrumental','pop','instrumental','admin_policy_v1'),
  ('hair_salon','미용실','Indie Pop Instrumental','indie_pop','instrumental','admin_policy_v1'),
  ('hair_salon','미용실','R&B Instrumental','rnb','instrumental','admin_policy_v1'),
  -- 한식
  ('korean_food','한식','Ballad Vocal','ballad','vocal','admin_policy_v1'),
  ('korean_food','한식','Indie Pop Vocal','indie_pop','vocal','admin_policy_v1'),
  ('korean_food','한식','Acoustic Instrumental','acoustic','instrumental','admin_policy_v1'),
  ('korean_food','한식','Piano Instrumental','piano','instrumental','admin_policy_v1'),
  ('korean_food','한식','Folk Instrumental','folk','instrumental','admin_policy_v1'),
  ('korean_food','한식','Ballad Instrumental','ballad','instrumental','admin_policy_v1'),
  -- 일식
  ('japanese_food','일식','J-Pop Vocal','jpop','vocal','admin_policy_v1'),
  ('japanese_food','일식','City Pop Vocal','city_pop','vocal','admin_policy_v1'),
  ('japanese_food','일식','Jazz Instrumental','jazz','instrumental','admin_policy_v1'),
  ('japanese_food','일식','Lo-fi Instrumental','lofi','instrumental','admin_policy_v1'),
  ('japanese_food','일식','Lounge Instrumental','lounge','instrumental','admin_policy_v1'),
  ('japanese_food','일식','City Pop Instrumental','city_pop','instrumental','admin_policy_v1'),
  ('japanese_food','일식','J-Pop Instrumental','jpop','instrumental','admin_policy_v1'),
  ('japanese_food','일식','Piano Instrumental','piano','instrumental','admin_policy_v1'),
  -- 중식
  ('chinese_food','중식','Retro Pop Vocal','retro_pop','vocal','admin_policy_v1'),
  ('chinese_food','중식','POP Vocal','pop','vocal','admin_policy_v1'),
  ('chinese_food','중식','Hip Hop Vocal','hiphop','vocal','admin_policy_v1'),
  ('chinese_food','중식','Soul Vocal','soul','vocal','admin_policy_v1'),
  ('chinese_food','중식','Funk Instrumental','funk','instrumental','admin_policy_v1'),
  ('chinese_food','중식','Disco Instrumental','disco','instrumental','admin_policy_v1'),
  ('chinese_food','중식','House Instrumental','house','instrumental','admin_policy_v1'),
  ('chinese_food','중식','Hip Hop Instrumental','hiphop','instrumental','admin_policy_v1'),
  ('chinese_food','중식','Retro Pop Instrumental','retro_pop','instrumental','admin_policy_v1'),
  ('chinese_food','중식','Lounge Instrumental','lounge','instrumental','admin_policy_v1'),
  ('chinese_food','중식','Jazzhop Instrumental','jazzhop','instrumental','admin_policy_v1'),
  ('chinese_food','중식','Soul Instrumental','soul','instrumental','admin_policy_v1'),
  -- 양식
  ('western_food','양식','Jazz Vocal','jazz','vocal','admin_policy_v1'),
  ('western_food','양식','Soul Vocal','soul','vocal','admin_policy_v1'),
  ('western_food','양식','Lounge Instrumental','lounge','instrumental','admin_policy_v1'),
  ('western_food','양식','Piano Instrumental','piano','instrumental','admin_policy_v1'),
  ('western_food','양식','Acoustic Instrumental','acoustic','instrumental','admin_policy_v1'),
  ('western_food','양식','Jazz Instrumental','jazz','instrumental','admin_policy_v1'),
  ('western_food','양식','POP Instrumental','pop','instrumental','admin_policy_v1'),
  ('western_food','양식','Soul Instrumental','soul','instrumental','admin_policy_v1'),
  -- 파인다이닝/다이닝
  ('fine_dining','파인다이닝/다이닝','Classical Instrumental','classical','instrumental','admin_policy_v1'),
  ('fine_dining','파인다이닝/다이닝','Piano Instrumental','piano','instrumental','admin_policy_v1'),
  ('fine_dining','파인다이닝/다이닝','Ambient Instrumental','ambient','instrumental','admin_policy_v1'),
  ('fine_dining','파인다이닝/다이닝','Blues Instrumental','blues','instrumental','admin_policy_v1'),
  ('fine_dining','파인다이닝/다이닝','Jazz Instrumental','jazz','instrumental','admin_policy_v1'),
  ('fine_dining','파인다이닝/다이닝','Soul Instrumental','soul','instrumental','admin_policy_v1'),
  -- 이자카야
  ('izakaya','이자카야','J-Rock Vocal','jrock','vocal','admin_policy_v1'),
  ('izakaya','이자카야','J-Pop Vocal','jpop','vocal','admin_policy_v1'),
  ('izakaya','이자카야','City Pop Vocal','city_pop','vocal','admin_policy_v1'),
  ('izakaya','이자카야','City Pop Instrumental','city_pop','instrumental','admin_policy_v1'),
  ('izakaya','이자카야','Funk Instrumental','funk','instrumental','admin_policy_v1'),
  ('izakaya','이자카야','Lo-fi Instrumental','lofi','instrumental','admin_policy_v1'),
  ('izakaya','이자카야','J-Pop Instrumental','jpop','instrumental','admin_policy_v1'),
  -- 술집/펍
  ('pub','술집/펍','Rock Vocal','rock','vocal','admin_policy_v1'),
  ('pub','술집/펍','Hip-Hop Vocal/Rap','hiphop','vocal_rap','admin_policy_v1'),
  ('pub','술집/펍','Alternative Vocal','alternative','vocal','admin_policy_v1'),
  ('pub','술집/펍','Drum & Bass Vocal','dnb','vocal','admin_policy_v1'),
  ('pub','술집/펍','POP Vocal','pop','vocal','admin_policy_v1'),
  ('pub','술집/펍','Electronic Vocal','electronic','vocal','admin_policy_v1'),
  ('pub','술집/펍','Phonk Vocal','phonk','vocal','admin_policy_v1'),
  ('pub','술집/펍','Funk Vocal','funk','vocal','admin_policy_v1'),
  ('pub','술집/펍','Blues Vocal','blues','vocal','admin_policy_v1'),
  ('pub','술집/펍','K-POP Vocal','kpop','vocal','admin_policy_v1'),
  ('pub','술집/펍','Blues Instrumental','blues','instrumental','admin_policy_v1'),
  ('pub','술집/펍','Funk Instrumental','funk','instrumental','admin_policy_v1'),
  ('pub','술집/펍','Drum & Bass Instrumental','dnb','instrumental','admin_policy_v1'),
  ('pub','술집/펍','Hip-Hop Vocal/Rap Instrumental','hiphop','instrumental','admin_policy_v1'),
  ('pub','술집/펍','POP Instrumental','pop','instrumental','admin_policy_v1'),
  ('pub','술집/펍','Electronic Instrumental','electronic','instrumental','admin_policy_v1'),
  ('pub','술집/펍','Phonk Instrumental','phonk','instrumental','admin_policy_v1'),
  ('pub','술집/펍','Rock Instrumental','rock','instrumental','admin_policy_v1'),
  ('pub','술집/펍','UK Garage Instrumental','uk_garage','instrumental','admin_policy_v1'),
  ('pub','술집/펍','K-POP Instrumental','kpop','instrumental','admin_policy_v1'),
  -- 와인바
  ('winebar','와인바','Jazz Vocal','jazz','vocal','admin_policy_v1'),
  ('winebar','와인바','R&B Vocal','rnb','vocal','admin_policy_v1'),
  ('winebar','와인바','Blues Vocal','blues','vocal','admin_policy_v1'),
  ('winebar','와인바','Jazz Instrumental','jazz','instrumental','admin_policy_v1'),
  ('winebar','와인바','Lounge Instrumental','lounge','instrumental','admin_policy_v1'),
  ('winebar','와인바','Piano Instrumental','piano','instrumental','admin_policy_v1'),
  ('winebar','와인바','R&B Instrumental','rnb','instrumental','admin_policy_v1'),
  ('winebar','와인바','Blues Instrumental','blues','instrumental','admin_policy_v1'),
  ('winebar','와인바','City Pop Instrumental','city_pop','instrumental','admin_policy_v1'),
  -- 헬스
  ('gym','헬스','Hip-Hop Vocal/Rap','hiphop','vocal_rap','admin_policy_v1'),
  ('gym','헬스','K-Hip Hop Vocal/Rap','khiphop','vocal_rap','admin_policy_v1'),
  ('gym','헬스','Reggaeton Vocal','reggaeton','vocal','admin_policy_v1'),
  ('gym','헬스','Rock Vocal','rock','vocal','admin_policy_v1'),
  ('gym','헬스','Phonk Instrumental','phonk','instrumental','admin_policy_v1'),
  ('gym','헬스','Drum & Bass Instrumental','dnb','instrumental','admin_policy_v1'),
  ('gym','헬스','Electronic Instrumental','electronic','instrumental','admin_policy_v1'),
  ('gym','헬스','Reggaeton Instrumental','reggaeton','instrumental','admin_policy_v1'),
  ('gym','헬스','UK Garage Instrumental','uk_garage','instrumental','admin_policy_v1'),
  ('gym','헬스','Rock Instrumental','rock','instrumental','admin_policy_v1'),
  ('gym','헬스','Hip-Hop Vocal/Rap Instrumental','hiphop','instrumental','admin_policy_v1'),
  ('gym','헬스','K-Hip Hop Vocal/Rap Instrumental','khiphop','instrumental','admin_policy_v1'),
  -- 호텔/라운지
  ('hotel','호텔/라운지','Lounge Instrumental','lounge','instrumental','admin_policy_v1'),
  ('hotel','호텔/라운지','Ambient Instrumental','ambient','instrumental','admin_policy_v1'),
  ('hotel','호텔/라운지','Piano Instrumental','piano','instrumental','admin_policy_v1'),
  ('hotel','호텔/라운지','House Instrumental','house','instrumental','admin_policy_v1'),
  ('hotel','호텔/라운지','Jazz Instrumental','jazz','instrumental','admin_policy_v1'),
  ('hotel','호텔/라운지','R&B Instrumental','rnb','instrumental','admin_policy_v1'),
  ('hotel','호텔/라운지','Soul Instrumental','soul','instrumental','admin_policy_v1'),
  -- 사무실
  ('office','사무실','Indie Pop Vocal','indie_pop','vocal','admin_policy_v1'),
  ('office','사무실','Acoustic Vocal','acoustic','vocal','admin_policy_v1'),
  ('office','사무실','Folk Vocal','folk','vocal','admin_policy_v1'),
  ('office','사무실','Chillhop Instrumental','chillhop','instrumental','admin_policy_v1'),
  ('office','사무실','Lo-fi Instrumental','lofi','instrumental','admin_policy_v1'),
  ('office','사무실','Piano Instrumental','piano','instrumental','admin_policy_v1'),
  ('office','사무실','Folk Instrumental','folk','instrumental','admin_policy_v1'),
  ('office','사무실','Indie Pop Instrumental','indie_pop','instrumental','admin_policy_v1'),
  ('office','사무실','Acoustic Instrumental','acoustic','instrumental','admin_policy_v1'),
  ('office','사무실','Jazz Instrumental','jazz','instrumental','admin_policy_v1'),
  ('office','사무실','Blues Instrumental','blues','instrumental','admin_policy_v1'),
  ('office','사무실','Jazzhop Instrumental','jazzhop','instrumental','admin_policy_v1'),
  ('office','사무실','Soul Instrumental','soul','instrumental','admin_policy_v1'),
  ('office','사무실','Ambient Instrumental','ambient','instrumental','admin_policy_v1'),
  -- 네일샵
  ('nail_shop','네일샵','K-R&B Vocal','krnb','vocal','admin_policy_v1'),
  ('nail_shop','네일샵','POP Vocal','pop','vocal','admin_policy_v1'),
  ('nail_shop','네일샵','City Pop Vocal','city_pop','vocal','admin_policy_v1'),
  ('nail_shop','네일샵','Indie Pop Vocal','indie_pop','vocal','admin_policy_v1'),
  ('nail_shop','네일샵','R&B Vocal','rnb','vocal','admin_policy_v1'),
  ('nail_shop','네일샵','Jazzhop Vocal','jazzhop','vocal','admin_policy_v1'),
  ('nail_shop','네일샵','Jazz Vocal','jazz','vocal','admin_policy_v1'),
  ('nail_shop','네일샵','Jazzhop Instrumental','jazzhop','instrumental','admin_policy_v1'),
  ('nail_shop','네일샵','Lounge Instrumental','lounge','instrumental','admin_policy_v1'),
  ('nail_shop','네일샵','Cafe Music Instrumental','cafe_music','instrumental','admin_policy_v1'),
  ('nail_shop','네일샵','Piano Instrumental','piano','instrumental','admin_policy_v1'),
  ('nail_shop','네일샵','Acoustic Instrumental','acoustic','instrumental','admin_policy_v1'),
  ('nail_shop','네일샵','Jazz Instrumental','jazz','instrumental','admin_policy_v1'),
  ('nail_shop','네일샵','Indie Pop Instrumental','indie_pop','instrumental','admin_policy_v1'),
  ('nail_shop','네일샵','R&B Instrumental','rnb','instrumental','admin_policy_v1'),
  -- 스튜디오
  ('studio','스튜디오','Alternative Vocal','alternative','vocal','admin_policy_v1'),
  ('studio','스튜디오','R&B Vocal','rnb','vocal','admin_policy_v1'),
  ('studio','스튜디오','Hip-Hop Vocal/Rap','hiphop','vocal_rap','admin_policy_v1'),
  ('studio','스튜디오','Jazzhop Vocal','jazzhop','vocal','admin_policy_v1'),
  ('studio','스튜디오','Soul Vocal','soul','vocal','admin_policy_v1'),
  ('studio','스튜디오','House Vocal','house','vocal','admin_policy_v1'),
  ('studio','스튜디오','Jazzhop Instrumental','jazzhop','instrumental','admin_policy_v1'),
  ('studio','스튜디오','Soul Instrumental','soul','instrumental','admin_policy_v1'),
  ('studio','스튜디오','House Instrumental','house','instrumental','admin_policy_v1'),
  ('studio','스튜디오','Hip-Hop Instrumental','hiphop','instrumental','admin_policy_v1'),
  ('studio','스튜디오','Alternative Instrumental','alternative','instrumental','admin_policy_v1'),
  ('studio','스튜디오','R&B Instrumental','rnb','instrumental','admin_policy_v1'),
  -- 서점
  ('bookstore','서점','Classical Instrumental','classical','instrumental','admin_policy_v1'),
  ('bookstore','서점','Piano Instrumental','piano','instrumental','admin_policy_v1'),
  ('bookstore','서점','Ambient Instrumental','ambient','instrumental','admin_policy_v1'),
  ('bookstore','서점','Acoustic Instrumental','acoustic','instrumental','admin_policy_v1'),
  ('bookstore','서점','Jazz Instrumental','jazz','instrumental','admin_policy_v1'),
  ('bookstore','서점','Lo-fi Instrumental','lofi','instrumental','admin_policy_v1'),
  ('bookstore','서점','Jazzhop Instrumental','jazzhop','instrumental','admin_policy_v1'),
  -- 플라워 샵/화원
  ('flower_shop','플라워샵/화원','Acoustic Vocal','acoustic','vocal','admin_policy_v1'),
  ('flower_shop','플라워샵/화원','Indie Pop Vocal','indie_pop','vocal','admin_policy_v1'),
  ('flower_shop','플라워샵/화원','Jazz Vocal','jazz','vocal','admin_policy_v1'),
  ('flower_shop','플라워샵/화원','Folk Instrumental','folk','instrumental','admin_policy_v1'),
  ('flower_shop','플라워샵/화원','Piano Instrumental','piano','instrumental','admin_policy_v1'),
  ('flower_shop','플라워샵/화원','Cafe Music Instrumental','cafe_music','instrumental','admin_policy_v1'),
  ('flower_shop','플라워샵/화원','Indie Pop Instrumental','indie_pop','instrumental','admin_policy_v1'),
  ('flower_shop','플라워샵/화원','Acoustic Instrumental','acoustic','instrumental','admin_policy_v1'),
  ('flower_shop','플라워샵/화원','Ballad Instrumental','ballad','instrumental','admin_policy_v1'),
  ('flower_shop','플라워샵/화원','Jazz Instrumental','jazz','instrumental','admin_policy_v1'),
  -- 쇼룸
  ('showroom','쇼룸','R&B Vocal','rnb','vocal','admin_policy_v1'),
  ('showroom','쇼룸','Alternative Vocal','alternative','vocal','admin_policy_v1'),
  ('showroom','쇼룸','House Vocal','house','vocal','admin_policy_v1'),
  ('showroom','쇼룸','Soul Vocal','soul','vocal','admin_policy_v1'),
  ('showroom','쇼룸','Lounge Instrumental','lounge','instrumental','admin_policy_v1'),
  ('showroom','쇼룸','House Instrumental','house','instrumental','admin_policy_v1'),
  ('showroom','쇼룸','R&B Instrumental','rnb','instrumental','admin_policy_v1'),
  ('showroom','쇼룸','Alternative Instrumental','alternative','instrumental','admin_policy_v1'),
  ('showroom','쇼룸','Blues Instrumental','blues','instrumental','admin_policy_v1')
on conflict (normalized_store_type, normalized_genre, vocal_policy, source) do update set
  store_type = excluded.store_type,
  genre = excluded.genre,
  is_allowed = true,
  updated_at = now();

-- =====================================================================
-- F. check_store_genre_policy — track × store 정책 판정
--   반환 status: 'no_policy' | 'unknown_genre' | 'allowed'
--                | 'vocal_policy_violation' | 'unsupported_store_genre'
-- =====================================================================
create or replace function public.check_store_genre_policy(p_track_id uuid, p_store_label text)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_t record;
  v_store text;
  v_genre text;
  v_vp text;            -- 트랙 보컬 정책: 'vocal' | 'instrumental'
  v_enf record;
  v_genre_in_store boolean;
  v_exact boolean;
  v_status text;
  v_issue text;
  v_sev text;
begin
  select * into v_t from public.tracks where id = p_track_id;
  if not found then
    return jsonb_build_object('status','no_policy','reason','track_not_found');
  end if;

  v_store := public.normalize_policy_store_type(p_store_label);
  if v_store is null then
    return jsonb_build_object('status','no_policy','store_label',p_store_label,
      'reason','store_type 정책 없음(정규화 불가)');
  end if;

  -- 매장에 등록된 규칙이 없으면 정책 미적용
  if not exists (select 1 from public.store_genre_placement_rules r
                 where r.normalized_store_type = v_store and r.is_allowed) then
    return jsonb_build_object('status','no_policy','normalized_store_type',v_store,
      'reason','해당 매장 정책 미등록');
  end if;

  -- 트랙 보컬 정책
  v_vp := case when coalesce(v_t.instrumental,false) or lower(coalesce(v_t.vocal_type,'')) = 'instrumental'
               then 'instrumental' else 'vocal' end;

  -- 트랙 장르 정규화 (main → sub → genre)
  v_genre := coalesce(
    public.normalize_policy_genre(v_t.main_genre),
    public.normalize_policy_genre(v_t.sub_genre),
    public.normalize_policy_genre(v_t.genre)
  );

  select * into v_enf from public.store_policy_enforcement where normalized_store_type = v_store;

  if v_genre is null then
    return jsonb_build_object('status','unknown_genre','normalized_store_type',v_store,
      'track_vocal_policy',v_vp,'reason','트랙 장르 정규화 불가 — 판정 보류');
  end if;

  -- 매장 허용 목록에 해당 장르가 존재하는가 (보컬 무관)
  v_genre_in_store := exists (
    select 1 from public.store_genre_placement_rules r
    where r.normalized_store_type = v_store and r.is_allowed
      and r.normalized_genre = v_genre);

  -- 보컬 정책까지 정확히 일치하는가
  --   트랙 'vocal' → 규칙 vocal_policy in ('vocal','vocal_rap')
  --   트랙 'instrumental' → 규칙 vocal_policy = 'instrumental'
  v_exact := exists (
    select 1 from public.store_genre_placement_rules r
    where r.normalized_store_type = v_store and r.is_allowed
      and r.normalized_genre = v_genre
      and ((v_vp = 'instrumental' and r.vocal_policy = 'instrumental')
        or (v_vp = 'vocal' and r.vocal_policy in ('vocal','vocal_rap'))));

  if v_exact then
    v_status := 'allowed'; v_issue := null; v_sev := null;
  elsif v_genre_in_store then
    v_status := 'vocal_policy_violation';
    v_issue := 'vocal_policy_mismatch';
    v_sev := coalesce(v_enf.default_severity,'MEDIUM');
  else
    v_status := 'unsupported_store_genre';
    v_issue := 'unsupported_store_genre';
    v_sev := coalesce(v_enf.default_severity,'MEDIUM');
  end if;

  return jsonb_build_object(
    'status', v_status,
    'store_label', p_store_label,
    'normalized_store_type', v_store,
    'track_genre', v_genre,
    'track_vocal_policy', v_vp,
    'enforcement', coalesce(v_enf.enforcement,'soft'),
    'issue_type', v_issue,
    'severity', v_sev,
    'reason', case v_status
      when 'allowed' then format('%s 정책 허용 (%s/%s)', v_store, v_genre, v_vp)
      when 'vocal_policy_violation' then format('%s 에는 %s 의 %s 보컬 정책이 허용되지 않음', p_store_label, v_genre, v_vp)
      when 'unsupported_store_genre' then format('%s 에는 %s 이(가) 허용 장르 목록에 없음', p_store_label, v_genre)
      else null end
  );
end;
$$;
grant execute on function public.check_store_genre_policy(uuid, text) to authenticated, service_role;

-- =====================================================================
-- G. QC 큐 적재 helper (placement source)
-- =====================================================================
create or replace function public._record_store_genre_qc(p_track_id uuid, p_policy jsonb)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_issue text := p_policy->>'issue_type';
  v_sev text := coalesce(p_policy->>'severity','MEDIUM');
  v_n int;
begin
  if v_issue is null then return false; end if;
  insert into public.admin_qc_queue(track_id, issue_type, severity, source, reason, evidence_json)
  select p_track_id, v_issue, v_sev, 'placement',
         coalesce(p_policy->>'reason','매장 장르 정책 위반'), p_policy
  where not exists (
    select 1 from public.admin_qc_queue q
    where q.track_id = p_track_id and q.issue_type = v_issue and q.status = 'open');
  get diagnostics v_n = row_count;
  return v_n > 0;
end;
$$;
revoke all on function public._record_store_genre_qc(uuid, jsonb) from public, anon;
grant execute on function public._record_store_genre_qc(uuid, jsonb) to authenticated, service_role;

-- =====================================================================
-- H. auto_place_track v4 — 매장 장르/보컬 정책 guardrail 반영
--   우선순위: genre_block(기존) → store genre placement rule → gate → artist cap
--   정책 점수: exact +20 / vocal mismatch -30 / unsupported soft -40 / unsupported hard = block
--   위반 시 자동 삭제 없음. 배치는 하되 fit status='review_needed' + QC 후보 등록.
-- =====================================================================
create or replace function public.auto_place_track(p_track_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  t record; a record; r record; pred record;
  v_artist_key text;
  v_threshold numeric := 30; v_max int := 5; v_artist_cap int := 3;
  v_placed int := 0; v_cand int := 0; v_log jsonb := '[]'::jsonb;
  v_skip_block int := 0; v_skip_gate int := 0; v_skip_policy int := 0; v_policy_review int := 0;
  v_policy jsonb; v_pstatus text; v_pdelta numeric; v_final_score numeric;
begin
  select * into t from public.tracks where id = p_track_id;
  if t.id is null then return jsonb_build_object('ok', false, 'reason', 'track_not_found'); end if;
  if coalesce(t.audio_url,'') = '' or not (t.release_status = 'released' or t.release_status is null) then
    insert into public.auto_placement_runs(track_id,status,candidate_count,placed_count,log_json)
      values (p_track_id,'skipped',0,0, jsonb_build_object('reason','not_released_or_no_audio'));
    return jsonb_build_object('ok', true, 'status', 'skipped');
  end if;

  perform public.derive_track_analysis(p_track_id);
  select * into a from public.track_analysis where track_id = p_track_id;
  select * into pred from public.track_ai_predictions
    where track_id = p_track_id and model_version = 'taxonomy-v1';
  v_artist_key := lower(btrim(coalesce(t.artist,'')));
  select count(*) into v_cand from public.playlists where is_auto_generated = true and status = 'released';

  for r in
    select p.id, p.title, p.business_category, p.ai_store_key,
      (
        coalesce(case when (a.genre is not null and exists(select 1 from unnest(p.genre_tags) g where lower(g)=lower(a.genre)))
                       or exists(select 1 from unnest(p.genre_tags) g where lower(g) = any(select lower(x) from unnest(coalesce(t.genre_tags,'{}')) x))
                  then 25 else 0 end,0)
      + coalesce((select count(*) from unnest(p.mood_tags) m where m = any(a.mood_tags) or lower(coalesce(t.mood,'')) = lower(m)) * 15, 0)
      + coalesce(case when p.business_category is not null and (t.suitable_store = p.business_category or p.business_category = any(coalesce(t.business_tags,'{}'))) then 20 else 0 end,0)
      + coalesce(case when p.daypart is not null and (p.daypart = any(coalesce(t.time_slots,'{}')) or 'all' = any(coalesce(t.time_slots,'{}'))) then 10 else 0 end,0)
      + coalesce(case when p.bpm_min is not null and a.bpm is not null then (case when a.bpm between p.bpm_min and coalesce(p.bpm_max,9999) then 10 else -10 end) else 0 end,0)
      + coalesce(case when p.energy_min is not null and a.energy is not null then (case when a.energy between p.energy_min and coalesce(p.energy_max,100) then 10 else -5 end) else 0 end,0)
      + coalesce(case when p.vocal_preference='vocal' then (case when coalesce(t.instrumental,false) then -10 else 10 end)
                      when p.vocal_preference='instrumental' then (case when coalesce(t.instrumental,false) then 10 else -10 end)
                      else 0 end,0)
      + coalesce(a.quality_score - 70, 0)
      + case when t.created_at >= now() - interval '30 days' then 5 else 0 end
      + coalesce(case when pred.predicted_main_genre is not null
                       and exists(select 1 from unnest(p.genre_tags) g
                                  where lower(g) = lower(pred.predicted_main_genre))
                  then 5 else 0 end, 0)
      + coalesce(least(
          (select count(*) from unnest(coalesce(pred.predicted_moods,'{}'::text[])) pm
           join public.taxonomy_moods tm on tm.slug = pm
           where tm.name_ko = any(coalesce(p.mood_tags,'{}'::text[]))) * 3,
          9), 0)
      + coalesce(least(
          (select count(*) from unnest(coalesce(pred.predicted_store_types,'{}'::text[])) ps
           join public.taxonomy_store_types ts on ts.slug = ps
           where ts.name_ko = p.business_category) * 10,
          20), 0)
      )::numeric as score,
      ((a.genre is not null and exists(select 1 from unnest(p.genre_tags) g where lower(g)=lower(a.genre)))
        or exists(select 1 from unnest(p.genre_tags) g where lower(g) = any(select lower(x) from unnest(coalesce(t.genre_tags,'{}')) x))) as genre_match,
      exists(select 1 from unnest(p.mood_tags) m where m = any(a.mood_tags) or lower(coalesce(t.mood,'')) = lower(m)) as mood_match,
      (p.business_category is not null and (t.suitable_store = p.business_category or p.business_category = any(coalesce(t.business_tags,'{}')))) as business_match,
      exists(
        select 1 from public.track_ai_predictions ap
        where ap.track_id = p_track_id and ap.model_version = 'taxonomy-v1' and ap.predicted_store_types is not null
          and ((p.ai_store_key is not null and p.ai_store_key = any(ap.predicted_store_types))
            or exists(select 1 from public.taxonomy_store_types ts where ts.name_ko = p.business_category and ts.slug = any(ap.predicted_store_types)))
      ) as ai_store_match,
      (p.business_category is not null and exists(
        select 1 from public.genre_block_rules gbr
        where gbr.business_category = p.business_category and gbr.block_kind = 'allow'
          and (position(lower(gbr.genre_pattern) in lower(coalesce(t.main_genre,''))) > 0
            or position(lower(gbr.genre_pattern) in lower(coalesce(t.sub_genre,''))) > 0
            or exists(select 1 from unnest(coalesce(t.genre_tags, '{}'::text[])) gt where position(lower(gbr.genre_pattern) in lower(gt)) > 0))
      )) as allow_match,
      (p.business_category is not null and exists(
        select 1 from public.genre_block_rules gbr
        where gbr.business_category = p.business_category and gbr.block_kind = 'block'
          and ((a.genre is not null and position(lower(gbr.genre_pattern) in lower(a.genre)) > 0)
            or lower(coalesce(t.main_genre,'')) like '%' || lower(gbr.genre_pattern) || '%'
            or lower(coalesce(t.sub_genre,'')) like '%' || lower(gbr.genre_pattern) || '%'
            or exists(select 1 from unnest(coalesce(t.genre_tags, '{}'::text[])) gt where lower(gt) like '%' || lower(gbr.genre_pattern) || '%'))
      )) as block_match,
      (select string_agg(distinct gbr.genre_pattern, ',') from public.genre_block_rules gbr
       where gbr.business_category = p.business_category and gbr.block_kind = 'block'
         and ((a.genre is not null and position(lower(gbr.genre_pattern) in lower(a.genre)) > 0)
           or lower(coalesce(t.main_genre,'')) like '%' || lower(gbr.genre_pattern) || '%'
           or lower(coalesce(t.sub_genre,'')) like '%' || lower(gbr.genre_pattern) || '%')) as matched_block_pattern
    from public.playlists p
    where p.is_auto_generated = true and p.status = 'released'
    order by score desc
  loop
    exit when v_placed >= v_max or r.score < v_threshold;

    -- 기존 genre_block guardrail (최우선)
    if r.block_match and not r.allow_match then
      begin
        insert into public.placement_risk_flags (playlist_id, track_id, risk_type, risk_reason,
          business_category, main_genre, matched_pattern, match_score)
        values (r.id, p_track_id, 'genre_block_suspected',
          format('block rule matched: main_genre=%s × business=%s pattern=%s (score %s)',
                 t.main_genre, r.business_category, coalesce(r.matched_block_pattern,'?'), round(r.score,1)),
          r.business_category, t.main_genre, coalesce(r.matched_block_pattern,''), round(r.score,1))
        on conflict (playlist_id, track_id, risk_type) do nothing;
      exception when others then null;
      end;
      v_skip_block := v_skip_block + 1;
      v_log := v_log || jsonb_build_object('playlist', r.title, 'score', round(r.score,1), 'decision', 'skip_blocked');
      continue;
    end if;

    -- 🆕 매장 장르/보컬 정책 (store genre placement rule)
    v_policy := public.check_store_genre_policy(p_track_id, r.business_category);
    v_pstatus := v_policy->>'status';
    if v_pstatus = 'unsupported_store_genre' and (v_policy->>'enforcement') = 'hard' then
      perform public._record_store_genre_qc(p_track_id, v_policy);
      v_skip_policy := v_skip_policy + 1;
      v_log := v_log || jsonb_build_object('playlist', r.title, 'score', round(r.score,1),
        'decision', 'skip_policy_hardblock', 'policy', v_policy);
      continue;
    end if;
    v_pdelta := case v_pstatus
                  when 'allowed' then 20
                  when 'vocal_policy_violation' then -30
                  when 'unsupported_store_genre' then -40
                  else 0 end;

    if not (r.genre_match or r.mood_match or r.business_match or r.ai_store_match or r.allow_match) then
      v_skip_gate := v_skip_gate + 1;
      v_log := v_log || jsonb_build_object('playlist', r.title, 'score', round(r.score,1), 'decision', 'skip_gate_failed');
      continue;
    end if;
    if v_artist_key <> '' and (
      select count(*) from public.playlist_tracks pt join public.tracks tt on tt.id = pt.track_id
      where pt.playlist_id = r.id and lower(btrim(coalesce(tt.artist,''))) = v_artist_key
    ) >= v_artist_cap then
      v_log := v_log || jsonb_build_object('playlist', r.title, 'score', round(r.score,1), 'skip', 'artist_cap');
      continue;
    end if;

    v_final_score := round(r.score + v_pdelta, 1);
    begin
      insert into public.playlist_tracks(playlist_id, track_id, order_index, match_score, placement_reason, placed_by)
      values (r.id, p_track_id,
        coalesce((select max(order_index)+1 from public.playlist_tracks where playlist_id = r.id), 0),
        v_final_score,
        format('자동 배치 X2.1+정책 (score %s · gate: %s · policy: %s)', v_final_score,
          array_to_string(array_remove(array[
            case when r.genre_match then 'genre' end,
            case when r.mood_match then 'mood' end,
            case when r.business_match then 'business' end,
            case when r.ai_store_match then 'ai_store' end,
            case when r.allow_match then 'allow' end
          ], null), '+'), coalesce(v_pstatus,'n/a')),
        'auto');
      v_placed := v_placed + 1;
      v_log := v_log || jsonb_build_object('playlist', r.title, 'score', v_final_score,
        'decision', 'auto_place', 'policy', v_pstatus);

      -- 정책 위반(soft)이면 fit status review_needed + QC (자동 삭제 금지)
      if v_pstatus in ('vocal_policy_violation','unsupported_store_genre') then
        insert into public.playlist_track_fit_scores(playlist_id, track_id, status, source, reason, reason_codes, updated_at)
        values (r.id, p_track_id, 'review_needed', 'algorithm',
          coalesce(v_policy->>'reason','매장 장르 정책 위반'),
          array['admin_policy_store_genre_mismatch'], now())
        on conflict (playlist_id, track_id) do update set
          status = 'review_needed',
          reason = excluded.reason,
          reason_codes = (
            select array(select distinct e from unnest(
              coalesce(public.playlist_track_fit_scores.reason_codes,'{}'::text[])
              || array['admin_policy_store_genre_mismatch']) e)),
          updated_at = now();
        perform public._record_store_genre_qc(p_track_id, v_policy);
        v_policy_review := v_policy_review + 1;
      end if;
    exception when unique_violation then
      v_log := v_log || jsonb_build_object('playlist', r.title, 'score', v_final_score, 'skip', 'already_placed');
    end;
  end loop;

  insert into public.auto_placement_runs(track_id,status,candidate_count,placed_count,log_json)
  values (p_track_id, case when v_placed > 0 then 'placed' else 'review' end, v_cand, v_placed,
          v_log || jsonb_build_object('skip_blocked', v_skip_block, 'skip_gate_failed', v_skip_gate,
            'skip_policy', v_skip_policy, 'policy_review', v_policy_review));
  return jsonb_build_object('ok', true, 'placed', v_placed, 'candidates', v_cand,
    'skip_blocked', v_skip_block, 'skip_gate_failed', v_skip_gate,
    'skip_policy', v_skip_policy, 'policy_review', v_policy_review,
    'status', case when v_placed > 0 then 'placed' else 'review' end);
end; $$;
revoke all on function public.auto_place_track(uuid) from public, anon;
grant execute on function public.auto_place_track(uuid) to authenticated, service_role;

-- =====================================================================
-- I. admin_backfill_store_genre_policy_review — 기존 등록곡 전체 재판정
--   dry_run=true (기본) 이면 카운트만 산출, 실제 변경 없음.
--   위반 시: playlist_track_fit_scores.status='review_needed' (행 없으면 생성)
--            + reason_codes 에 admin_policy_store_genre_mismatch 추가
--            + admin_qc_queue 후보 등록.  자동 삭제 절대 없음.
-- =====================================================================
create or replace function public.admin_backfill_store_genre_policy_review(
  p_dry_run boolean default true,
  p_limit integer default 1000
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := auth.uid();
  rec record;
  v_policy jsonb;
  v_status text;
  v_store text;
  v_issue text;
  v_checked int := 0;
  v_matched int := 0;
  v_mismatch int := 0;
  v_review_created int := 0;
  v_qc_created int := 0;
  v_by_store jsonb := '{}'::jsonb;
  v_by_issue jsonb := '{}'::jsonb;
  v_existing int;
begin
  if not exists (select 1 from public.users u where u.id = v_admin and u.role='admin') then
    raise exception 'unauthorized';
  end if;

  for rec in
    select pt.playlist_id, pt.track_id, pl.business_category
    from public.playlist_tracks pt
    join public.playlists pl on pl.id = pt.playlist_id
    join public.tracks tr on tr.id = pt.track_id
    where tr.removed_at is null
    order by pt.playlist_id
    limit p_limit
  loop
    v_policy := public.check_store_genre_policy(rec.track_id, rec.business_category);
    v_status := v_policy->>'status';
    v_store := coalesce(v_policy->>'normalized_store_type', 'unknown');
    v_checked := v_checked + 1;

    if v_status in ('allowed','no_policy','unknown_genre') then
      v_matched := v_matched + 1;
      continue;
    end if;

    -- 위반 (vocal_policy_violation | unsupported_store_genre)
    v_mismatch := v_mismatch + 1;
    v_issue := coalesce(v_policy->>'issue_type','unsupported_store_genre');
    v_by_store := jsonb_set(v_by_store, array[v_store],
      to_jsonb(coalesce((v_by_store->>v_store)::int, 0) + 1), true);
    v_by_issue := jsonb_set(v_by_issue, array[v_issue],
      to_jsonb(coalesce((v_by_issue->>v_issue)::int, 0) + 1), true);

    if not p_dry_run then
      select count(*) into v_existing from public.playlist_track_fit_scores
        where playlist_id = rec.playlist_id and track_id = rec.track_id;
      insert into public.playlist_track_fit_scores(playlist_id, track_id, status, source, reason, reason_codes, updated_at)
      values (rec.playlist_id, rec.track_id, 'review_needed', 'algorithm',
        coalesce(v_policy->>'reason','매장 장르 정책 위반'),
        array['admin_policy_store_genre_mismatch'], now())
      on conflict (playlist_id, track_id) do update set
        status = 'review_needed',
        reason = excluded.reason,
        reason_codes = (
          select array(select distinct e from unnest(
            coalesce(public.playlist_track_fit_scores.reason_codes,'{}'::text[])
            || array['admin_policy_store_genre_mismatch']) e)),
        updated_at = now();
      v_review_created := v_review_created + 1;

      if public._record_store_genre_qc(rec.track_id, v_policy) then
        v_qc_created := v_qc_created + 1;
      end if;
    end if;
  end loop;

  return jsonb_build_object(
    'dry_run', p_dry_run,
    'checked_count', v_checked,
    'matched_count', v_matched,
    'mismatch_count', v_mismatch,
    'review_needed_created', v_review_created,
    'qc_created', v_qc_created,
    'by_store', v_by_store,
    'by_issue_type', v_by_issue
  );
end;
$$;
revoke all on function public.admin_backfill_store_genre_policy_review(boolean, integer) from public, anon;
grant execute on function public.admin_backfill_store_genre_policy_review(boolean, integer) to authenticated, service_role;

-- =====================================================================
-- J. Admin RPC — 정책 조회/관리 (관리자 전용)
-- =====================================================================
create or replace function public.admin_list_store_genre_policies(
  p_store_type text default null,
  p_vocal_policy text default null
)
returns table (
  id uuid, store_type text, normalized_store_type text,
  genre text, normalized_genre text, vocal_policy text,
  is_allowed boolean, priority int, source text,
  enforcement text, default_severity text,
  created_at timestamptz, updated_at timestamptz
)
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
  select r.id, r.store_type, r.normalized_store_type, r.genre, r.normalized_genre,
         r.vocal_policy, r.is_allowed, r.priority, r.source,
         e.enforcement, e.default_severity, r.created_at, r.updated_at
  from public.store_genre_placement_rules r
  left join public.store_policy_enforcement e on e.normalized_store_type = r.normalized_store_type
  where (p_store_type is null or r.normalized_store_type = p_store_type)
    and (p_vocal_policy is null or r.vocal_policy = p_vocal_policy)
  order by r.normalized_store_type, r.vocal_policy, r.priority, r.genre;
end;
$$;
revoke all on function public.admin_list_store_genre_policies(text, text) from public, anon;
grant execute on function public.admin_list_store_genre_policies(text, text) to authenticated, service_role;

create or replace function public.admin_store_genre_policy_summary()
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_store_count int; v_rule_count int; v_active_count int;
  v_by_store jsonb; v_by_vocal jsonb;
begin
  if not exists (select 1 from public.users u where u.id = auth.uid() and u.role='admin') then
    raise exception 'unauthorized';
  end if;
  select count(distinct normalized_store_type), count(*), count(*) filter (where is_allowed)
    into v_store_count, v_rule_count, v_active_count
  from public.store_genre_placement_rules;

  select coalesce(jsonb_object_agg(s.normalized_store_type, s.cnt), '{}'::jsonb) into v_by_store
  from (select normalized_store_type, count(*) cnt from public.store_genre_placement_rules
        group by normalized_store_type) s;

  select coalesce(jsonb_object_agg(v.vocal_policy, v.cnt), '{}'::jsonb) into v_by_vocal
  from (select vocal_policy, count(*) cnt from public.store_genre_placement_rules
        group by vocal_policy) v;

  return jsonb_build_object(
    'store_count', v_store_count,
    'rule_count', v_rule_count,
    'active_count', v_active_count,
    'by_store', v_by_store,
    'by_vocal_policy', v_by_vocal
  );
end;
$$;
revoke all on function public.admin_store_genre_policy_summary() from public, anon;
grant execute on function public.admin_store_genre_policy_summary() to authenticated, service_role;

create or replace function public.admin_set_store_genre_rule_enabled(p_id uuid, p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.users u where u.id = auth.uid() and u.role='admin') then
    raise exception 'unauthorized';
  end if;
  update public.store_genre_placement_rules
    set is_allowed = p_enabled, updated_at = now()
    where id = p_id;
end;
$$;
revoke all on function public.admin_set_store_genre_rule_enabled(uuid, boolean) from public, anon;
grant execute on function public.admin_set_store_genre_rule_enabled(uuid, boolean) to authenticated, service_role;

create or replace function public.admin_set_store_genre_rule_priority(p_id uuid, p_priority int)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.users u where u.id = auth.uid() and u.role='admin') then
    raise exception 'unauthorized';
  end if;
  update public.store_genre_placement_rules
    set priority = p_priority, updated_at = now()
    where id = p_id;
end;
$$;
revoke all on function public.admin_set_store_genre_rule_priority(uuid, int) from public, anon;
grant execute on function public.admin_set_store_genre_rule_priority(uuid, int) to authenticated, service_role;

create or replace function public.admin_upsert_store_genre_rule(
  p_store_type text,
  p_genre text,
  p_vocal_policy text,
  p_is_allowed boolean default true,
  p_priority int default 100
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store text; v_genre text; v_id uuid;
begin
  if not exists (select 1 from public.users u where u.id = auth.uid() and u.role='admin') then
    raise exception 'unauthorized';
  end if;
  if p_vocal_policy not in ('vocal','instrumental','vocal_rap') then
    raise exception 'invalid vocal_policy: %', p_vocal_policy;
  end if;
  v_store := coalesce(public.normalize_policy_store_type(p_store_type), lower(btrim(p_store_type)));
  v_genre := coalesce(public.normalize_policy_genre(p_genre), lower(btrim(p_genre)));
  insert into public.store_genre_placement_rules
    (store_type, normalized_store_type, genre, normalized_genre, vocal_policy, is_allowed, priority, source)
  values (p_store_type, v_store, p_genre, v_genre, p_vocal_policy, p_is_allowed, p_priority, 'admin_policy_v1')
  on conflict (normalized_store_type, normalized_genre, vocal_policy, source) do update set
    store_type = excluded.store_type,
    genre = excluded.genre,
    is_allowed = excluded.is_allowed,
    priority = excluded.priority,
    updated_at = now()
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.admin_upsert_store_genre_rule(text, text, text, boolean, int) from public, anon;
grant execute on function public.admin_upsert_store_genre_rule(text, text, text, boolean, int) to authenticated, service_role;

-- 정책 위반 곡 목록 (admin_qc_queue 의 정책 issue_type 만)
create or replace function public.admin_list_store_genre_violations(
  p_store_type text default null,
  p_issue_type text default null,
  p_status text default 'open',
  p_limit int default 300
)
returns table (
  id uuid, track_id uuid, title text, artist text, main_genre text,
  issue_type text, severity text, reason text,
  evidence_json jsonb, status text, created_at timestamptz,
  normalized_store_type text
)
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
  select q.id, q.track_id, t.title, t.artist, t.main_genre,
         q.issue_type, q.severity, q.reason, q.evidence_json, q.status, q.created_at,
         (q.evidence_json->>'normalized_store_type') as normalized_store_type
  from public.admin_qc_queue q
  join public.tracks t on t.id = q.track_id
  where q.issue_type in ('vocal_policy_mismatch','unsupported_store_genre','store_genre_policy_mismatch')
    and (p_status = 'all' or q.status = p_status)
    and (p_issue_type is null or q.issue_type = p_issue_type)
    and (p_store_type is null or (q.evidence_json->>'normalized_store_type') = p_store_type)
  order by q.created_at desc
  limit p_limit;
end;
$$;
revoke all on function public.admin_list_store_genre_violations(text, text, text, int) from public, anon;
grant execute on function public.admin_list_store_genre_violations(text, text, text, int) to authenticated, service_role;

-- =====================================================================
-- K. admin_qc_rules 등록 (정책 issue_type 3종 — 룰 관리 화면 노출용)
-- =====================================================================
insert into public.admin_qc_rules(rule_key, name, description, issue_type, severity, source, condition_json, is_active)
values
  ('store_genre_policy_mismatch','매장 장르 정책 불일치','매장 허용 장르 목록에 없는 곡이 배치됨',
   'store_genre_policy_mismatch','HIGH','placement',
   jsonb_build_object('policy','store_genre_placement_rules'), true),
  ('vocal_policy_mismatch','보컬 정책 위반','장르는 허용되나 보컬/연주 정책이 매장과 불일치',
   'vocal_policy_mismatch','MEDIUM','placement',
   jsonb_build_object('policy','store_genre_placement_rules'), true),
  ('unsupported_store_genre','미허용 매장 장르','매장 허용 장르 목록에 없는 장르',
   'unsupported_store_genre','HIGH','placement',
   jsonb_build_object('policy','store_genre_placement_rules'), true)
on conflict (rule_key) do update set
  name = excluded.name, description = excluded.description,
  issue_type = excluded.issue_type, source = excluded.source,
  condition_json = excluded.condition_json, updated_at = now();
