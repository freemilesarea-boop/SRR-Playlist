-- 0568 — 사용자 생성 콘텐츠(UGC) 신고 · 사용자 차단.
--
-- 왜: App Store 심사 지침 1.2 — 다른 사용자가 만든 콘텐츠가 보이는 앱은
--   (1) 부적절한 콘텐츠를 신고하는 수단, (2) 문제 사용자를 차단하는 수단,
--   (3) 운영자가 신고를 처리하는 절차가 있어야 한다. 2026-11 iOS 심사에서 요청됨.
--
-- 듣다에서 다른 사용자가 만든 공개 콘텐츠:
--   track          아티스트가 업로드한 음원(검수 후 공개)
--   playlist       큐레이터가 만든 플레이리스트(playlists.created_by_user_id)
--   user_playlist  회원이 만든 공개 플레이리스트(user_playlists.owner_user_id)
--   curator        큐레이터 프로필(curator_profiles.user_id)
--
-- 차단은 "사용자" 단위다. 차단한 사람의 플레이리스트·큐레이터 프로필은 나에게 보이지 않는다
-- (화면 필터는 클라이언트가 my_blocked_user_ids() 로 한다).
-- 신고가 들어오면 관리자 알림(admin_notifications)이 바로 생긴다 — 지침의 "신속한 처리".

-- ── 신고 ────────────────────────────────────────────────────────────
create table if not exists public.content_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.users(id) on delete cascade,
  target_type text not null check (target_type in ('track','playlist','user_playlist','curator')),
  target_id uuid not null,
  -- 신고 대상 콘텐츠의 주인(차단·제재 판단용). 찾지 못하면 null.
  target_owner_id uuid references public.users(id) on delete set null,
  -- 신고 시점의 제목/이름 — 콘텐츠가 바뀌거나 지워져도 무엇을 신고했는지 남긴다.
  target_label text,
  reason text not null check (reason in ('spam','sexual','violence_hate','copyright','impersonation','other')),
  detail text check (detail is null or char_length(detail) <= 1000),
  status text not null default 'open' check (status in ('open','actioned','dismissed')),
  admin_note text,
  resolved_at timestamptz,
  resolved_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_content_reports_status on public.content_reports (status, created_at desc);
create index if not exists idx_content_reports_target on public.content_reports (target_type, target_id);
-- 같은 사람이 같은 대상을 처리 전에 여러 번 신고해도 한 건으로 본다.
create unique index if not exists uq_content_reports_open
  on public.content_reports (reporter_id, target_type, target_id) where status = 'open';

alter table public.content_reports enable row level security;
revoke all on public.content_reports from anon, authenticated;
drop policy if exists content_reports_select_own on public.content_reports;
create policy content_reports_select_own on public.content_reports
  for select to authenticated using (reporter_id = auth.uid());
grant select on public.content_reports to authenticated;

-- ── 차단 ────────────────────────────────────────────────────────────
create table if not exists public.user_blocks (
  blocker_id uuid not null references public.users(id) on delete cascade,
  blocked_user_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_user_id),
  check (blocker_id <> blocked_user_id)
);

alter table public.user_blocks enable row level security;
revoke all on public.user_blocks from anon, authenticated;
drop policy if exists user_blocks_select_own on public.user_blocks;
create policy user_blocks_select_own on public.user_blocks
  for select to authenticated using (blocker_id = auth.uid());
grant select on public.user_blocks to authenticated;

