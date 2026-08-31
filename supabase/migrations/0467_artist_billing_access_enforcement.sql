-- ============================================================================
-- Phase ARTIST-BILLING-ACCESS-ENFORCEMENT-1
-- 결제 취소·미결제·만료 아티스트의 유료 기능(음원 등록/업로드/유통 신청/재신청/
-- 메타 수정/QC)을 서버·DB 계층에서 즉시 제한한다. 재결제 성공 시 자동 복구된다.
--
-- 배경/문제:
--   기존 유료 게이트(RLS tracks_artist_insert, RPC submit_artist_release,
--   get_artist_upload_eligibility)는 모두 users.membership_tier='individual' 한
--   컬럼만 확인한다. 이 컬럼은 PayApp 취소 Webhook/환불/관리자 탈퇴에서만
--   'free'로 내려가며, "본인 해지 유예기간" 및 "current_period_end 경과 / 재청구
--   실패"에는 내려가지 않는다. 따라서 취소·만료 아티스트가 여전히
--   membership_tier='individual' 을 보유한 채 업로드/유통 신청을 통과할 수 있다.
--
-- 해결(모두 additive):
--   1) 중앙 판정 SQL 함수 artist_has_paid_access(uuid) — 실제 subscription 상태
--      (status='active' AND cancel_requested_at IS NULL AND current_period_end>now()
--       AND 유효 플랜)를 기준으로 판정. 관리자·정확한 데모 UUID 4개는 예외.
--      Fail-Closed(대상 불명 → false). SECURITY DEFINER + search_path 고정.
--   2) tracks 콘텐츠 mutation(INSERT/UPDATE)에 BEFORE 트리거로 강제 — RLS 를
--      우회하는 SECURITY DEFINER RPC(submit_artist_release) 경로까지 커버.
--      관리자/service_role actor 는 통과(검수 승인·반려·QC 파이프라인 보호).
--   3) 방어심화: 기존 RLS(tracks_artist_insert / tracks_artist_update_pending),
--      track_audio_quality INSERT, storage audio/covers INSERT 에도 게이트를 AND.
--   4) 클라이언트 실시간 판정 RPC get_artist_billing_access() (authenticated).
--   5) 차단 감사 로그 테이블 + record_artist_billing_denial().
--
-- ⚠️ 안전 원칙:
--   • 기존 음원/정산/유통 데이터 및 상태를 변경·삭제하지 않는다(트리거는 신규
--     INSERT/UPDATE 시도에만 관여; SELECT·DELETE·정산·payout 미변경).
--   • 결제·청구 로직을 변경하지 않는다(권한 판정만; PayApp 호출 없음).
--   • 기존 유료 게이트에 조건을 AND 로 "추가"만 한다(느슨하게 만들지 않음).
--     영향 분석(Read-Only): 신규 제한 대상 아티스트 18명(취소 8 + 만료 10, 모두
--     membership_tier='individual' 잔존). 활성 결제 아티스트 62명 영향 0.
--   • 관리자·정확한 데모 UUID 4개 예외. 이메일/닉네임/fuzzy matching 미사용.
--   • 매장/브랜드 회원 정책 불변(게이트는 account_type='artist' 에만 적용).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- (A) 중앙 판정 함수
-- ----------------------------------------------------------------------------

-- account_type='artist' 여부 (게이트 적용 범위 판정용). 비아티스트는 미적용.
create or replace function public._is_artist_account(p_user_id uuid)
returns boolean
language sql stable security definer set search_path to 'public'
as $$
  select exists (
    select 1 from public.users u
    where u.id = p_user_id and u.account_type = 'artist'
  );
$$;

-- 유료 접근 판정 — 실제 subscription 상태 기준. Fail-Closed.
-- 관리자(role='admin') 및 정확한 데모 UUID 4개는 무조건 예외(true).
create or replace function public.artist_has_paid_access(p_user_id uuid)
returns boolean
language sql stable security definer set search_path to 'public'
as $$
  select case
    when p_user_id is null then false
    -- 예외: 관리자
    when exists (select 1 from public.users u where u.id = p_user_id and u.role = 'admin') then true
    -- 예외: 정확한 데모 UUID 4개 (fuzzy 금지 · 정확 일치)
    when p_user_id = any (array[
      'de700001-0000-0000-0000-000000000001',
      'de700002-0000-0000-0000-000000000001',
      'de700002-0000-0000-0000-000000000002',
      'de700002-0000-0000-0000-000000000003'
    ]::uuid[]) then true
    -- 유효 결제: 활성 · 취소요청 없음 · 기간 미경과 · 유효 유료 플랜
    else exists (
      select 1 from public.subscriptions s
      where s.user_id = p_user_id
        and s.status = 'active'
        and s.cancel_requested_at is null
        and s.current_period_end is not null
        and s.current_period_end > now()
        and s.plan_type in ('individual','business','artist_general','artist_student')
    )
  end;
$$;

