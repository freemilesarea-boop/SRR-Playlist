-- 0463 — Phase WEB-OPS-10: Unified Operations Platform (Final)
--
-- 목적:
--   WEB-OBS 전 Phase의 운영 Dashboard를 하나의 Command Center로 수렴한다. 이번 Phase는 새로운 Player/
--   Streaming 기능을 추가하지 않는다. 여기서는 (1) 운영자별 Dashboard 레이아웃/환경설정 저장,
--   (2) 거버넌스 의사결정 텍스트 통합 검색 RPC 만 추가한다. 나머지(Platform Score/Executive/SLA/
--   Timeline)는 기존 super-admin RPC 위에서 클라이언트 engine(src/lib/platform)이 조합한다.
--
-- 안전 (절대):
--   • Additive Only. 신규 테이블 2 + 신규 RPC 5. 기존 테이블/RPC/뷰/RLS/데이터/텔레메트리 의미 무변경.
--     기존 Dashboard/RPC 제거·의미변경 없음. 운영 데이터(Player/Queue/Playback/Streaming/Governance) READ-only.
--   • Production Apply 금지. Preview / rollback-txn 검증 전용.
--   • 어떤 RPC 도 릴리스/롤백/Release 차단/원격 Player 제어를 실행하지 않는다 — UI 상태 저장 + 조회 전용.
--   • Security Definer + auth.uid() 소유 스코프 + _is_super_admin() 게이트 + search_path 고정 + 파라미터 바인딩.

-- ─────────────────────────────────────────────────────────────────────
-- 1) 운영자별 workspace / preferences (UI 상태 — 운영 데이터와 분리)
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.operations_workspace (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null,                       -- auth.uid() 소유자
  name       text not null default 'Default',
  layout     jsonb not null default '{}'::jsonb,  -- widgets: type/size/position/collapsed/favorite
  is_default boolean not null default false,
  updated_at timestamptz not null default now()
);
comment on table public.operations_workspace is
  'WEB-OPS-10 운영자별 Command Center 레이아웃(UI 상태). 운영 데이터 아님. 소유자(auth.uid())만 접근.';
create index if not exists opsw_user_idx on public.operations_workspace (user_id, updated_at desc);

create table if not exists public.operations_preferences (
  user_id         uuid primary key,               -- auth.uid()
  default_window  text not null default '24h',
  default_filters jsonb not null default '{}'::jsonb,
  updated_at      timestamptz not null default now()
);
comment on table public.operations_preferences is 'WEB-OPS-10 운영자별 기본 필터/기간(UI 상태). 소유자만 접근.';

-- RLS: 소유자(auth.uid())만 select; 쓰기는 아래 security-definer RPC 로만.
alter table public.operations_workspace enable row level security;
alter table public.operations_workspace force row level security;
drop policy if exists opsw_owner_read on public.operations_workspace;
create policy opsw_owner_read on public.operations_workspace for select using (user_id = auth.uid());
revoke insert, update, delete on public.operations_workspace from authenticated, anon;

alter table public.operations_preferences enable row level security;
alter table public.operations_preferences force row level security;
drop policy if exists opsp_owner_read on public.operations_preferences;
create policy opsp_owner_read on public.operations_preferences for select using (user_id = auth.uid());
revoke insert, update, delete on public.operations_preferences from authenticated, anon;

