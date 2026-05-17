-- ============================================
-- 0063_release_lifecycle.sql
--
-- Phase 3-B: 아티스트 직접 발매 등록 + 검수 → 승인 → scheduled → released 흐름
--
-- 핵심:
--   - tracks 신규 컬럼 14개 (release_status/release_date/release_type/검수 상태 3종/리뷰 추적)
--   - tracks_artist_insert RLS: release_status='submitted' + release_date >= today+3 추가
--   - tracks_artist_update_pending RLS: draft/changes_requested 만 UPDATE 허용
--   - tracks_public_select_approved RLS: release_status='released' 추가
--   - eligible_settlement_tracks view: release_status='released' 추가
--   - 신규 RPC 5개: submit_artist_release / admin_start_track_review /
--     admin_request_track_changes / admin_approve_artist_release / admin_release_now /
--     admin_reject_artist_release
--   - immutability 트리거: released 이후 release_date / release_status / release_type 변경 차단
--
-- 영향: artist_upload 트랙 0건 → backfill 불필요. 일반 admin 트랙은 새 컬럼 NULL 유지 → 영향 0.
-- ============================================

-- ----------------------
-- 1) tracks 신규 컬럼
-- ----------------------
alter table public.tracks
  add column if not exists release_date date,
  add column if not exists release_status text default 'draft'
    check (release_status in ('draft','submitted','changes_requested','approved','scheduled','released','rejected')),
  add column if not exists release_type text
    check (release_type in ('single','ep','album') or release_type is null),
  add column if not exists explicit_content boolean default false,
  add column if not exists instrumental boolean default false,
  add column if not exists audio_review_status text default 'pending'
    check (audio_review_status in ('pending','approved','rejected')),
  add column if not exists cover_review_status text default 'pending'
    check (cover_review_status in ('pending','approved','rejected')),
  add column if not exists metadata_review_status text default 'pending'
    check (metadata_review_status in ('pending','approved','rejected')),
  add column if not exists admin_review_note text,
  add column if not exists artist_revision_note text,
  add column if not exists submitted_at timestamptz,
  add column if not exists review_started_at timestamptz,
  add column if not exists approved_at timestamptz,
  add column if not exists scheduled_at timestamptz,
  add column if not exists released_at timestamptz;

create index if not exists idx_tracks_release_status
  on public.tracks(release_status, release_date)
  where source_type = 'artist_upload';
create index if not exists idx_tracks_release_date
  on public.tracks(release_date)
  where source_type = 'artist_upload' and release_status in ('approved','scheduled');

-- ----------------------
-- 2) Immutability 트리거 — released 이후 release_* 변경 차단
-- ----------------------
create or replace function public._tracks_release_protect()
returns trigger language plpgsql as $$
begin
  -- released 이후엔 release_date / release_type / 발매 자체 컬럼 변경 차단
  if OLD.release_status = 'released' then
    if NEW.release_status <> 'released'
       or NEW.release_date is distinct from OLD.release_date
       or NEW.release_type is distinct from OLD.release_type
       or NEW.released_at is distinct from OLD.released_at then
      raise exception 'released track is immutable on release_* fields (id=%)', OLD.id
        using errcode = '42501';
    end if;
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_tracks_release_protect on public.tracks;
create trigger trg_tracks_release_protect
  before update on public.tracks
  for each row execute function public._tracks_release_protect();

-- release_status ↔ visibility_status 자동 동기화
create or replace function public._tracks_release_visibility_sync()
returns trigger language plpgsql as $$
begin
  -- INSERT 또는 release_status 변경 시 visibility_status 매핑
  if TG_OP = 'INSERT' or NEW.release_status is distinct from OLD.release_status then
    if NEW.release_status in ('draft','submitted','changes_requested') then
      NEW.visibility_status := 'pending_review';
    elsif NEW.release_status in ('approved','scheduled') then
      NEW.visibility_status := 'approved';   -- 내부 메타데이터만 승인됨 (RLS 가 released 까지 차단)
    elsif NEW.release_status = 'released' then
      NEW.visibility_status := 'approved';
    elsif NEW.release_status = 'rejected' then
      NEW.visibility_status := 'rejected';
    end if;
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_tracks_release_visibility_sync on public.tracks;
create trigger trg_tracks_release_visibility_sync
  before insert or update on public.tracks
  for each row
  when (NEW.source_type = 'artist_upload')
  execute function public._tracks_release_visibility_sync();

