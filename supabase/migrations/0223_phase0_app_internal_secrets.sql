-- 0223 — Phase 0 AI QC: worker-to-worker 시크릿 저장소
--
-- 목적: Supabase pg_net 트리거가 Modal 워커 호출 시 body._auth 로 검증할 secret 보관.
-- 접근: SECURITY DEFINER 함수만 read (RLS 정책 무 → 일반 select 차단).
--
-- 사용 예:
--   select public.admin_set_worker_secret('qc_worker_secret', 'random_hex_32');
--   select public.admin_list_worker_secret_keys();  -- key 만 노출, value 는 X

create table if not exists public.app_internal_secrets (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.users(id)
);

alter table public.app_internal_secrets enable row level security;
-- 정책 없음 → service_role 외엔 직접 SELECT 불가.
-- SECURITY DEFINER 함수만 row 접근 (enqueue_track_qc 등이 secret 읽음).

create or replace function public.admin_set_worker_secret(p_key text, p_value text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin') then
    raise exception 'unauthorized';
  end if;
  if p_key is null or length(btrim(p_key)) = 0 then raise exception 'key required'; end if;
  if p_value is null or length(btrim(p_value)) = 0 then raise exception 'value required'; end if;
  insert into public.app_internal_secrets(key, value, updated_by)
    values (p_key, p_value, auth.uid())
  on conflict (key) do update set
    value = excluded.value, updated_at = now(), updated_by = auth.uid();
end;
$$;
revoke all on function public.admin_set_worker_secret(text, text) from public, anon;
grant execute on function public.admin_set_worker_secret(text, text) to authenticated, service_role;

create or replace function public.admin_list_worker_secret_keys()
returns table (key text, has_value boolean, updated_at timestamptz)
language sql
security definer
set search_path = public
stable
as $$
  select s.key, true as has_value, s.updated_at
  from public.app_internal_secrets s
  where exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin')
  order by s.key;
$$;
revoke all on function public.admin_list_worker_secret_keys() from public, anon;
grant execute on function public.admin_list_worker_secret_keys() to authenticated, service_role;