-- 상세 판정(allowed/status/reason/restricted_at) — 클라이언트 배너·감사용.
-- status: active|exempt|cancelled|unpaid|expired|invalid
create or replace function public.artist_billing_access_detail(p_user_id uuid)
returns table(allowed boolean, status text, reason text, restricted_at timestamptz)
language plpgsql stable security definer set search_path to 'public'
as $$
declare
  v_is_admin boolean;
  v_is_demo boolean;
  v_ever_paid boolean;
  s record;
begin
  if p_user_id is null then
    return query select false, 'unpaid'::text, 'unpaid'::text, now(); return;
  end if;

  v_is_admin := exists (select 1 from public.users u where u.id = p_user_id and u.role = 'admin');
  v_is_demo := p_user_id = any (array[
      'de700001-0000-0000-0000-000000000001','de700002-0000-0000-0000-000000000001',
      'de700002-0000-0000-0000-000000000002','de700002-0000-0000-0000-000000000003']::uuid[]);

  if v_is_admin or v_is_demo then
    return query select true, 'exempt'::text, null::text, null::timestamptz; return;
  end if;

  -- 활성 접근이 존재하면 즉시 active
  if public.artist_has_paid_access(p_user_id) then
    return query select true, 'active'::text, null::text, null::timestamptz; return;
  end if;

  -- 제한 사유 판정 — 가장 최근 구독 기준
  select sb.status, sb.cancel_requested_at, sb.canceled_at, sb.current_period_end, sb.created_at
    into s
  from public.subscriptions sb
  where sb.user_id = p_user_id
  order by sb.created_at desc
  limit 1;

  v_ever_paid := exists (select 1 from public.payment_orders o where o.user_id = p_user_id and o.status = 'paid');

  if s is null then
    -- 구독 이력 없음 = 최초 결제 미완료
    return query select false, 'unpaid'::text, 'unpaid'::text, now(); return;
  end if;

  if s.cancel_requested_at is not null or s.status in ('canceled','cancel_scheduled') then
    return query select false, 'cancelled'::text, 'cancelled'::text,
      coalesce(s.cancel_requested_at, s.canceled_at, now()); return;
  end if;

  if not v_ever_paid or s.status in ('pending','payment_waiting','failed') then
    return query select false, 'unpaid'::text, 'unpaid'::text, coalesce(s.created_at, now()); return;
  end if;

  if s.status = 'expired' or (s.current_period_end is not null and s.current_period_end <= now()) then
    return query select false, 'expired'::text, 'expired'::text, coalesce(s.current_period_end, now()); return;
  end if;

  -- status='active' 인데 위 gate 를 통과 못함(기간 null 등) → 상태 확정 불가 → Fail-Closed invalid
  return query select false, 'invalid'::text, 'invalid'::text, now();
end;
$$;

-- 클라이언트 실시간 판정 (auth.uid()) — authenticated 호출.
create or replace function public.get_artist_billing_access()
returns table(allowed boolean, status text, reason text, restricted_at timestamptz, is_artist boolean)
language plpgsql stable security definer set search_path to 'public'
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return query select false, 'unpaid'::text, 'unpaid'::text, now(), false; return;
  end if;
  return query
    select d.allowed, d.status, d.reason, d.restricted_at, public._is_artist_account(v_uid)
    from public.artist_billing_access_detail(v_uid) d;
end;
$$;

-- ----------------------------------------------------------------------------
-- (B) tracks 콘텐츠 mutation 강제 트리거 (RPC/DEFINER 경로까지 커버)
-- ----------------------------------------------------------------------------
create or replace function public._tg_artist_tracks_billing_guard()
returns trigger
language plpgsql security definer set search_path to 'public'
as $$
declare v_actor uuid := auth.uid();
begin
  -- 아티스트 자가 업로드 콘텐츠에만 관여
  if coalesce(NEW.source_type, '') <> 'artist_upload' then
    return NEW;
  end if;
  -- 비로그인 컨텍스트(마이그레이션/백필/service_role 시스템 작업) 및 관리자/service_role
  -- actor(검수 승인·반려·QC·시스템 갱신)는 통과 — 기존 유통/승인/정산 파이프라인 보호.
  if v_actor is null or public._is_super_admin() then
    return NEW;
  end if;
  -- 실제 로그인 아티스트가 유효 결제가 아니면 신규 등록/저장/제출 차단(actor 기준).
  if not public.artist_has_paid_access(v_actor) then
    raise exception 'ARTIST_BILLING_REQUIRED'
      using hint = '정기결제 후 음원 등록·유통 신청 기능을 이용할 수 있습니다.',
            errcode = 'P0001';
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_artist_tracks_billing_guard on public.tracks;
create trigger trg_artist_tracks_billing_guard
  before insert or update on public.tracks
  for each row execute function public._tg_artist_tracks_billing_guard();

-- ----------------------------------------------------------------------------
-- (C) 방어심화: 기존 RLS 정책에 게이트 AND 추가 (client-direct 경로)
-- ----------------------------------------------------------------------------