-- ----------------------
-- 3) tracks_artist_insert RLS 갱신 — submitted + release_date 게이트
-- ----------------------
drop policy if exists "tracks_artist_insert" on public.tracks;
create policy "tracks_artist_insert" on public.tracks
  for insert with check (
    owner_user_id = auth.uid()
    and source_type = 'artist_upload'
    and visibility_status = 'pending_review'      -- 트리거가 자동 매핑하지만 RLS 도 검증
    and release_status = 'submitted'              -- 0063 추가
    and release_date is not null                  -- 0063 추가
    and release_date >= (current_date + interval '3 days')::date  -- 0063 추가
    and rights_confirmed_at is not null
    and exists (
      select 1 from public.users u
      where u.id = auth.uid()
        and u.account_type = 'artist'
        and u.artist_approval_status = 'approved'
        and u.membership_tier = 'individual'
        and u.contract_status = 'signed'
    )
    and exists (
      select 1 from public.artist_payout_accounts pa
      where pa.user_id = auth.uid()
        and pa.verification_status = 'verified'
    )
  );

-- ----------------------
-- 4) tracks_artist_update_pending RLS 갱신 — draft/changes_requested 만
-- ----------------------
drop policy if exists "tracks_artist_update_pending" on public.tracks;
create policy "tracks_artist_update_pending" on public.tracks
  for update using (
    owner_user_id = auth.uid()
    and source_type = 'artist_upload'
    and release_status in ('draft','changes_requested')
  ) with check (
    owner_user_id = auth.uid()
    and source_type = 'artist_upload'
    -- 아티스트가 직접 변경 가능한 status 는 submitted 으로 재제출만
    and release_status in ('draft','submitted','changes_requested')
    -- admin 전용 컬럼은 변경 차단 (트리거가 한 번 더 보호)
  );

-- 아티스트가 admin 전용 컬럼 변경 차단 트리거
create or replace function public._tracks_artist_update_guard()
returns trigger language plpgsql as $$
declare
  v_is_admin boolean;
begin
  -- 본인이 admin 이면 통과
  select exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin')
    into v_is_admin;
  if v_is_admin then return NEW; end if;

  -- 아티스트는 admin 컬럼 변경 금지
  if NEW.admin_review_note is distinct from OLD.admin_review_note
     or NEW.audio_review_status is distinct from OLD.audio_review_status
     or NEW.cover_review_status is distinct from OLD.cover_review_status
     or NEW.metadata_review_status is distinct from OLD.metadata_review_status
     or NEW.reviewed_at is distinct from OLD.reviewed_at
     or NEW.reviewed_by is distinct from OLD.reviewed_by
     or NEW.review_started_at is distinct from OLD.review_started_at
     or NEW.approved_at is distinct from OLD.approved_at
     or NEW.scheduled_at is distinct from OLD.scheduled_at
     or NEW.released_at is distinct from OLD.released_at then
    raise exception 'artist cannot modify admin review fields (id=%)', OLD.id using errcode = '42501';
  end if;

  -- 아티스트는 release_status 를 draft/submitted (재제출) 외엔 변경 못 함
  if NEW.release_status not in ('draft','submitted','changes_requested') then
    raise exception 'artist cannot set release_status=% directly', NEW.release_status using errcode = '42501';
  end if;
  if OLD.release_status in ('approved','scheduled','released','rejected') then
    raise exception 'artist cannot modify track in release_status=%', OLD.release_status using errcode = '42501';
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_tracks_artist_update_guard on public.tracks;
create trigger trg_tracks_artist_update_guard
  before update on public.tracks
  for each row
  when (OLD.source_type = 'artist_upload')
  execute function public._tracks_artist_update_guard();

-- ----------------------
-- 5) tracks_public_select_approved 갱신 — release_status='released' 만 공개
-- ----------------------
drop policy if exists "tracks_public_select_approved" on public.tracks;
create policy "tracks_public_select_approved" on public.tracks
  for select using (
    -- artist_upload 트랙: released 만 공개. 그 외 source_type 은 visibility 기준
    (source_type = 'artist_upload' and release_status = 'released')
    or (source_type <> 'artist_upload' and coalesce(visibility, 'public') = 'public')
    or (source_type is null)  -- legacy 트랙 호환
  );

-- 본인 SELECT + admin SELECT 정책은 기존 그대로 유지 (tracks_select_owner, tracks_admin_write)

