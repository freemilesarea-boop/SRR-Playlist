-- ============================================
-- 0058_artist_tracks_metadata.sql
--
-- Phase 3: 아티스트 음원 등록/관리 보강 — 정산(Phase 4) 안전망 준비.
--
--   - tracks 신규 컬럼 9개 (track_code/isrc/release_title/rights_*/admin_note/reviewed_*)
--   - track_code 자동 생성 (KST YYYYMM + 6자리 시퀀스, BEFORE INSERT 트리거)
--   - tracks_artist_insert RLS 에 권리 확인 게이트 추가 (rights_confirmed_at NOT NULL)
--   - 검수 RPC 4개 갱신: approve / reject / hide / list_pending_review_tracks
--     · reviewed_at / reviewed_by 자동 기록
--     · admin_note 파라미터 추가
--   - 신규 admin_artist_tracks_list RPC (전체 status 필터 + 검색)
--   - 정산 대상 view: eligible_settlement_tracks (Phase 4 가 SELECT)
--
-- 정책:
--   - 운영 데이터: artist_upload 트랙 0건 → backfill 불필요
--   - track_code 트리거는 source_type='artist_upload' 트랙만 자동 부여
--     (admin 업로드/legacy 트랙은 NULL 유지)
--   - 정산 대상 = visibility_status='approved' + 계약 signed + payout verified
-- ============================================

-- ----------------------
-- 1) 컬럼 추가
-- ----------------------
alter table public.tracks
  add column if not exists track_code text,
  add column if not exists isrc text,
  add column if not exists release_title text,
  add column if not exists rights_holder_name text,
  add column if not exists rights_confirmed_at timestamptz,
  add column if not exists rights_confirmed_by uuid references public.users(id) on delete set null,
  add column if not exists admin_note text,
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by uuid references public.users(id) on delete set null;

-- track_code 는 부여된 트랙만 unique (NULL 다수 허용)
create unique index if not exists idx_tracks_track_code_unique
  on public.tracks(track_code) where track_code is not null;
create index if not exists idx_tracks_isrc on public.tracks(isrc) where isrc is not null;
create index if not exists idx_tracks_reviewed_at on public.tracks(reviewed_at desc)
  where reviewed_at is not null;

-- ----------------------
-- 2) track_code 자동 생성 — 월 단위 시퀀스 + advisory lock
-- ----------------------
--   형식: SRR-TRK-YYYYMM-NNNNNN  (KST 기준)
--   동시성 안전: advisory transaction lock + (월, 최대 카운터) 계산
--
-- 단순화: 트랙 카운터를 별도 테이블 없이 동일 월의 max(track_code) 에서 추출.
-- 0058 적용 시점에 artist_upload 트랙 0건 → 첫 트랙은 000001 부터 시작.

create or replace function public._next_artist_track_code()
returns text
language plpgsql
as $$
declare
  v_ym text := to_char((now() at time zone 'Asia/Seoul'), 'YYYYMM');
  v_prefix text := 'SRR-TRK-' || v_ym || '-';
  v_max text;
  v_n int;
begin
  -- 동일 트랜잭션 내 동시 INSERT 충돌 방지 (월 단위 키)
  perform pg_advisory_xact_lock(hashtext('artist_track_code:' || v_ym));

  select max(t.track_code) into v_max
  from public.tracks t
  where t.track_code like v_prefix || '%';

  if v_max is null then
    v_n := 1;
  else
    v_n := coalesce(nullif(substring(v_max from length(v_prefix) + 1), '')::int, 0) + 1;
  end if;

  return v_prefix || lpad(v_n::text, 6, '0');
end;
$$;

create or replace function public._tracks_set_track_code()
returns trigger
language plpgsql
as $$
begin
  -- artist_upload 트랙 + track_code 미지정 시 자동 부여
  if NEW.source_type = 'artist_upload' and NEW.track_code is null then
    NEW.track_code := public._next_artist_track_code();
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_tracks_set_track_code on public.tracks;
create trigger trg_tracks_set_track_code
  before insert on public.tracks
  for each row execute function public._tracks_set_track_code();

-- ----------------------
-- 3) tracks_artist_insert RLS 갱신 — 권리 확인 게이트 추가
--    (0057 의 게이트 + rights_confirmed_at NOT NULL)
-- ----------------------
drop policy if exists "tracks_artist_insert" on public.tracks;
create policy "tracks_artist_insert" on public.tracks
  for insert with check (
    owner_user_id = auth.uid()
    and source_type = 'artist_upload'
    and visibility_status = 'pending_review'
    and rights_confirmed_at is not null            -- 0058 추가: 권리 확인 게이트
    and exists (
      select 1 from public.users u
      where u.id = auth.uid()
        and u.account_type = 'artist'
        and u.artist_approval_status = 'approved'
        and u.membership_tier = 'individual'
        and u.contract_status = 'signed'           -- 0057
    )
    and exists (
      select 1 from public.artist_payout_accounts pa
      where pa.user_id = auth.uid()
        and pa.verification_status = 'verified'
    )
  );

