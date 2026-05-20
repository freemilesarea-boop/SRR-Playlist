-- 0098 — 큐레이터 시스템: 권한 + 플레이리스트 출시 상태 + RLS + RPC
--
-- 정책 (사용자 승인):
--   - users.is_curator boolean (role enum 확장 X, artist/business 와 직교)
--   - playlists 출시 상태 draft / released 2단계 (검수 단계는 추후 0099)
--   - released 후 트랙 추가/삭제 허용, 메타 수정은 draft 에서만
--   - 큐레이터는 자기 플리만, admin 은 전체
--   - 일반/anon 은 released 만 조회
--
-- ⚠ 기존 admin 큐레이팅 플리는 모두 이미 public 이므로 'released' 로 백필.
--   (status default 'released' 로 컬럼 추가 → 기존 행 채움 → default 'draft' 로 변경)

-- ============================================
-- 1) users.is_curator
-- ============================================
alter table public.users
  add column if not exists is_curator boolean not null default false;

create index if not exists users_is_curator_idx
  on public.users(is_curator) where is_curator = true;

-- ============================================
-- 2) playlists 출시 컬럼
-- ============================================
-- (a) status: 기존 행은 'released' 로 채우기 위해 default 'released' 로 추가
alter table public.playlists
  add column if not exists status text not null default 'released'
    check (status in ('draft', 'released'));
-- (b) 기존 행에 released_at = created_at 백필
alter table public.playlists
  add column if not exists released_at timestamptz;
update public.playlists set released_at = created_at where released_at is null;
-- (c) 신규 행 default 를 'draft' 로 변경 (큐레이터 생성 플리는 draft 로 시작)
alter table public.playlists alter column status set default 'draft';
-- (d) 태그
alter table public.playlists
  add column if not exists mood_tags text[] not null default '{}',
  add column if not exists situation_tags text[] not null default '{}';

create index if not exists playlists_status_released_at_idx
  on public.playlists(status, released_at desc);

-- ============================================
-- 3) RLS — playlists 조회/쓰기 정책 갱신
-- ============================================
-- (a) read: released 또는 본인 또는 admin
drop policy if exists playlists_read_all on public.playlists;
create policy playlists_read_all on public.playlists
  for select
  using (
    status = 'released'
    or created_by_user_id = auth.uid()
    or exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin')
  );

-- (b) curator INSERT: 본인 + is_curator
drop policy if exists playlists_curator_insert on public.playlists;
create policy playlists_curator_insert on public.playlists
  for insert
  with check (
    created_by_user_id = auth.uid()
    and exists (select 1 from public.users u where u.id = auth.uid() and u.is_curator = true)
  );

-- (c) curator UPDATE: 본인 + draft 상태에서만 (released 후 메타 변경은 admin 만 — playlists_admin_write 가 처리)
drop policy if exists playlists_curator_update_draft on public.playlists;
create policy playlists_curator_update_draft on public.playlists
  for update
  using (
    created_by_user_id = auth.uid()
    and status = 'draft'
    and exists (select 1 from public.users u where u.id = auth.uid() and u.is_curator = true)
  )
  with check (
    created_by_user_id = auth.uid()
    and exists (select 1 from public.users u where u.id = auth.uid() and u.is_curator = true)
  );

-- (d) curator DELETE: 본인 + draft 만
drop policy if exists playlists_curator_delete_draft on public.playlists;
create policy playlists_curator_delete_draft on public.playlists
  for delete
  using (
    created_by_user_id = auth.uid()
    and status = 'draft'
    and exists (select 1 from public.users u where u.id = auth.uid() and u.is_curator = true)
  );

-- ============================================
-- 4) RLS — playlist_tracks: 본인 플리 (draft+released 모두) 트랙 add/remove 허용
-- ============================================
drop policy if exists playlist_tracks_curator_write on public.playlist_tracks;
create policy playlist_tracks_curator_write on public.playlist_tracks
  for all
  using (
    exists (
      select 1 from public.playlists p
      join public.users u on u.id = auth.uid()
      where p.id = playlist_tracks.playlist_id
        and p.created_by_user_id = auth.uid()
        and u.is_curator = true
    )
  )
  with check (
    exists (
      select 1 from public.playlists p
      join public.users u on u.id = auth.uid()
      where p.id = playlist_tracks.playlist_id
        and p.created_by_user_id = auth.uid()
        and u.is_curator = true
    )
  );

