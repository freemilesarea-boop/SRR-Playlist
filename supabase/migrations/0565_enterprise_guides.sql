-- 0565_enterprise_guides.sql
--
-- 엔터프라이즈 가이드 — 관리자가 계속 올리는 공개 안내 글 (푸터 '듣다 서비스' > 엔터프라이즈 가이드).
--
-- 구성
--   · enterprise_guides — 글 하나 = 제목·요약·카테고리·대표 이미지·본문(마크다운)·첨부(PDF 등)
--       공개(is_published)된 글만 사이트에 보인다. 삭제는 숨김(deleted_at)이라 되살릴 수 있다.
--   · 읽기: list_enterprise_guides / get_enterprise_guide — 누구나(비로그인 포함), 공개 글만
--   · 쓰기: admin_* — 관리자(users.role='admin')만, 바꿀 때마다 운영 로그(source='enterprise_guide')
--   · 파일: storage 'enterprise-guides' (공개 읽기, 이미지·PDF, 20MB) — 업로드·삭제는 관리자만
--   테이블은 직접 읽고 쓸 수 없고(RLS, 권한 회수) 위 함수로만 접근한다.

create table if not exists public.enterprise_guides (
  id               uuid primary key default gen_random_uuid(),
  slug             text not null,
  title            text not null,
  summary          text,
  category         text not null default '일반',
  cover_image_url  text,
  body_md          text not null default '',
  attachments      jsonb not null default '[]'::jsonb,
  is_published     boolean not null default false,
  sort_order       int not null default 100,
  published_at     timestamptz,
  created_by       uuid references public.users(id) on delete set null,
  updated_by       uuid references public.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz,
  constraint enterprise_guides_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 80),
  constraint enterprise_guides_title_len check (length(btrim(title)) between 1 and 200),
  constraint enterprise_guides_attachments_array check (jsonb_typeof(attachments) = 'array')
);

create unique index if not exists uq_enterprise_guides_slug_live
  on public.enterprise_guides(slug) where deleted_at is null;
create index if not exists ix_enterprise_guides_public
  on public.enterprise_guides(sort_order, published_at desc) where is_published and deleted_at is null;

alter table public.enterprise_guides enable row level security;
revoke all on public.enterprise_guides from anon, authenticated;

-- ---- 공개 읽기 ----
create or replace function public.list_enterprise_guides()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', g.id, 'slug', g.slug, 'title', g.title, 'summary', g.summary,
           'category', g.category, 'cover_image_url', g.cover_image_url,
           'attachment_count', jsonb_array_length(g.attachments),
           'published_at', g.published_at, 'updated_at', g.updated_at)
         order by g.sort_order, g.published_at desc nulls last, g.id), '[]'::jsonb)
    from public.enterprise_guides g
   where g.is_published and g.deleted_at is null;
$$;

create or replace function public.get_enterprise_guide(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
           'id', g.id, 'slug', g.slug, 'title', g.title, 'summary', g.summary,
           'category', g.category, 'cover_image_url', g.cover_image_url,
           'body_md', g.body_md, 'attachments', g.attachments,
           'published_at', g.published_at, 'updated_at', g.updated_at)
    from public.enterprise_guides g
   where g.slug = lower(btrim(p_slug)) and g.is_published and g.deleted_at is null;
$$;

revoke all on function public.list_enterprise_guides() from public;
revoke all on function public.get_enterprise_guide(text) from public;
grant execute on function public.list_enterprise_guides() to anon, authenticated, service_role;
grant execute on function public.get_enterprise_guide(text) to anon, authenticated, service_role;

-- ---- 관리자 ----
create or replace function public._enterprise_guide_require_admin()
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare v uuid := auth.uid();
begin
  if not exists (select 1 from public.users u where u.id = v and u.role = 'admin') then
    raise exception 'unauthorized';
  end if;
  return v;
end;
$$;
revoke all on function public._enterprise_guide_require_admin() from public, anon, authenticated;

-- 이 버킷 공개 주소만 허용 (다른 곳 링크를 대표 이미지·첨부로 넣지 못하게)
create or replace function public._enterprise_guide_file_url_ok(p_url text)
returns boolean
language sql
immutable
as $$
  select p_url is null or p_url ~ '^https://[a-z0-9.-]+/storage/v1/object/public/enterprise-guides/[^?#]+$';
$$;

create or replace function public.admin_list_enterprise_guides()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._enterprise_guide_require_admin();
  return coalesce((
    select jsonb_agg(to_jsonb(g) - 'deleted_at' order by g.sort_order, g.created_at desc, g.id)
      from public.enterprise_guides g
     where g.deleted_at is null), '[]'::jsonb);