-- ----------------------
-- 4) approve_artist_track — admin_note + reviewed_* 기록
-- ----------------------
drop function if exists public.approve_artist_track(uuid);
drop function if exists public.approve_artist_track(uuid, text);

create or replace function public.approve_artist_track(
  p_track_id uuid,
  p_admin_note text default null
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_track record;
begin
  if not exists (select 1 from public.users u where u.id = v_uid and u.role='admin') then
    raise exception 'admin only';
  end if;

  select t.id, t.visibility_status, t.source_type
    into v_track from public.tracks t where t.id = p_track_id;
  if v_track.id is null then raise exception 'track not found'; end if;
  if v_track.source_type <> 'artist_upload' then
    raise exception 'not an artist upload track';
  end if;

  update public.tracks set
    visibility_status = 'approved',
    reviewed_at = now(),
    reviewed_by = v_uid,
    admin_note = case when p_admin_note is null or btrim(p_admin_note) = ''
                      then admin_note
                      else btrim(p_admin_note) end,
    rejected_reason = null
  where id = p_track_id;

  return jsonb_build_object('ok', true, 'track_id', p_track_id, 'status', 'approved');
end;
$$;

grant execute on function public.approve_artist_track(uuid, text) to authenticated;

-- ----------------------
-- 5) reject_artist_track — reason (=rejected_reason 호환) + admin_note
-- ----------------------
drop function if exists public.reject_artist_track(uuid, text);
drop function if exists public.reject_artist_track(uuid, text, text);

create or replace function public.reject_artist_track(
  p_track_id uuid,
  p_reason text default null,
  p_admin_note text default null
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_track record;
begin
  if not exists (select 1 from public.users u where u.id = v_uid and u.role='admin') then
    raise exception 'admin only';
  end if;

  select t.id, t.source_type into v_track from public.tracks t where t.id = p_track_id;
  if v_track.id is null then raise exception 'track not found'; end if;
  if v_track.source_type <> 'artist_upload' then
    raise exception 'not an artist upload track';
  end if;

  update public.tracks set
    visibility_status = 'rejected',
    rejected_reason = nullif(btrim(coalesce(p_reason, '')), ''),
    admin_note = case when p_admin_note is null or btrim(p_admin_note) = ''
                      then admin_note
                      else btrim(p_admin_note) end,
    reviewed_at = now(),
    reviewed_by = v_uid
  where id = p_track_id;

  return jsonb_build_object('ok', true, 'track_id', p_track_id, 'status', 'rejected');
end;
$$;

grant execute on function public.reject_artist_track(uuid, text, text) to authenticated;

-- ----------------------
-- 6) hide_artist_track — admin_note 추가
-- ----------------------
drop function if exists public.hide_artist_track(uuid);
drop function if exists public.hide_artist_track(uuid, text);

create or replace function public.hide_artist_track(
  p_track_id uuid,
  p_admin_note text default null
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_track record;
begin
  if not exists (select 1 from public.users u where u.id = v_uid and u.role='admin') then
    raise exception 'admin only';
  end if;

  select t.id, t.source_type into v_track from public.tracks t where t.id = p_track_id;
  if v_track.id is null then raise exception 'track not found'; end if;
  if v_track.source_type <> 'artist_upload' then
    raise exception 'not an artist upload track';
  end if;

  update public.tracks set
    visibility_status = 'hidden',
    admin_note = case when p_admin_note is null or btrim(p_admin_note) = ''
                      then admin_note
                      else btrim(p_admin_note) end,
    reviewed_at = now(),
    reviewed_by = v_uid
  where id = p_track_id;

  return jsonb_build_object('ok', true, 'track_id', p_track_id, 'status', 'hidden');
end;
$$;

grant execute on function public.hide_artist_track(uuid, text) to authenticated;

-- ----------------------
-- 7) list_pending_review_tracks 갱신 — track_code + 권리 정보 + admin_note
-- ----------------------
drop function if exists public.list_pending_review_tracks(int);

