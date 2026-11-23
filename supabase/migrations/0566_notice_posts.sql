-- 0566_notice_posts.sql
--
-- 공지사항 게시판 — 관리자가 올리는 공개 공지 글 (/notice, 푸터 '지원 › 공지사항').
--
-- 왜
--   /notice 는 '준비 중' 문구만 있는 고정 화면이었다. 팝업 공지(site_notices)는 화면 위에 잠깐 띄우는
--   용도라 지난 공지를 모아 보는 게시판이 따로 없었다.
--
-- 구성 (0565 엔터프라이즈 가이드와 같은 방식)
--   · notice_posts — 번호(no, /notice/12)·분류(공지·업데이트·점검·이벤트)·상단 고정·제목·본문(마크다운)·첨부
--       공개 글만 사이트에 보인다. 삭제는 숨김(deleted_at).
--   · 읽기: list_notice_posts / get_notice_post(no) — 누구나, 공개 글만. 글에는 이전·다음 글이 붙는다.
--       순서: 고정 글 먼저, 그다음 게시일 최신순.
--   · 쓰기: admin_* — 관리자만, 바꿀 때마다 운영 로그(source='notice_post')
--   · 파일: storage 'notice-posts' (공개 읽기, 이미지·PDF 20MB, 업로드·삭제 관리자만)

create table if not exists public.notice_posts (
  id            uuid primary key default gen_random_uuid(),
  no            bigint generated always as identity unique,
  title         text not null,
  category      text not null default '공지',
  is_pinned     boolean not null default false,
  body_md       text not null default '',
  attachments   jsonb not null default '[]'::jsonb,
  is_published  boolean not null default false,
  published_at  timestamptz,
  created_by    uuid references public.users(id) on delete set null,
  updated_by    uuid references public.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  constraint notice_posts_title_len check (length(btrim(title)) between 1 and 200),
  constraint notice_posts_category check (category in ('공지', '업데이트', '점검', '이벤트')),
  constraint notice_posts_attachments_array check (jsonb_typeof(attachments) = 'array')
);

create index if not exists ix_notice_posts_public
  on public.notice_posts(is_pinned desc, published_at desc) where is_published and deleted_at is null;

alter table public.notice_posts enable row level security;
revoke all on public.notice_posts from anon, authenticated;

-- 마크다운 기호를 걷어낸 미리보기 글 (목록용)
create or replace function public._notice_excerpt(p_md text, p_len int default 120)
returns text
language sql
immutable
as $$
  select left(btrim(regexp_replace(
           regexp_replace(
             regexp_replace(coalesce(p_md, ''), '!\[[^\]]*\]\([^)]*\)', '', 'g'),   -- 이미지
             '\[([^\]]*)\]\([^)]*\)', '\1', 'g'),                                     -- 링크 → 글자
           '[#>*_`|~-]+|\s+', ' ', 'g')), p_len);
$$;

-- ---- 공개 읽기 ----
create or replace function public.list_notice_posts()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'no', n.no, 'title', n.title, 'category', n.category, 'is_pinned', n.is_pinned,
           'excerpt', public._notice_excerpt(n.body_md),
           'attachment_count', jsonb_array_length(n.attachments),
           'published_at', n.published_at, 'updated_at', n.updated_at)
         order by n.is_pinned desc, n.published_at desc nulls last, n.no desc), '[]'::jsonb)
    from public.notice_posts n
   where n.is_published and n.deleted_at is null;
$$;

create or replace function public.get_notice_post(p_no bigint)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with pub as (
    select n.*, row_number() over (order by n.published_at desc nulls last, n.no desc) as rn
      from public.notice_posts n
     where n.is_published and n.deleted_at is null
  ), cur as (select * from pub where no = p_no)
  select jsonb_build_object(
           'no', c.no, 'title', c.title, 'category', c.category, 'is_pinned', c.is_pinned,
           'body_md', c.body_md, 'attachments', c.attachments,
           'published_at', c.published_at, 'updated_at', c.updated_at,
           -- 이전 글 = 한 칸 오래된 글, 다음 글 = 한 칸 새 글 (고정 여부와 무관하게 게시일 기준)
           'prev', (select jsonb_build_object('no', p.no, 'title', p.title) from pub p where p.rn = c.rn + 1),
           'next', (select jsonb_build_object('no', x.no, 'title', x.title) from pub x where x.rn = c.rn - 1))
    from cur c;