end;
$$;

create or replace function public.admin_upsert_enterprise_guide(
  p_id              uuid,
  p_slug            text,
  p_title           text,
  p_summary         text,
  p_category        text,
  p_cover_image_url text,
  p_body_md         text,
  p_attachments     jsonb,
  p_is_published    boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := public._enterprise_guide_require_admin();
  v_slug  text := nullif(lower(btrim(coalesce(p_slug, ''))), '');
  v_title text := btrim(coalesce(p_title, ''));
  v_cat   text := coalesce(nullif(btrim(coalesce(p_category, '')), ''), '일반');
  v_att   jsonb := coalesce(p_attachments, '[]'::jsonb);
  v_old   public.enterprise_guides;
  v_row   public.enterprise_guides;
  v_a     jsonb;
begin
  if v_title = '' or length(v_title) > 200 then
    raise exception 'validation: 제목을 1~200자로 입력해 주세요';
  end if;
  if length(v_cat) > 40 then
    raise exception 'validation: 카테고리는 40자 이하';
  end if;
  if length(coalesce(p_summary, '')) > 300 then
    raise exception 'validation: 요약은 300자 이하';
  end if;
  if length(coalesce(p_body_md, '')) > 200000 then
    raise exception 'validation: 본문이 너무 깁니다 (20만 자 이하)';
  end if;
  if v_slug is not null and (v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or length(v_slug) > 80) then
    raise exception 'validation: 주소는 영문 소문자·숫자·하이픈(-)만, 80자 이하 (예: getting-started)';
  end if;
  if not public._enterprise_guide_file_url_ok(nullif(btrim(coalesce(p_cover_image_url, '')), '')) then
    raise exception 'validation: 대표 이미지는 가이드 파일 저장소에 올린 파일만 쓸 수 있다';
  end if;
  if jsonb_typeof(v_att) <> 'array' or jsonb_array_length(v_att) > 20 then
    raise exception 'validation: 첨부는 20개까지';
  end if;
  for v_a in select * from jsonb_array_elements(v_att) loop
    if jsonb_typeof(v_a) <> 'object'
       or coalesce(btrim(v_a->>'name'), '') = ''
       or not public._enterprise_guide_file_url_ok(v_a->>'url')
       or v_a->>'url' is null then
      raise exception 'validation: 첨부 파일 정보가 올바르지 않다';
    end if;
  end loop;

  if p_id is not null then
    select * into v_old from public.enterprise_guides where id = p_id and deleted_at is null for update;
    if v_old.id is null then
      raise exception 'not_found: 가이드를 찾을 수 없다';
    end if;
  end if;

  -- 주소를 비워 두면 새 글은 guide-xxxxxxxx 로, 기존 글은 지금 주소 유지
  v_slug := coalesce(v_slug, v_old.slug, 'guide-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  if exists (select 1 from public.enterprise_guides g
              where g.slug = v_slug and g.deleted_at is null and g.id is distinct from p_id) then
    raise exception 'duplicate: 이미 쓰는 주소다 — %', v_slug;
  end if;

  if v_old.id is null then
    insert into public.enterprise_guides
      (slug, title, summary, category, cover_image_url, body_md, attachments, is_published,
       sort_order, published_at, created_by, updated_by)
    values
      (v_slug, v_title, nullif(btrim(coalesce(p_summary, '')), ''), v_cat,
       nullif(btrim(coalesce(p_cover_image_url, '')), ''), coalesce(p_body_md, ''), v_att,
       coalesce(p_is_published, false),
       coalesce((select max(sort_order) + 10 from public.enterprise_guides where deleted_at is null), 100),
       case when coalesce(p_is_published, false) then now() end, v_admin, v_admin)
    returning * into v_row;
  else
    update public.enterprise_guides
       set slug = v_slug, title = v_title,
           summary = nullif(btrim(coalesce(p_summary, '')), ''), category = v_cat,
           cover_image_url = nullif(btrim(coalesce(p_cover_image_url, '')), ''),
           body_md = coalesce(p_body_md, ''), attachments = v_att,
           is_published = coalesce(p_is_published, false),
           published_at = case when coalesce(p_is_published, false) then coalesce(published_at, now()) else published_at end,
           updated_by = v_admin, updated_at = now()
     where id = v_old.id
    returning * into v_row;
  end if;

  insert into public.admin_operation_logs(source, category, level, status, message, details, user_id, related_id)
  values ('enterprise_guide',
          case when v_old.id is null then 'enterprise_guide.create' else 'enterprise_guide.update' end,
          'info', case when v_row.is_published then 'published' else 'draft' end,
          format('엔터프라이즈 가이드 %s — %s (%s)', case when v_old.id is null then '작성' else '수정' end,
                 v_row.title, case when v_row.is_published then '공개' else '비공개' end),
          jsonb_build_object('slug', v_row.slug, 'title', v_row.title, 'is_published', v_row.is_published,
                             'before', case when v_old.id is null then null
                                            else to_jsonb(v_old) - 'body_md' end),
          v_admin, v_row.id::text);

  return to_jsonb(v_row) - 'deleted_at';
end;
$$;

create or replace function public.admin_set_enterprise_guide_published(p_id uuid, p_published boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := public._enterprise_guide_require_admin();
  v_row public.enterprise_guides;
begin
  if p_published is null then
    raise exception 'validation: 공개 여부가 비었다';
  end if;
  update public.enterprise_guides
     set is_published = p_published,
         published_at = case when p_published then coalesce(published_at, now()) else published_at end,
         updated_by = v_admin, updated_at = now()
   where id = p_id and deleted_at is null
  returning * into v_row;
  if v_row.id is null then
    raise exception 'not_found: 가이드를 찾을 수 없다';
  end if;
  insert into public.admin_operation_logs(source, category, level, status, message, details, user_id, related_id)
  values ('enterprise_guide', 'enterprise_guide.publish', 'info',
          case when p_published then 'published' else 'unpublished' end,
          format('엔터프라이즈 가이드 %s — %s', case when p_published then '공개' else '비공개' end, v_row.title),
          jsonb_build_object('slug', v_row.slug, 'is_published', p_published), v_admin, v_row.id::text);
  return to_jsonb(v_row) - 'deleted_at';
end;
$$;

-- 목록 순서 — 화면에서 정한 순서대로 id 배열을 넘기면 10 간격으로 다시 매긴다
create or replace function public.admin_reorder_enterprise_guides(p_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := public._enterprise_guide_require_admin();
  v_n int;
begin
  if p_ids is null or cardinality(p_ids) = 0 then
    raise exception 'validation: 순서를 넘겨 주세요';
  end if;
  update public.enterprise_guides g
     set sort_order = o.ord * 10, updated_at = now(), updated_by = v_admin
    from unnest(p_ids) with ordinality as o(id, ord)
   where g.id = o.id and g.deleted_at is null and g.sort_order is distinct from o.ord * 10;
  get diagnostics v_n = row_count;
  insert into public.admin_operation_logs(source, category, level, status, message, details, user_id)
  values ('enterprise_guide', 'enterprise_guide.reorder', 'info', 'updated',
          format('엔터프라이즈 가이드 순서 변경 (%s개)', v_n), jsonb_build_object('ids', to_jsonb(p_ids)), v_admin);
  return jsonb_build_object('ok', true, 'updated', v_n);
end;
$$;

create or replace function public.admin_delete_enterprise_guide(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := public._enterprise_guide_require_admin();
  v_row public.enterprise_guides;
begin
  update public.enterprise_guides
     set deleted_at = now(), is_published = false, updated_by = v_admin, updated_at = now()
   where id = p_id and deleted_at is null
  returning * into v_row;
  if v_row.id is null then
    raise exception 'not_found: 가이드를 찾을 수 없다';
  end if;
  insert into public.admin_operation_logs(source, category, level, status, message, details, user_id, related_id)
  values ('enterprise_guide', 'enterprise_guide.delete', 'warning', 'deleted',
          format('엔터프라이즈 가이드 삭제(숨김) — %s', v_row.title),
          jsonb_build_object('slug', v_row.slug, 'title', v_row.title), v_admin, v_row.id::text);
  return jsonb_build_object('ok', true, 'id', v_row.id);
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'admin_list_enterprise_guides()',
    'admin_upsert_enterprise_guide(uuid, text, text, text, text, text, text, jsonb, boolean)',
    'admin_set_enterprise_guide_published(uuid, boolean)',
    'admin_reorder_enterprise_guides(uuid[])',
    'admin_delete_enterprise_guide(uuid)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
end;
$$;

-- ---- 파일 저장소 ----
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('enterprise-guides', 'enterprise-guides', true, 20971520,
        array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
                  and policyname = 'enterprise_guides_admin_insert') then
    create policy enterprise_guides_admin_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'enterprise-guides'
                  and exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin'));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
                  and policyname = 'enterprise_guides_admin_delete') then
    create policy enterprise_guides_admin_delete on storage.objects for delete to authenticated
      using (bucket_id = 'enterprise-guides'
             and exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin'));
  end if;
end;
$$;