-- tracks INSERT — 기존 조건 유지 + artist_has_paid_access AND
drop policy if exists "tracks_artist_insert" on public.tracks;
create policy "tracks_artist_insert" on public.tracks
  for insert with check (
    owner_user_id = auth.uid()
    and source_type = 'artist_upload'
    and visibility_status = 'pending_review'
    and release_status = 'submitted'
    and release_date is not null
    and release_date >= (current_date + interval '3 days')::date
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
    and public.artist_has_paid_access(auth.uid())
  );

-- tracks UPDATE — 기존 조건 유지 + 게이트 AND (저장·재제출 차단; 열람은 SELECT 로 유지)
drop policy if exists "tracks_artist_update_pending" on public.tracks;
create policy "tracks_artist_update_pending" on public.tracks
  for update using (
    owner_user_id = auth.uid()
    and source_type = 'artist_upload'
    and release_status = any (array['draft','changes_requested'])
    and public.artist_has_paid_access(auth.uid())
  ) with check (
    owner_user_id = auth.uid()
    and source_type = 'artist_upload'
    and release_status = any (array['draft','submitted','changes_requested'])
    and public.artist_has_paid_access(auth.uid())
  );

-- track_audio_quality INSERT — 아티스트 계정은 유효 결제 필요(비아티스트 미적용)
drop policy if exists "taq_self_insert" on public.track_audio_quality;
create policy "taq_self_insert" on public.track_audio_quality
  for insert with check (
    (user_id is null or user_id = auth.uid())
    and (
      not public._is_artist_account(auth.uid())
      or public.artist_has_paid_access(auth.uid())
    )
  );

-- ----------------------------------------------------------------------------
-- (D) storage audio/covers 업로드 — 아티스트 계정은 유효 결제 필요
-- ----------------------------------------------------------------------------
drop policy if exists "audio_authed_write" on storage.objects;
create policy "audio_authed_write" on storage.objects
  for insert with check (
    bucket_id = 'audio'
    and auth.role() = 'authenticated'
    and (
      not public._is_artist_account(auth.uid())
      or public.artist_has_paid_access(auth.uid())
    )
  );

drop policy if exists "covers_authed_write" on storage.objects;
create policy "covers_authed_write" on storage.objects
  for insert with check (
    bucket_id = 'covers'
    and auth.role() = 'authenticated'
    and (
      not public._is_artist_account(auth.uid())
      or public.artist_has_paid_access(auth.uid())
    )
  );

-- ----------------------------------------------------------------------------
-- (E) 차단 감사 로그
-- ----------------------------------------------------------------------------
create table if not exists public.artist_billing_access_denials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  capability text not null,
  access_status text,
  reason text,
  request_source text,
  subscription_id uuid,
  occurred_at timestamptz not null default now()
);
create index if not exists idx_artist_billing_denials_user
  on public.artist_billing_access_denials (user_id, occurred_at desc);

alter table public.artist_billing_access_denials enable row level security;

drop policy if exists "abad_admin_read" on public.artist_billing_access_denials;
create policy "abad_admin_read" on public.artist_billing_access_denials
  for select using (public._is_super_admin());

-- 차단 이벤트 기록 (authenticated) — 개인정보/Secret 미기록. 본인 UUID 만.
create or replace function public.record_artist_billing_denial(
  p_capability text, p_source text default null)
returns void
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  d record;
  v_sub_id uuid;
begin
  if v_uid is null then return; end if;
  select * into d from public.artist_billing_access_detail(v_uid);
  -- 접근 허용 상태면 기록하지 않음(렌더 폭증 방지 · 실제 차단만)
  if d.allowed then return; end if;
  select id into v_sub_id from public.subscriptions
    where user_id = v_uid order by created_at desc limit 1;
  insert into public.artist_billing_access_denials
    (user_id, capability, access_status, reason, request_source, subscription_id)
  values
    (v_uid, left(coalesce(p_capability,'unknown'),64), d.status, d.reason,
     left(coalesce(p_source,'app'),64), v_sub_id);
end;
$$;

-- ----------------------------------------------------------------------------
-- (F) 권한 부여
-- ----------------------------------------------------------------------------
grant execute on function public.artist_has_paid_access(uuid) to authenticated, service_role;
grant execute on function public._is_artist_account(uuid) to authenticated, service_role;
grant execute on function public.artist_billing_access_detail(uuid) to authenticated, service_role;
grant execute on function public.get_artist_billing_access() to authenticated;
grant execute on function public.record_artist_billing_denial(text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- (G) 검증(Read-Only sanity)
-- ----------------------------------------------------------------------------
do $$
declare v_allows int; v_blocks int;
begin
  select count(*) filter (where public.artist_has_paid_access(u.id)),
         count(*) filter (where not public.artist_has_paid_access(u.id))
    into v_allows, v_blocks
  from public.users u where u.account_type = 'artist';
  raise notice '[0467] artist paid-access: allows=% blocks=% (expected allows=65 blocks=70 at build time)', v_allows, v_blocks;
end $$;