-- ----------------------
-- 6) eligible_settlement_tracks view 갱신 — released 만 정산 대상
-- ----------------------
create or replace view public.eligible_settlement_tracks as
select
  t.id as track_id, t.track_code, t.title,
  t.owner_user_id as artist_user_id,
  t.payout_account_id, t.isrc, t.rights_holder_name,
  t.album_name, t.release_title,
  ap.artist_name, u.contract_status,
  pa.verification_status as payout_verification_status
from public.tracks t
join public.users u on u.id = t.owner_user_id
left join public.artist_profiles ap on ap.user_id = t.owner_user_id
left join public.artist_payout_accounts pa on pa.id = t.payout_account_id
where t.source_type = 'artist_upload'
  and t.uploaded_by_account_type = 'artist'
  and t.visibility_status = 'approved'
  and t.release_status = 'released'              -- 0063 추가
  and t.owner_user_id is not null
  and u.contract_status = 'signed'
  and t.payout_account_id is not null
  and pa.verification_status = 'verified';

comment on view public.eligible_settlement_tracks is
  'Phase 4 정산 대상 트랙. released + signed contract + verified payout account.';

-- ----------------------
-- 7) submit_artist_release RPC — wizard 제출
-- ----------------------
create or replace function public.submit_artist_release(
  p_track_id uuid default null,  -- 재제출 시 기존 ID
  p_title text default null,
  p_artist text default null,
  p_album_name text default null,
  p_release_title text default null,
  p_release_type text default null,
  p_release_date date default null,
  p_main_genre text default null,
  p_sub_genre text default null,
  p_mood text default null,
  p_suitable_store text default null,
  p_lyrics text default null,
  p_isrc text default null,
  p_rights_holder_name text default null,
  p_explicit_content boolean default false,
  p_instrumental boolean default false,
  p_audio_url text default null,
  p_cover_url text default null,
  p_rights_confirmed boolean default false
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_track_id uuid;
  v_profile_id uuid;
  v_payout_id uuid;
  v_artist_name text;
  v_real_name text;
  v_min_date date := (current_date + interval '3 days')::date;
begin
  if v_uid is null then raise exception 'unauthorized'; end if;
  if not p_rights_confirmed then raise exception 'rights confirmation required'; end if;

  -- 발매일 검증
  if p_release_date is null then raise exception 'release_date required'; end if;
  if p_release_date < v_min_date then
    raise exception 'release_date must be at least % (today + 3 days)', v_min_date
      using hint = '검수 및 출시 준비를 위해 발매일은 최소 3일 뒤부터 선택할 수 있습니다.';
  end if;

  -- release_type 검증
  if p_release_type not in ('single','ep','album') then
    raise exception 'release_type must be single/ep/album';
  end if;

  -- 게이트 검증 (RLS 도 보호하지만 RPC 가 명확한 에러 제공)
  if not exists (
    select 1 from public.users u
    where u.id = v_uid
      and u.account_type = 'artist'
      and u.artist_approval_status = 'approved'
      and u.membership_tier = 'individual'
      and u.contract_status = 'signed'
  ) then
    raise exception 'artist not eligible (approval/payment/contract)';
  end if;

  select id into v_payout_id from public.artist_payout_accounts
  where user_id = v_uid and verification_status = 'verified';
  if v_payout_id is null then raise exception 'verified payout account required'; end if;

  select id, artist_name, real_name into v_profile_id, v_artist_name, v_real_name
  from public.artist_profiles where user_id = v_uid;
  if v_profile_id is null then raise exception 'artist profile not found'; end if;

  if p_track_id is not null then
    -- 재제출 (draft/changes_requested 만)
    if not exists (
      select 1 from public.tracks
      where id = p_track_id and owner_user_id = v_uid
        and release_status in ('draft','changes_requested')
    ) then
      raise exception 'cannot resubmit track in current status';
    end if;

    update public.tracks set
      title = coalesce(nullif(btrim(p_title), ''), title),
      artist = coalesce(nullif(btrim(p_artist), ''), artist, v_artist_name),
      album_name = coalesce(nullif(btrim(p_album_name), ''), album_name),
      release_title = coalesce(nullif(btrim(p_release_title), ''), release_title),
      release_type = coalesce(p_release_type, release_type),
      release_date = coalesce(p_release_date, release_date),
      main_genre = coalesce(nullif(btrim(p_main_genre), ''), main_genre),
      sub_genre = coalesce(nullif(btrim(p_sub_genre), ''), sub_genre),
      mood = coalesce(nullif(btrim(p_mood), ''), mood),
      suitable_store = coalesce(nullif(btrim(p_suitable_store), ''), suitable_store),
      lyrics = coalesce(nullif(btrim(p_lyrics), ''), lyrics),
      isrc = coalesce(nullif(btrim(p_isrc), ''), isrc),
      rights_holder_name = coalesce(nullif(btrim(p_rights_holder_name), ''),
                                     rights_holder_name, v_real_name, v_artist_name),
      explicit_content = coalesce(p_explicit_content, explicit_content),
      instrumental = coalesce(p_instrumental, instrumental),
      audio_url = coalesce(p_audio_url, audio_url),
      cover_url = coalesce(p_cover_url, cover_url),
      rights_confirmed_at = now(),
      rights_confirmed_by = v_uid,
      release_status = 'submitted',
      submitted_at = now(),
      -- 검수 status 리셋 (재검수)
      audio_review_status = 'pending',
      cover_review_status = 'pending',
      metadata_review_status = 'pending',
      review_started_at = null,
      admin_review_note = null
    where id = p_track_id;

    v_track_id := p_track_id;
  else
    -- 신규 INSERT
    if p_audio_url is null then raise exception 'audio_url required for new release'; end if;
    if p_title is null or length(btrim(p_title)) = 0 then raise exception 'title required'; end if;
    if p_album_name is null or length(btrim(p_album_name)) = 0 then raise exception 'album_name required'; end if;

    insert into public.tracks (
      title, artist, album_name, release_title, release_type, release_date,
      main_genre, sub_genre, mood, suitable_store, lyrics,
      isrc, rights_holder_name, rights_confirmed_at, rights_confirmed_by,
      explicit_content, instrumental,
      audio_url, cover_url,
      owner_user_id, artist_profile_id, payout_account_id,
      uploaded_by_account_type, source_type,
      release_status, submitted_at,
      audio_review_status, cover_review_status, metadata_review_status
    ) values (
      btrim(p_title),
      coalesce(nullif(btrim(p_artist), ''), v_artist_name),
      btrim(p_album_name),
      nullif(btrim(p_release_title), ''),
      p_release_type,
      p_release_date,
      nullif(btrim(p_main_genre), ''),
      nullif(btrim(p_sub_genre), ''),
      nullif(btrim(p_mood), ''),
      nullif(btrim(p_suitable_store), ''),
      nullif(btrim(p_lyrics), ''),
      nullif(btrim(p_isrc), ''),
      coalesce(nullif(btrim(p_rights_holder_name), ''), v_real_name, v_artist_name),
      now(), v_uid,
      coalesce(p_explicit_content, false), coalesce(p_instrumental, false),
      p_audio_url, p_cover_url,
      v_uid, v_profile_id, v_payout_id,
      'artist', 'artist_upload',
      'submitted', now(),
      'pending', 'pending', 'pending'
    ) returning id into v_track_id;
  end if;

  return v_track_id;
end;
$$;

grant execute on function public.submit_artist_release(
  uuid, text, text, text, text, text, date, text, text, text, text, text, text, text,
  boolean, boolean, text, text, boolean
) to authenticated;

-- ----------------------
-- 8) admin_start_track_review — 검수 시작 마킹
-- ----------------------
create or replace function public.admin_start_track_review(p_track_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if not exists (select 1 from public.users u where u.id = v_uid and u.role = 'admin') then
    raise exception 'admin only';
  end if;
  update public.tracks set
    review_started_at = coalesce(review_started_at, now()),
    reviewed_by = coalesce(reviewed_by, v_uid)
  where id = p_track_id and source_type = 'artist_upload';
  return jsonb_build_object('ok', true, 'track_id', p_track_id);
end;
$$;
grant execute on function public.admin_start_track_review(uuid) to authenticated;

-- ----------------------
-- 9) admin_request_track_changes — 수정 요청 (target: audio/cover/metadata)
-- ----------------------
create or replace function public.admin_request_track_changes(
  p_track_id uuid,
  p_note text,
  p_target text default 'all'   -- 'audio'|'cover'|'metadata'|'all'
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_track record;
begin
  if not exists (select 1 from public.users u where u.id = v_uid and u.role = 'admin') then
    raise exception 'admin only';
  end if;
  if p_note is null or length(btrim(p_note)) = 0 then
    raise exception 'admin_review_note required';
  end if;
  if p_target not in ('audio','cover','metadata','all') then
    raise exception 'p_target must be audio/cover/metadata/all';
  end if;

  select id, release_status, source_type into v_track from public.tracks where id = p_track_id;
  if v_track.id is null then raise exception 'track not found'; end if;
  if v_track.source_type <> 'artist_upload' then raise exception 'not an artist upload'; end if;
  if v_track.release_status not in ('submitted','approved','scheduled') then
    raise exception 'cannot request changes in release_status=%', v_track.release_status;
  end if;

  update public.tracks set
    release_status = 'changes_requested',
    admin_review_note = btrim(p_note),
    audio_review_status = case when p_target in ('audio','all') then 'rejected' else audio_review_status end,
    cover_review_status = case when p_target in ('cover','all') then 'rejected' else cover_review_status end,
    metadata_review_status = case when p_target in ('metadata','all') then 'rejected' else metadata_review_status end,
    reviewed_at = now(),
    reviewed_by = v_uid
  where id = p_track_id;

  return jsonb_build_object('ok', true, 'track_id', p_track_id, 'status', 'changes_requested', 'target', p_target);
end;
$$;
grant execute on function public.admin_request_track_changes(uuid, text, text) to authenticated;

-- ----------------------
-- 10) admin_approve_artist_release — approved or scheduled
-- ----------------------
create or replace function public.admin_approve_artist_release(p_track_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_track record; v_new_status text;
begin
  if not exists (select 1 from public.users u where u.id = v_uid and u.role = 'admin') then
    raise exception 'admin only';
  end if;
  select id, release_status, release_date, source_type
    into v_track from public.tracks where id = p_track_id;
  if v_track.id is null then raise exception 'track not found'; end if;
  if v_track.source_type <> 'artist_upload' then raise exception 'not an artist upload'; end if;
  if v_track.release_status not in ('submitted','changes_requested') then
    raise exception 'cannot approve in release_status=%', v_track.release_status;
  end if;
  if v_track.release_date is null then raise exception 'release_date missing'; end if;

  -- release_date 가 이미 지난 경우 관리자에게 재지정 요구
  if v_track.release_date < current_date then
    raise exception 'release_date % already passed — please ask artist to reschedule', v_track.release_date;
  end if;

  v_new_status := case
    when v_track.release_date <= current_date then 'released'  -- 오늘이면 즉시 released
    else 'scheduled'
  end;

  update public.tracks set
    release_status = v_new_status,
    audio_review_status = 'approved',
    cover_review_status = 'approved',
    metadata_review_status = 'approved',
    approved_at = now(),
    scheduled_at = case when v_new_status = 'scheduled' then now() else null end,
    released_at = case when v_new_status = 'released' then now() else null end,
    reviewed_at = now(),
    reviewed_by = v_uid,
    admin_review_note = null,
    rejected_reason = null
  where id = p_track_id;

  return jsonb_build_object('ok', true, 'track_id', p_track_id, 'status', v_new_status);
end;
$$;
grant execute on function public.admin_approve_artist_release(uuid) to authenticated;

-- ----------------------
-- 11) admin_release_now — scheduled → released (release_date 도달 시)
-- ----------------------
create or replace function public.admin_release_now(p_track_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_track record;
begin
  if not exists (select 1 from public.users u where u.id = v_uid and u.role = 'admin') then
    raise exception 'admin only';
  end if;
  select id, release_status, release_date, source_type into v_track from public.tracks where id = p_track_id;
  if v_track.id is null then raise exception 'track not found'; end if;
  if v_track.source_type <> 'artist_upload' then raise exception 'not an artist upload'; end if;
  if v_track.release_status not in ('scheduled','approved') then
    raise exception 'cannot release in release_status=%', v_track.release_status;
  end if;
  if v_track.release_date is null or v_track.release_date > current_date then
    raise exception 'release_date % not reached yet', v_track.release_date;
  end if;

  update public.tracks set
    release_status = 'released',
    released_at = now()
  where id = p_track_id;

  return jsonb_build_object('ok', true, 'track_id', p_track_id, 'status', 'released');
end;
$$;
grant execute on function public.admin_release_now(uuid) to authenticated;

-- ----------------------
-- 12) admin_reject_artist_release
-- ----------------------
create or replace function public.admin_reject_artist_release(
  p_track_id uuid, p_note text
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_track record;
begin
  if not exists (select 1 from public.users u where u.id = v_uid and u.role = 'admin') then
    raise exception 'admin only';
  end if;
  select id, release_status, source_type into v_track from public.tracks where id = p_track_id;
  if v_track.id is null then raise exception 'track not found'; end if;
  if v_track.source_type <> 'artist_upload' then raise exception 'not an artist upload'; end if;
  if v_track.release_status in ('released','paid') then
    raise exception 'cannot reject in release_status=%', v_track.release_status;
  end if;

  update public.tracks set
    release_status = 'rejected',
    admin_review_note = nullif(btrim(coalesce(p_note, '')), ''),
    rejected_reason = nullif(btrim(coalesce(p_note, '')), ''),
    reviewed_at = now(),
    reviewed_by = v_uid
  where id = p_track_id;

  return jsonb_build_object('ok', true, 'track_id', p_track_id, 'status', 'rejected');
end;
$$;
grant execute on function public.admin_reject_artist_release(uuid, text) to authenticated;

-- ----------------------
-- 13) get_artist_upload_eligibility — release_date 안내 정보 추가
--     (기존 0062 시그니처 보존 + min_release_date 컬럼 추가)
-- ----------------------
drop function if exists public.get_artist_upload_eligibility();

