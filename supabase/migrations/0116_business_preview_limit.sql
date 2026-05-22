-- 0116 — 업종별 미리듣기 2회 무료 제한 (additive only)
--   사업자(account_type='business') 2회 / admin 무제한 / 그 외 차단.
--   로그 테이블 기반 집계(프로필 카운트 컬럼 추가 안 함).

create table if not exists public.business_playlist_preview_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete cascade,
  playlist_id uuid,
  preview_category text,
  played_at timestamptz not null default now()
);
create index if not exists idx_bpp_logs_user on public.business_playlist_preview_logs (user_id);

alter table public.business_playlist_preview_logs enable row level security;
drop policy if exists bpp_logs_self_read on public.business_playlist_preview_logs;
create policy bpp_logs_self_read on public.business_playlist_preview_logs for select to authenticated
  using (user_id = auth.uid() or exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin'));
drop policy if exists bpp_logs_self_insert on public.business_playlist_preview_logs;
create policy bpp_logs_self_insert on public.business_playlist_preview_logs for insert to authenticated
  with check (user_id = auth.uid());

create or replace function public.get_business_preview_status()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare v_uid uuid := auth.uid(); v_role text; v_acct text; v_used int; v_limit int := 2;
begin
  if v_uid is null then
    return jsonb_build_object('is_authenticated', false, 'is_admin', false, 'is_business', false,
      'used', 0, 'limit', v_limit, 'remaining', v_limit, 'can_preview', false, 'reason', 'login_required');
  end if;
  select role, account_type into v_role, v_acct from public.users where id = v_uid;
  if v_role = 'admin' then
    return jsonb_build_object('is_authenticated', true, 'is_admin', true, 'is_business', (v_acct='business'),
      'used', 0, 'limit', v_limit, 'remaining', 9999, 'can_preview', true, 'reason', 'admin');
  end if;
  if coalesce(v_acct,'') <> 'business' then
    return jsonb_build_object('is_authenticated', true, 'is_admin', false, 'is_business', false,
      'used', 0, 'limit', v_limit, 'remaining', 0, 'can_preview', false, 'reason', 'not_business');
  end if;
  select count(*) into v_used from public.business_playlist_preview_logs where user_id = v_uid;
  return jsonb_build_object('is_authenticated', true, 'is_admin', false, 'is_business', true,
    'used', v_used, 'limit', v_limit, 'remaining', greatest(v_limit - v_used, 0),
    'can_preview', v_used < v_limit, 'reason', case when v_used < v_limit then 'ok' else 'limit_reached' end);
end; $function$;
grant execute on function public.get_business_preview_status() to anon, authenticated;

create or replace function public.record_business_preview_play(p_category text, p_playlist_id uuid default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v_uid uuid := auth.uid(); v_role text; v_acct text; v_used int; v_limit int := 2;
begin
  if v_uid is null then return jsonb_build_object('allowed', false, 'reason', 'login_required'); end if;
  select role, account_type into v_role, v_acct from public.users where id = v_uid;
  if v_role = 'admin' then
    insert into public.business_playlist_preview_logs(user_id, playlist_id, preview_category)
      values (v_uid, p_playlist_id, p_category);
    return jsonb_build_object('allowed', true, 'reason', 'admin', 'remaining', 9999, 'used', 0, 'limit', v_limit);
  end if;
  if coalesce(v_acct,'') <> 'business' then
    return jsonb_build_object('allowed', false, 'reason', 'not_business', 'remaining', 0, 'limit', v_limit);
  end if;
  select count(*) into v_used from public.business_playlist_preview_logs where user_id = v_uid;
  if v_used >= v_limit then
    return jsonb_build_object('allowed', false, 'reason', 'limit_reached', 'used', v_used, 'remaining', 0, 'limit', v_limit);
  end if;
  insert into public.business_playlist_preview_logs(user_id, playlist_id, preview_category)
    values (v_uid, p_playlist_id, p_category);
  return jsonb_build_object('allowed', true, 'reason', 'ok', 'used', v_used + 1,
    'remaining', greatest(v_limit - (v_used + 1), 0), 'limit', v_limit);
end; $function$;
grant execute on function public.record_business_preview_play(text, uuid) to authenticated;