create or replace function public.list_pending_review_tracks(p_limit int default 50)
returns table(
  track_id uuid,
  track_code text,
  title text,
  artist text,
  artist_name text,
  album_name text,
  release_title text,
  isrc text,
  rights_holder_name text,
  rights_confirmed_at timestamptz,
  main_genre text,
  sub_genre text,
  mood text,
  suitable_store text,
  lyrics text,
  audio_url text,
  cover_url text,
  payout_verification_status text,
  payout_bank_name text,
  admin_note text,
  created_at timestamptz
)
language plpgsql security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.users u where u.id = auth.uid() and u.role='admin') then
    raise exception 'admin only';
  end if;

  return query
  select
    t.id, t.track_code, t.title, t.artist,
    ap.artist_name,
    t.album_name, t.release_title,
    t.isrc, t.rights_holder_name, t.rights_confirmed_at,
    t.main_genre, t.sub_genre, t.mood, t.suitable_store, t.lyrics,
    t.audio_url, t.cover_url,
    pa.verification_status, pa.bank_name,
    t.admin_note,
    t.created_at
  from public.tracks t
  left join public.artist_profiles ap on ap.user_id = t.owner_user_id
  left join public.artist_payout_accounts pa on pa.id = t.payout_account_id
  where t.source_type = 'artist_upload'
    and t.visibility_status = 'pending_review'
  order by t.created_at desc
  limit greatest(1, p_limit);
end;
$$;

grant execute on function public.list_pending_review_tracks(int) to authenticated;

-- ----------------------
-- 8) admin_artist_tracks_list — 전체 음원 목록 (status 필터 + 검색)
-- ----------------------
create or replace function public.admin_artist_tracks_list(
  p_status text default null,          -- 'pending_review' | 'approved' | 'rejected' | 'hidden' | null=ALL
  p_search text default null,           -- track_code / title / artist / isrc / 아티스트명/이메일
  p_limit int default 100,
  p_offset int default 0
)
returns table(
  track_id uuid,
  track_code text,
  title text,
  artist text,
  artist_name text,
  artist_email text,
  album_name text,
  release_title text,
  isrc text,
  rights_holder_name text,
  rights_confirmed_at timestamptz,
  visibility_status text,
  rejected_reason text,
  admin_note text,
  payout_verification_status text,
  contract_status text,
  audio_url text,
  cover_url text,
  reviewed_at timestamptz,
  reviewed_by uuid,
  created_at timestamptz
)
language plpgsql security definer set search_path = public
as $$
declare
  v_pattern text := case
    when p_search is null or length(btrim(p_search)) = 0 then null
    else '%' || btrim(p_search) || '%' end;
begin
  if not exists (select 1 from public.users u where u.id = auth.uid() and u.role='admin') then
    raise exception 'admin only';
  end if;

  return query
  select
    t.id, t.track_code, t.title, t.artist, ap.artist_name,
    au.email::text,
    t.album_name, t.release_title, t.isrc, t.rights_holder_name, t.rights_confirmed_at,
    t.visibility_status, t.rejected_reason, t.admin_note,
    pa.verification_status, u.contract_status,
    t.audio_url, t.cover_url,
    t.reviewed_at, t.reviewed_by,
    t.created_at
  from public.tracks t
  left join public.users u on u.id = t.owner_user_id
  left join auth.users au on au.id = t.owner_user_id
  left join public.artist_profiles ap on ap.user_id = t.owner_user_id
  left join public.artist_payout_accounts pa on pa.id = t.payout_account_id
  where t.source_type = 'artist_upload'
    and (p_status is null or t.visibility_status = p_status)
    and (
      v_pattern is null
      or coalesce(t.track_code, '') ilike v_pattern
      or coalesce(t.title, '') ilike v_pattern
      or coalesce(t.artist, '') ilike v_pattern
      or coalesce(ap.artist_name, '') ilike v_pattern
      or coalesce(t.isrc, '') ilike v_pattern
      or coalesce(au.email::text, '') ilike v_pattern
      or coalesce(t.rights_holder_name, '') ilike v_pattern
    )
  order by t.created_at desc
  limit greatest(1, p_limit) offset greatest(0, p_offset);
end;
$$;

grant execute on function public.admin_artist_tracks_list(text, text, int, int) to authenticated;

-- ----------------------
-- 9) eligible_settlement_tracks view — Phase 4 정산 대상 단일 진실의 원천
--    (Phase 3 에서는 정의만, Phase 4 RPC 가 SELECT)
-- ----------------------
create or replace view public.eligible_settlement_tracks as
select
  t.id as track_id,
  t.track_code,
  t.title,
  t.owner_user_id as artist_user_id,
  t.payout_account_id,
  t.isrc,
  t.rights_holder_name,
  t.album_name,
  t.release_title,
  ap.artist_name,
  u.contract_status,
  pa.verification_status as payout_verification_status
from public.tracks t
join public.users u on u.id = t.owner_user_id
left join public.artist_profiles ap on ap.user_id = t.owner_user_id
left join public.artist_payout_accounts pa on pa.id = t.payout_account_id
where t.source_type = 'artist_upload'
  and t.uploaded_by_account_type = 'artist'
  and t.visibility_status = 'approved'
  and t.owner_user_id is not null
  and u.contract_status = 'signed'
  and t.payout_account_id is not null
  and pa.verification_status = 'verified';

comment on view public.eligible_settlement_tracks is
  'Phase 4 정산 대상 트랙. approved + signed contract + verified payout account. 신뢰성 단일 진실의 원천.';