create or replace function public.get_artist_upload_eligibility()
returns table(
  can_upload boolean, is_artist boolean, approval_status text,
  has_paid_membership boolean, contract_status text, has_signed_contract boolean,
  pending_contract_id uuid, payout_status text, payout_account_id uuid,
  min_release_date date,                    -- 0063 추가
  reasons text[]
)
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_account_type text; v_tier text;
  v_users_approval text; v_profile_approval text;
  v_contract_status text; v_pending_contract_id uuid;
  v_payout_id uuid; v_payout_status text;
  v_reasons text[] := array[]::text[];
begin
  if v_uid is null then
    return query select false, false, 'unauthenticated'::text, false,
      'unauthenticated'::text, false, null::uuid,
      'unauthenticated'::text, null::uuid,
      (current_date + interval '3 days')::date,
      array['login_required']::text[];
    return;
  end if;
  select account_type, membership_tier, artist_approval_status, contract_status
    into v_account_type, v_tier, v_users_approval, v_contract_status
  from public.users where id = v_uid;
  select approval_status into v_profile_approval
  from public.artist_profiles where user_id = v_uid;
  select id, verification_status into v_payout_id, v_payout_status
  from public.artist_payout_accounts where user_id = v_uid;
  select id into v_pending_contract_id
  from public.artist_contracts
  where artist_user_id = v_uid and status = 'pending_signature'
  order by created_at desc limit 1;
  if v_account_type is null or v_account_type <> 'artist' then
    v_reasons := array_append(v_reasons, 'not_artist');
  end if;
  if coalesce(v_users_approval, 'pending') <> 'approved' then
    if coalesce(v_profile_approval, '') = 'approved' then
      v_reasons := array_append(v_reasons, 'approval_sync_broken');
    else
      v_reasons := array_append(v_reasons, 'artist_not_approved');
    end if;
  end if;
  if coalesce(v_tier, 'free') <> 'individual' then
    v_reasons := array_append(v_reasons, 'no_paid_membership');
  end if;
  if coalesce(v_contract_status, 'not_created') <> 'signed' then
    v_reasons := array_append(v_reasons, 'no_signed_contract');
  end if;
  if v_payout_id is null then
    v_reasons := array_append(v_reasons, 'no_payout_account');
  elsif v_payout_status <> 'verified' then
    v_reasons := array_append(v_reasons, 'payout_not_verified');
  end if;
  return query select
    (array_length(v_reasons, 1) is null),
    (v_account_type = 'artist'),
    coalesce(v_users_approval, 'none'),
    (coalesce(v_tier, 'free') = 'individual'),
    coalesce(v_contract_status, 'not_created'),
    (coalesce(v_contract_status, 'not_created') = 'signed'),
    v_pending_contract_id,
    coalesce(v_payout_status, 'none'), v_payout_id,
    (current_date + interval '3 days')::date,
    v_reasons;
end;
$$;
grant execute on function public.get_artist_upload_eligibility() to authenticated;
