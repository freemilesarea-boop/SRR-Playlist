-- 브랜드 자산(로고) 운영자 업로드 시스템.
-- 운영자가 SVG/PNG 파일 첨부로 로고 교체 가능. URL 없을 때는 프론트가 LogoMark SVG 폴백 렌더.
-- additive: 신규 테이블 + 신규 RPC + 신규 storage bucket. 기존 데이터/스키마/RPC 무영향.

-- 1) 싱글톤 brand_settings 테이블
create table if not exists public.brand_settings (
  id int primary key default 1 check (id = 1),
  logo_url text,                  -- 옵션. null/빈문자열이면 클라이언트가 SVG 폴백
  updated_at timestamptz not null default now(),
  updated_by uuid references public.users(id) on delete set null
);
insert into public.brand_settings(id) values (1) on conflict (id) do nothing;

alter table public.brand_settings enable row level security;
drop policy if exists brand_settings_read on public.brand_settings;
create policy brand_settings_read on public.brand_settings for select using (true);
-- 직접 update 는 RLS 로 막고 admin RPC 만 통과 (SECURITY DEFINER)
drop policy if exists brand_settings_no_direct_write on public.brand_settings;
create policy brand_settings_no_direct_write on public.brand_settings for update using (false) with check (false);

-- 2) 조회 RPC (anon 가능 — 로그인 전에도 로고 보여야)
create or replace function public.get_brand_settings()
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object('logo_url', logo_url, 'updated_at', updated_at)
  from public.brand_settings where id = 1;
$$;
grant execute on function public.get_brand_settings() to anon, authenticated;

-- 3) 관리자 업데이트 RPC — URL 만 받음 (스토리지 업로드는 클라이언트가 처리)
create or replace function public.admin_update_brand_logo(p_logo_url text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid();
begin
  if not exists (select 1 from public.users u where u.id = v_uid and u.role = 'admin') then
    raise exception 'admin only';
  end if;
  update public.brand_settings
    set logo_url = nullif(btrim(coalesce(p_logo_url, '')), ''),
        updated_at = now(),
        updated_by = v_uid
    where id = 1;
  return public.get_brand_settings();
end; $$;
grant execute on function public.admin_update_brand_logo(text) to authenticated;

-- 4) Storage 버킷 — public read, admin write
insert into storage.buckets (id, name, public)
  values ('brand-assets', 'brand-assets', true)
  on conflict (id) do nothing;

-- 버킷 정책: 모든 사용자 read, admin 만 write (insert/update/delete)
drop policy if exists "brand-assets read" on storage.objects;
create policy "brand-assets read" on storage.objects for select
  using (bucket_id = 'brand-assets');

drop policy if exists "brand-assets admin write" on storage.objects;
create policy "brand-assets admin write" on storage.objects for insert
  with check (
    bucket_id = 'brand-assets'
    and exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin')
  );

drop policy if exists "brand-assets admin update" on storage.objects;
create policy "brand-assets admin update" on storage.objects for update
  using (
    bucket_id = 'brand-assets'
    and exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin')
  );

drop policy if exists "brand-assets admin delete" on storage.objects;
create policy "brand-assets admin delete" on storage.objects for delete
  using (
    bucket_id = 'brand-assets'
    and exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin')
  );
