-- 0204 — 영업 파트너 모집 지원 (additive). 외부 지원자(비로그인) 제출 + 관리자 검토.
--   insert 는 SECURITY DEFINER RPC(anon/authenticated)로만(서버 검증). select/update 는 admin 전용(RLS).
--   ⚠ 자동 sales_agent 코드 발급 없음(1차) — approved 후 관리자가 별도 발급. 구조만 연결 가능하게.

create table if not exists public.sales_partner_applications (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text not null,
  email text not null,
  region text not null,
  target_business_types text[] not null default '{}',
  has_sales_experience boolean,
  expected_store_count integer,
  motivation text,
  company_name text,
  network_description text,
  message text,
  status text not null default 'submitted',   -- submitted|reviewing|approved|rejected|contacted
  created_at timestamptz not null default now(),
  reviewed_by uuid,
  reviewed_at timestamptz,
  admin_note text
);
create index if not exists idx_spa_status on public.sales_partner_applications(status, created_at desc);
alter table public.sales_partner_applications enable row level security;
-- 조회/수정/삭제는 admin 만. insert 정책은 두지 않음(아래 definer RPC 로만 제출).
drop policy if exists spa_admin_all on public.sales_partner_applications;
create policy spa_admin_all on public.sales_partner_applications for all
  using (exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin'))
  with check (exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin'));

-- 제출 RPC (비로그인 포함). 서버 검증 후 insert. definer 라 RLS 우회.
create or replace function public.submit_sales_partner_application(
  p_name text, p_phone text, p_email text, p_region text,
  p_target_business_types text[], p_has_sales_experience boolean, p_expected_store_count integer,
  p_motivation text, p_company_name text default null, p_network_description text default null, p_message text default null
) returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_id uuid;
begin
  if coalesce(btrim(p_name),'')='' or coalesce(btrim(p_phone),'')='' or coalesce(btrim(p_email),'')=''
     or coalesce(btrim(p_region),'')='' or coalesce(array_length(p_target_business_types,1),0)=0
     or coalesce(btrim(p_motivation),'')='' then
    raise exception '필수 항목을 모두 입력해주세요';
  end if;
  if position('@' in p_email) = 0 then raise exception '이메일 형식을 확인해주세요'; end if;
  insert into public.sales_partner_applications(
    name, phone, email, region, target_business_types, has_sales_experience, expected_store_count,
    motivation, company_name, network_description, message)
  values (
    btrim(p_name), btrim(p_phone), btrim(p_email), btrim(p_region),
    p_target_business_types, p_has_sales_experience, p_expected_store_count,
    btrim(p_motivation), nullif(btrim(coalesce(p_company_name,'')),''),
    nullif(btrim(coalesce(p_network_description,'')),''), nullif(btrim(coalesce(p_message,'')),''))
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end; $$;
grant execute on function public.submit_sales_partner_application(text, text, text, text, text[], boolean, integer, text, text, text, text) to anon, authenticated;

create or replace function public.admin_list_sales_partner_applications(p_status text default null, p_limit int default 200)
returns setof public.sales_partner_applications language sql stable security definer set search_path to 'public' as $$
  select * from public.sales_partner_applications
  where exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin')
    and (p_status is null or status = p_status)
  order by created_at desc
  limit greatest(1, p_limit);
$$;
grant execute on function public.admin_list_sales_partner_applications(text, int) to authenticated;

create or replace function public.admin_update_sales_partner_application(p_id uuid, p_status text default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid();
begin
  if not exists (select 1 from public.users u where u.id=v_uid and u.role='admin') then raise exception 'admin only'; end if;
  if p_status is not null and p_status not in ('submitted','reviewing','approved','rejected','contacted') then
    raise exception 'invalid status';
  end if;
  update public.sales_partner_applications set
    status = coalesce(p_status, status),
    admin_note = coalesce(p_note, admin_note),
    reviewed_by = v_uid, reviewed_at = now()
  where id = p_id;
  if not found then raise exception 'application not found'; end if;
  return jsonb_build_object('ok', true, 'id', p_id);
end; $$;
grant execute on function public.admin_update_sales_partner_application(uuid, text, text) to authenticated;