-- ─────────────────────────────────────────────────────────────────────
-- 2) Workspace RPCs (소유자 스코프 · super-admin 게이트 · UI 상태만 저장)
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.upsert_operations_workspace(
  p_name text, p_layout jsonb, p_is_default boolean default false, p_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_uid uuid := auth.uid(); v_id uuid;
begin
  if v_uid is null then raise exception 'unauthorized'; end if;
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  if p_is_default then
    update public.operations_workspace set is_default = false where user_id = v_uid;
  end if;
  if p_id is not null and exists (select 1 from public.operations_workspace where id = p_id and user_id = v_uid) then
    update public.operations_workspace set name = left(coalesce(p_name,'Default'),60),
      layout = coalesce(p_layout,'{}'::jsonb), is_default = coalesce(p_is_default,false), updated_at = now()
      where id = p_id and user_id = v_uid returning id into v_id;
  else
    insert into public.operations_workspace (user_id, name, layout, is_default)
      values (v_uid, left(coalesce(p_name,'Default'),60), coalesce(p_layout,'{}'::jsonb), coalesce(p_is_default,false))
      returning id into v_id;
  end if;
  return jsonb_build_object('ok', true, 'id', v_id);
end; $$;
revoke execute on function public.upsert_operations_workspace(text,jsonb,boolean,uuid) from public;
do $$ begin begin grant execute on function public.upsert_operations_workspace(text,jsonb,boolean,uuid) to authenticated; exception when undefined_object then null; end; end $$;

create or replace function public.delete_operations_workspace(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_n int;
begin
  if v_uid is null then raise exception 'unauthorized'; end if;
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  delete from public.operations_workspace where id = p_id and user_id = v_uid;
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'deleted', v_n);
end; $$;
revoke execute on function public.delete_operations_workspace(uuid) from public;
do $$ begin begin grant execute on function public.delete_operations_workspace(uuid) to authenticated; exception when undefined_object then null; end; end $$;

create or replace function public.upsert_operations_preferences(p_window text, p_filters jsonb default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'unauthorized'; end if;
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  insert into public.operations_preferences (user_id, default_window, default_filters, updated_at)
    values (v_uid, coalesce(nullif(p_window,''),'24h'), coalesce(p_filters,'{}'::jsonb), now())
    on conflict (user_id) do update set default_window = excluded.default_window, default_filters = excluded.default_filters, updated_at = now();
  return jsonb_build_object('ok', true);
end; $$;
revoke execute on function public.upsert_operations_preferences(text,jsonb) from public;
do $$ begin begin grant execute on function public.upsert_operations_preferences(text,jsonb) to authenticated; exception when undefined_object then null; end; end $$;

create or replace function public.get_operations_workspace()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v jsonb;
begin
  if v_uid is null then raise exception 'unauthorized'; end if;
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  select jsonb_build_object('ok', true,
    'workspaces', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'layout', layout,
      'isDefault', is_default, 'updatedAt', to_char(updated_at,'YYYY-MM-DD"T"HH24:MI:SS"Z"')) order by updated_at desc)
      from public.operations_workspace where user_id = v_uid), '[]'::jsonb),
    'preferences', (select jsonb_build_object('defaultWindow', default_window, 'defaultFilters', default_filters)
      from public.operations_preferences where user_id = v_uid)
  ) into v; return v;
end; $$;
revoke execute on function public.get_operations_workspace() from public;
do $$ begin begin grant execute on function public.get_operations_workspace() to authenticated; exception when undefined_object then null; end; end $$;

-- ─────────────────────────────────────────────────────────────────────
-- 3) Unified search (거버넌스 의사결정 텍스트 검색 — super-admin, READ only)
--    operations_decisions(0462) 를 참조. 나머지 엔티티(store/release/incident)는 클라이언트에서 검색.
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_operations_search(p_query text, p_limit int default 50)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb; v_q text := lower(btrim(coalesce(p_query,''))); v_limit int := least(greatest(coalesce(p_limit,50),1),100);
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  if length(v_q) < 2 then return jsonb_build_object('ok', true, 'results', '[]'::jsonb); end if;
  select jsonb_build_object('ok', true, 'results', coalesce((
    select jsonb_agg(jsonb_build_object('kind', 'decision', 'id', id, 'label', title,
      'detail', kind || ' · ' || recommendation || ' · ' || status) order by created_at desc)
    from (
      select * from public.operations_decisions
      where lower(title) like '%'||v_q||'%' or lower(scope) like '%'||v_q||'%' or lower(recommendation) like '%'||v_q||'%'
      order by created_at desc limit v_limit
    ) d), '[]'::jsonb)) into v;
  return v;
end; $$;
revoke execute on function public.admin_operations_search(text,int) from public;
do $$ begin begin grant execute on function public.admin_operations_search(text,int) to authenticated; exception when undefined_object then null; end; end $$;

-- ─────────────────────────────────────────────────────────────────────
-- ROLLBACK (참고용 — Preview/rollback-txn 검증 전용. Production apply 금지):
--   drop function if exists public.admin_operations_search(text,int);
--   drop function if exists public.get_operations_workspace();
--   drop function if exists public.upsert_operations_preferences(text,jsonb);
--   drop function if exists public.delete_operations_workspace(uuid);
--   drop function if exists public.upsert_operations_workspace(text,jsonb,boolean,uuid);
--   drop table if exists public.operations_preferences;
--   drop table if exists public.operations_workspace;
-- 신규(0463) 테이블 2 + 함수 5. 롤백은 순수 DROP. 기존 데이터/스키마/RLS/운영 데이터/텔레메트리 영향 없음.
-- 어떤 RPC 도 릴리스/롤백/Player/운영 데이터를 변경하지 않음 — UI 상태 저장 + 검색 조회 전용.