$$;

revoke all on function public.list_notice_posts() from public;
revoke all on function public.get_notice_post(bigint) from public;
grant execute on function public.list_notice_posts() to anon, authenticated, service_role;
grant execute on function public.get_notice_post(bigint) to anon, authenticated, service_role;

-- ---- 관리자 ----
create or replace function public._notice_file_url_ok(p_url text)
returns boolean
language sql
immutable
as $$
  select p_url is not null and p_url ~ '^https://[a-z0-9.-]+/storage/v1/object/public/notice-posts/[^?#]+$';
$$;

create or replace function public.admin_list_notice_posts()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._enterprise_guide_require_admin();
  return coalesce((
    select jsonb_agg(to_jsonb(n) - 'deleted_at'
                     order by n.is_pinned desc, coalesce(n.published_at, n.created_at) desc, n.no desc)
      from public.notice_posts n
     where n.deleted_at is null), '[]'::jsonb);
end;
$$;

create or replace function public.admin_upsert_notice_post(
  p_id           uuid,
  p_title        text,
  p_category     text,
  p_is_pinned    boolean,
  p_body_md      text,
  p_attachments  jsonb,
  p_is_published boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := public._enterprise_guide_require_admin();
  v_title text := btrim(coalesce(p_title, ''));
  v_cat   text := coalesce(nullif(btrim(coalesce(p_category, '')), ''), '공지');
  v_att   jsonb := coalesce(p_attachments, '[]'::jsonb);
  v_old   public.notice_posts;
  v_row   public.notice_posts;
  v_a     jsonb;
begin
  if v_title = '' or length(v_title) > 200 then
    raise exception 'validation: 제목을 1~200자로 입력해 주세요';
  end if;
  if v_cat not in ('공지', '업데이트', '점검', '이벤트') then
    raise exception 'validation: 분류는 공지·업데이트·점검·이벤트 중 하나';
  end if;
  if length(coalesce(p_body_md, '')) > 200000 then
    raise exception 'validation: 본문이 너무 깁니다 (20만 자 이하)';
  end if;
  if jsonb_typeof(v_att) <> 'array' or jsonb_array_length(v_att) > 20 then
    raise exception 'validation: 첨부는 20개까지';
  end if;
  for v_a in select * from jsonb_array_elements(v_att) loop
    if jsonb_typeof(v_a) <> 'object'
       or coalesce(btrim(v_a->>'name'), '') = ''
       or not public._notice_file_url_ok(v_a->>'url') then
      raise exception 'validation: 첨부 파일 정보가 올바르지 않다';
    end if;
  end loop;

  if p_id is not null then
    select * into v_old from public.notice_posts where id = p_id and deleted_at is null for update;
    if v_old.id is null then
      raise exception 'not_found: 공지를 찾을 수 없다';
    end if;
  end if;

  if v_old.id is null then
    insert into public.notice_posts
      (title, category, is_pinned, body_md, attachments, is_published, published_at, created_by, updated_by)
    values
      (v_title, v_cat, coalesce(p_is_pinned, false), coalesce(p_body_md, ''), v_att,
       coalesce(p_is_published, false), case when coalesce(p_is_published, false) then now() end, v_admin, v_admin)
    returning * into v_row;
  else
    update public.notice_posts
       set title = v_title, category = v_cat, is_pinned = coalesce(p_is_pinned, false),
           body_md = coalesce(p_body_md, ''), attachments = v_att,
           is_published = coalesce(p_is_published, false),
           published_at = case when coalesce(p_is_published, false) then coalesce(published_at, now()) else published_at end,
           updated_by = v_admin, updated_at = now()
     where id = v_old.id
    returning * into v_row;
  end if;

  insert into public.admin_operation_logs(source, category, level, status, message, details, user_id, related_id)
  values ('notice_post',
          case when v_old.id is null then 'notice_post.create' else 'notice_post.update' end,
          'info', case when v_row.is_published then 'published' else 'draft' end,
          format('공지사항 %s — [%s] %s (%s)', case when v_old.id is null then '작성' else '수정' end,
                 v_row.category, v_row.title, case when v_row.is_published then '공개' else '비공개' end),
          jsonb_build_object('no', v_row.no, 'title', v_row.title, 'is_published', v_row.is_published,
                             'before', case when v_old.id is null then null else to_jsonb(v_old) - 'body_md' end),
          v_admin, v_row.id::text);

  return to_jsonb(v_row) - 'deleted_at';
end;
$$;

create or replace function public.admin_set_notice_post_flags(p_id uuid, p_is_published boolean, p_is_pinned boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := public._enterprise_guide_require_admin();
  v_old public.notice_posts;
  v_row public.notice_posts;
begin
  select * into v_old from public.notice_posts where id = p_id and deleted_at is null for update;
  if v_old.id is null then
    raise exception 'not_found: 공지를 찾을 수 없다';
  end if;
  update public.notice_posts
     set is_published = coalesce(p_is_published, is_published),
         is_pinned = coalesce(p_is_pinned, is_pinned),
         published_at = case when coalesce(p_is_published, is_published) then coalesce(published_at, now()) else published_at end,
         updated_by = v_admin, updated_at = now()
   where id = p_id
  returning * into v_row;
  insert into public.admin_operation_logs(source, category, level, status, message, details, user_id, related_id)
  values ('notice_post', 'notice_post.flags', 'info', 'updated',
          format('공지사항 %s%s — %s',
                 case when v_row.is_published is distinct from v_old.is_published
                      then case when v_row.is_published then '공개 ' else '비공개 ' end else '' end,
                 case when v_row.is_pinned is distinct from v_old.is_pinned
                      then case when v_row.is_pinned then '상단 고정' else '고정 해제' end else '' end,
                 v_row.title),
          jsonb_build_object('no', v_row.no, 'is_published', v_row.is_published, 'is_pinned', v_row.is_pinned),
          v_admin, v_row.id::text);
  return to_jsonb(v_row) - 'deleted_at';
end;
$$;

create or replace function public.admin_delete_notice_post(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := public._enterprise_guide_require_admin();
  v_row public.notice_posts;
begin
  update public.notice_posts
     set deleted_at = now(), is_published = false, updated_by = v_admin, updated_at = now()
   where id = p_id and deleted_at is null
  returning * into v_row;
  if v_row.id is null then
    raise exception 'not_found: 공지를 찾을 수 없다';
  end if;
  insert into public.admin_operation_logs(source, category, level, status, message, details, user_id, related_id)
  values ('notice_post', 'notice_post.delete', 'warning', 'deleted',
          format('공지사항 삭제(숨김) — %s', v_row.title),
          jsonb_build_object('no', v_row.no, 'title', v_row.title), v_admin, v_row.id::text);
  return jsonb_build_object('ok', true, 'id', v_row.id);
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'admin_list_notice_posts()',
    'admin_upsert_notice_post(uuid, text, text, boolean, text, jsonb, boolean)',
    'admin_set_notice_post_flags(uuid, boolean, boolean)',
    'admin_delete_notice_post(uuid)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
end;
$$;

-- ---- 파일 저장소 ----
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('notice-posts', 'notice-posts', true, 20971520,
        array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
                  and policyname = 'notice_posts_admin_insert') then
    create policy notice_posts_admin_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'notice-posts'
                  and exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin'));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
                  and policyname = 'notice_posts_admin_delete') then
    create policy notice_posts_admin_delete on storage.objects for delete to authenticated
      using (bucket_id = 'notice-posts'
             and exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin'));
  end if;
end;
$$;