-- ============================================
-- 5) RPC — 큐레이터 플레이리스트 생성/출시/취소
-- ============================================
create or replace function public.create_curator_playlist(
  p_title text,
  p_category text,
  p_description text default null,
  p_business_category text default null,
  p_time_slot text default null,
  p_is_business_only boolean default false,
  p_mood_tags text[] default '{}',
  p_situation_tags text[] default '{}'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
begin
  if v_uid is null then raise exception 'unauthorized'; end if;
  if not exists (select 1 from public.users where id = v_uid and is_curator = true) then
    raise exception 'not a curator';
  end if;
  if p_title is null or length(btrim(p_title)) = 0 then
    raise exception 'title required';
  end if;
  if p_category is null or length(btrim(p_category)) = 0 then
    raise exception 'category required';
  end if;

  insert into public.playlists (
    title, category, description, business_category, time_slot,
    is_business_only, mood_tags, situation_tags,
    created_by_user_id, status
  ) values (
    btrim(p_title), btrim(p_category), p_description, p_business_category, p_time_slot,
    coalesce(p_is_business_only, false), coalesce(p_mood_tags, '{}'), coalesce(p_situation_tags, '{}'),
    v_uid, 'draft'
  )
  returning id into v_id;

  return v_id;
end;
$$;
revoke execute on function public.create_curator_playlist(text, text, text, text, text, boolean, text[], text[]) from public, anon;
grant execute on function public.create_curator_playlist(text, text, text, text, text, boolean, text[], text[]) to authenticated;

-- 출시 — 본인 draft 플리, 트랙 1개 이상
create or replace function public.release_curator_playlist(p_playlist_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_owner uuid;
  v_status text;
  v_track_count int;
begin
  if v_uid is null then raise exception 'unauthorized'; end if;

  select created_by_user_id, status into v_owner, v_status
  from public.playlists where id = p_playlist_id;
  if v_owner is null then raise exception 'playlist not found'; end if;

  -- 본인 또는 admin
  if v_owner <> v_uid
     and not exists (select 1 from public.users where id = v_uid and role = 'admin') then
    raise exception 'forbidden';
  end if;

  select count(*) into v_track_count from public.playlist_tracks where playlist_id = p_playlist_id;
  if v_track_count = 0 then
    raise exception '트랙을 1개 이상 추가한 뒤 출시할 수 있어요.';
  end if;

  update public.playlists
    set status = 'released',
        released_at = coalesce(released_at, now())
    where id = p_playlist_id;

  return jsonb_build_object('ok', true, 'status', 'released', 'track_count', v_track_count);
end;
$$;
revoke execute on function public.release_curator_playlist(uuid) from public, anon;
grant execute on function public.release_curator_playlist(uuid) to authenticated;

-- 출시 취소 (released → draft, 홈에서 숨김). 본인 또는 admin.
create or replace function public.unrelease_curator_playlist(p_playlist_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_owner uuid;
begin
  if v_uid is null then raise exception 'unauthorized'; end if;
  select created_by_user_id into v_owner from public.playlists where id = p_playlist_id;
  if v_owner is null then raise exception 'playlist not found'; end if;
  if v_owner <> v_uid
     and not exists (select 1 from public.users where id = v_uid and role = 'admin') then
    raise exception 'forbidden';
  end if;

  update public.playlists set status = 'draft' where id = p_playlist_id;
  return jsonb_build_object('ok', true, 'status', 'draft');
end;
$$;
revoke execute on function public.unrelease_curator_playlist(uuid) from public, anon;
grant execute on function public.unrelease_curator_playlist(uuid) to authenticated;

-- 본인 큐레이터 플리 목록 (draft + released)
create or replace function public.get_my_curator_playlists()
returns table(
  id uuid, title text, category text, description text, thumbnail_url text,
  business_category text, time_slot text, is_business_only boolean,
  status text, released_at timestamptz, created_at timestamptz,
  track_count bigint, follower_count bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'unauthorized'; end if;
  return query
  select p.id, p.title, p.category, p.description, p.thumbnail_url,
         p.business_category, p.time_slot, p.is_business_only,
         p.status, p.released_at, p.created_at,
         coalesce((select count(*)::bigint from public.playlist_tracks pt where pt.playlist_id = p.id), 0),
         coalesce((select count(*)::bigint from public.playlist_follows pf where pf.playlist_id = p.id), 0)
  from public.playlists p
  where p.created_by_user_id = v_uid
  order by p.created_at desc;
end;
$$;
revoke execute on function public.get_my_curator_playlists() from public, anon;
grant execute on function public.get_my_curator_playlists() to authenticated;

-- 홈 노출용 — released 큐레이터 플리 (운영자 직접 제작 제외, 큐레이터만)
create or replace function public.get_curator_made_playlists(p_limit int default 8)
returns table(
  id uuid, title text, category text, thumbnail_url text,
  curator_user_id uuid, curator_handle text, curator_name text,
  released_at timestamptz, follower_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.title, p.category, p.thumbnail_url,
         p.created_by_user_id as curator_user_id,
         cp.handle as curator_handle,
         cp.display_name as curator_name,
         p.released_at,
         coalesce((select count(*)::bigint from public.playlist_follows pf where pf.playlist_id = p.id), 0) as follower_count
  from public.playlists p
  join public.users u on u.id = p.created_by_user_id and u.is_curator = true
  left join public.curator_profiles cp on cp.user_id = p.created_by_user_id
  where p.status = 'released'
  order by p.released_at desc nulls last
  limit greatest(1, least(p_limit, 30));
$$;
grant execute on function public.get_curator_made_playlists(int) to anon, authenticated;

-- ============================================
-- 6) admin — 큐레이터 권한 부여/회수
-- ============================================
create or replace function public.admin_grant_curator(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not _internal_is_admin_caller() then raise exception 'admin only'; end if;
  update public.users set is_curator = true where id = p_user_id;
  begin
    perform admin_log_operation('admin_member_actions', 'member', 'info', 'completed',
      format('grant curator %s', p_user_id),
      jsonb_build_object('user_id', p_user_id), p_user_id, p_user_id::text, null, null, null);
  exception when others then null; end;
  return jsonb_build_object('ok', true, 'is_curator', true);
end;
$$;
revoke execute on function public.admin_grant_curator(uuid) from public, anon;
grant execute on function public.admin_grant_curator(uuid) to authenticated;

create or replace function public.admin_revoke_curator(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not _internal_is_admin_caller() then raise exception 'admin only'; end if;
  update public.users set is_curator = false where id = p_user_id;
  begin
    perform admin_log_operation('admin_member_actions', 'member', 'warning', 'completed',
      format('revoke curator %s', p_user_id),
      jsonb_build_object('user_id', p_user_id), p_user_id, p_user_id::text, null, null, null);
  exception when others then null; end;
  return jsonb_build_object('ok', true, 'is_curator', false);
end;
$$;
revoke execute on function public.admin_revoke_curator(uuid) from public, anon;
grant execute on function public.admin_revoke_curator(uuid) to authenticated;

do $$ begin raise notice '[0098] curator system installed'; end $$;

-- ============================================
-- 7) admin_member_detail 에 is_curator 노출 (MemberDetail UI 의 권한 토글용)
-- ============================================
-- 기존 0096 정의 + user jsonb 에 is_curator 추가. (전체 재정의)
create or replace function public.admin_member_detail(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_result jsonb;
begin
  begin
    if not public._internal_is_admin_caller() then raise exception 'admin only'; end if;
  exception when undefined_function then
    if not exists (select 1 from public.users as u where u.id = auth.uid() and u.role='admin') then
      raise exception 'admin only';
    end if;
  end;
  select jsonb_build_object(
    'user', jsonb_build_object(
      'id', u.id, 'email', au.email, 'nickname', u.nickname,
      'role', u.role, 'subscription_type', u.subscription_type,
      'account_type', u.account_type, 'membership_tier', u.membership_tier,
      'business_category', u.business_category, 'created_at', u.created_at,
      'withdrawn_at', u.withdrawn_at, 'withdrawn_reason', u.withdrawn_reason,
      'disabled_at', u.disabled_at, 'disabled_reason', u.disabled_reason,
      'pii_masked_at', u.pii_masked_at, 'is_curator', u.is_curator,
      'last_sign_in_at', au.last_sign_in_at
    ),
    'subscriptions', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'status', s.status, 'plan_type', s.plan_type, 'price', s.price, 'auto_renew', s.auto_renew, 'last_paid_at', s.last_paid_at, 'current_period_start', s.current_period_start, 'current_period_end', s.current_period_end, 'canceled_at', s.canceled_at, 'cancel_reason', s.cancel_reason, 'refunded_at', s.refunded_at, 'payapp_mul_no', s.payapp_mul_no, 'payapp_rebill_no', s.payapp_rebill_no, 'created_at', s.created_at) order by s.created_at desc), '[]'::jsonb) from public.subscriptions as s where s.user_id = p_user_id),
    'total_streams', (select count(*) from public.stream_events as se where se.user_id = p_user_id and se.event_type='milestone_30s'),
    'total_listened_seconds', coalesce((select sum(se.listened_seconds) from public.stream_events as se where se.user_id = p_user_id and se.event_type in ('milestone_30s','complete')), 0),
    'last_seen_at', (select max(ve.created_at) from public.visitor_events as ve where ve.user_id = p_user_id),
    'recent_visits', (select coalesce(jsonb_agg(jsonb_build_object('path', v.path, 'created_at', v.created_at) order by v.created_at desc), '[]'::jsonb) from (select ve.path, ve.created_at from public.visitor_events as ve where ve.user_id = p_user_id order by ve.created_at desc limit 10) as v),
    'recent_plays', (select coalesce(jsonb_agg(jsonb_build_object('track_title', rp.track_title, 'playlist_title', rp.playlist_title, 'completed', rp.completed, 'created_at', rp.created_at) order by rp.created_at desc), '[]'::jsonb) from (select se.created_at, t.title as track_title, p.title as playlist_title, (se.event_type = 'complete') as completed from public.stream_events as se left join public.tracks as t on t.id = se.track_id left join public.playlists as p on p.id = se.playlist_id where se.user_id = p_user_id and se.event_type in ('milestone_30s', 'complete') order by se.created_at desc limit 10) as rp),
    'revenue', (select coalesce(jsonb_agg(jsonb_build_object('amount', re.amount, 'subscription_type', re.subscription_type, 'status', re.status, 'paid_at', re.paid_at, 'payment_provider', re.payment_provider, 'note', re.note) order by re.paid_at desc), '[]'::jsonb) from public.revenue_events as re where re.user_id = p_user_id),
    'subscription_requests', (select coalesce(jsonb_agg(jsonb_build_object('requested_plan', sr.requested_plan, 'status', sr.status, 'created_at', sr.created_at) order by sr.created_at desc), '[]'::jsonb) from public.subscription_requests as sr where sr.user_id = p_user_id),
    'sales_agent', (select jsonb_build_object('id', sa.id, 'name', sa.name, 'code', sa.code, 'is_active', sa.is_active, 'commission_rate', sa.commission_rate, 'linked_at', sa.created_at) from public.sales_agents as sa where sa.user_id = p_user_id limit 1)
  ) into v_result
  from public.users as u left join auth.users as au on au.id = u.id where u.id = p_user_id;
  return v_result;
end; $$;
revoke execute on function public.admin_member_detail(uuid) from public, anon;
grant execute on function public.admin_member_detail(uuid) to authenticated;
