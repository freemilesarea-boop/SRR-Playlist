-- 0128 — 아티스트 초대코드 시스템 (additive). 코드 없이는 아티스트 생성 불가하게 만들 기반.
create table if not exists public.artist_invite_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  note text,
  created_by uuid references public.users(id),
  used_by uuid references public.users(id),
  used_at timestamptz,
  expires_at timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.artist_invite_codes enable row level security;

drop policy if exists aic_admin_all on public.artist_invite_codes;
create policy aic_admin_all on public.artist_invite_codes for all
  using (exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin'))
  with check (exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin'));
revoke all on public.artist_invite_codes from authenticated, anon;

create or replace function public._consume_artist_invite_code(p_code text, p_user_id uuid)
returns boolean language plpgsql security definer set search_path to 'public' as $function$
declare v_id uuid;
begin
  if nullif(btrim(coalesce(p_code, '')), '') is null then return false; end if;
  update public.artist_invite_codes
    set used_by = p_user_id, used_at = now()
    where id = (
      select id from public.artist_invite_codes
      where upper(btrim(code)) = upper(btrim(p_code))
        and is_active = true and used_by is null
        and (expires_at is null or expires_at > now())
      order by created_at limit 1
    )
    returning id into v_id;
  return v_id is not null;
end; $function$;
revoke execute on function public._consume_artist_invite_code(text, uuid) from public, anon, authenticated;

create or replace function public.admin_generate_artist_invite_code(p_note text default null, p_expires_at timestamptz default null)
returns table(code text, id uuid) language plpgsql security definer set search_path to 'public' as $function$
declare v_code text; v_id uuid;
begin
  if not _internal_is_admin_caller() then raise exception 'admin only'; end if;
  v_code := 'ART-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
  insert into public.artist_invite_codes(code, note, created_by, expires_at)
    values (v_code, p_note, auth.uid(), p_expires_at)
    returning artist_invite_codes.code, artist_invite_codes.id into v_code, v_id;
  return query select v_code, v_id;
end; $function$;
grant execute on function public.admin_generate_artist_invite_code(text, timestamptz) to authenticated;

create or replace function public.admin_list_artist_invite_codes(p_limit int default 100)
returns setof public.artist_invite_codes language sql stable security definer set search_path to 'public' as $function$
  select * from public.artist_invite_codes
  where _internal_is_admin_caller()
  order by created_at desc limit p_limit;
$function$;
grant execute on function public.admin_list_artist_invite_codes(int) to authenticated;