-- ── 신고 접수 ────────────────────────────────────────────────────────
create or replace function public.report_content(
  p_target_type text,
  p_target_id uuid,
  p_reason text,
  p_detail text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_uid uuid := auth.uid();
  v_owner uuid;
  v_label text;
  v_id uuid;
begin
  if v_uid is null then raise exception 'login_required'; end if;
  if p_target_type not in ('track','playlist','user_playlist','curator') then
    raise exception 'invalid_target_type';
  end if;
  if p_reason not in ('spam','sexual','violence_hate','copyright','impersonation','other') then
    raise exception 'invalid_reason';
  end if;

  if p_target_type = 'track' then
    select t.owner_user_id, t.title || coalesce(' — ' || t.artist, '') into v_owner, v_label
      from public.tracks t where t.id = p_target_id;
  elsif p_target_type = 'playlist' then
    select p.created_by_user_id, p.title into v_owner, v_label
      from public.playlists p where p.id = p_target_id;
  elsif p_target_type = 'user_playlist' then
    select up.owner_user_id, up.title into v_owner, v_label
      from public.user_playlists up where up.id = p_target_id;
  else -- curator: target_id 가 곧 사용자 id
    select c.user_id, c.display_name || ' (@' || c.handle || ')' into v_owner, v_label
      from public.curator_profiles c where c.user_id = p_target_id;
  end if;

  if v_label is null then raise exception 'target_not_found'; end if;
  if v_owner = v_uid then raise exception 'cannot_report_own_content'; end if;

  -- 처리 전 같은 신고가 있으면 그 건을 돌려준다(중복 알림 방지).
  select id into v_id from public.content_reports
   where reporter_id = v_uid and target_type = p_target_type and target_id = p_target_id and status = 'open';
  if v_id is not null then return v_id; end if;

  insert into public.content_reports (reporter_id, target_type, target_id, target_owner_id, target_label, reason, detail)
  values (v_uid, p_target_type, p_target_id, v_owner, v_label, p_reason, nullif(btrim(coalesce(p_detail, '')), ''))
  returning id into v_id;

  insert into public.admin_notifications (kind, severity, title, body, context, track_id)
  values (
    'content_report', 'warning',
    '콘텐츠 신고 접수',
    v_label,
    jsonb_build_object('report_id', v_id, 'target_type', p_target_type, 'target_id', p_target_id, 'reason', p_reason),
    case when p_target_type = 'track' then p_target_id else null end
  );

  return v_id;
end;
$function$;

revoke execute on function public.report_content(text, uuid, text, text) from public, anon;
grant execute on function public.report_content(text, uuid, text, text) to authenticated;

-- ── 차단 / 차단 해제 / 내 차단 목록 ───────────────────────────────────
create or replace function public.block_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $function$
begin
  if auth.uid() is null then raise exception 'login_required'; end if;
  if p_user_id is null or p_user_id = auth.uid() then raise exception 'invalid_target'; end if;
  if not exists (select 1 from public.users where id = p_user_id) then raise exception 'target_not_found'; end if;
  insert into public.user_blocks (blocker_id, blocked_user_id) values (auth.uid(), p_user_id)
  on conflict do nothing;
end;
$function$;

create or replace function public.unblock_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $function$
begin
  if auth.uid() is null then raise exception 'login_required'; end if;
  delete from public.user_blocks where blocker_id = auth.uid() and blocked_user_id = p_user_id;
end;
$function$;

-- 내 차단 목록(이름 포함) — 설정 화면용.
create or replace function public.my_blocked_users()
returns table (user_id uuid, display_name text, blocked_at timestamptz)
language sql
stable
security definer
set search_path = public
as $function$
  select b.blocked_user_id,
         coalesce(c.display_name, nullif(u.nickname, ''), '알 수 없는 사용자'),
         b.created_at
    from public.user_blocks b
    left join public.users u on u.id = b.blocked_user_id
    left join public.curator_profiles c on c.user_id = b.blocked_user_id
   where b.blocker_id = auth.uid()
   order by b.created_at desc;
$function$;

revoke execute on function public.block_user(uuid) from public, anon;
revoke execute on function public.unblock_user(uuid) from public, anon;
revoke execute on function public.my_blocked_users() from public, anon;
grant execute on function public.block_user(uuid) to authenticated;
grant execute on function public.unblock_user(uuid) to authenticated;
grant execute on function public.my_blocked_users() to authenticated;

-- ── 관리자: 신고 목록 / 처리 ──────────────────────────────────────────
create or replace function public.admin_list_content_reports(p_status text default 'open')
returns table (
  id uuid, target_type text, target_id uuid, target_label text, target_owner_id uuid,
  owner_name text, reason text, detail text, status text, admin_note text,
  reporter_name text, report_count bigint, created_at timestamptz, resolved_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $function$
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  return query
  select r.id, r.target_type, r.target_id, r.target_label, r.target_owner_id,
         coalesce(oc.display_name, nullif(ou.nickname, ''), nullif(ou.full_name, '')),
         r.reason, r.detail, r.status, r.admin_note,
         coalesce(nullif(ru.nickname, ''), nullif(ru.full_name, ''), '회원'),
         (select count(*) from public.content_reports x where x.target_type = r.target_type and x.target_id = r.target_id),
         r.created_at, r.resolved_at
    from public.content_reports r
    left join public.users ou on ou.id = r.target_owner_id
    left join public.curator_profiles oc on oc.user_id = r.target_owner_id
    left join public.users ru on ru.id = r.reporter_id
   where p_status is null or p_status = 'all' or r.status = p_status
   order by r.created_at desc
   limit 500;
end;
$function$;

-- p_status: 'actioned'(조치함) / 'dismissed'(문제없음).
-- p_hide_user_playlist: 회원 플레이리스트 신고일 때 그 플레이리스트를 비공개로 돌린다.
--   음원·큐레이터 플레이리스트·큐레이터 프로필 조치는 기존 관리 화면(콘텐츠 관리 / 큐레이터 관리)에서 한다.
create or replace function public.admin_resolve_content_report(
  p_report_id uuid,
  p_status text,
  p_note text default null,
  p_hide_user_playlist boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  r public.content_reports%rowtype;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  if p_status not in ('actioned','dismissed') then raise exception 'invalid_status'; end if;

  select * into r from public.content_reports where id = p_report_id for update;
  if not found then raise exception 'report_not_found'; end if;

  if p_hide_user_playlist and r.target_type = 'user_playlist' then
    update public.user_playlists set is_public = false, updated_at = now() where id = r.target_id;
  end if;

  -- 같은 대상에 대한 열린 신고를 함께 닫는다.
  update public.content_reports
     set status = p_status,
         admin_note = nullif(btrim(coalesce(p_note, '')), ''),
         resolved_at = now(),
         resolved_by = auth.uid()
   where target_type = r.target_type and target_id = r.target_id and status = 'open';
end;
$function$;

revoke execute on function public.admin_list_content_reports(text) from public, anon;
revoke execute on function public.admin_resolve_content_report(uuid, text, text, boolean) from public, anon;
grant execute on function public.admin_list_content_reports(text) to authenticated;
grant execute on function public.admin_resolve_content_report(uuid, text, text, boolean) to authenticated;
