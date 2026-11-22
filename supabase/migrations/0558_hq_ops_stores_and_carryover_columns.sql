-- 0558_hq_ops_stores_and_carryover_columns.sql
--
-- 0557 이후에도 실패하던 본사 화면 3곳 마무리.
--
-- 왜
--   · get_my_enterprise_ops_stores (본사 매장 목록) — users 에 없는 u.email 을 읽어
--     매번 "column u.email does not exist" 로 실패했다. 이메일은 auth.users 에 있다.
--   · get_my_enterprise_intel_monthly_report (월간 리포트) · run_my_enterprise_incident_scan
--     (장애 스캔) — enterprise_monthly_settlements.previous_carryover 를 읽는데, 이 이월 컬럼들을
--     만드는 0400 이 운영 DB 에 적용되지 않아 컬럼이 없다.
--
-- 바뀌는 것
--   · ops_stores 의 u.email → auth.users 에서 조회 (함수 본문은 그대로, 문구만 교체)
--   · 0400 과 같은 정의로 이월 컬럼 4개를 추가 (기본값 0/false — 기존 정산 금액·흐름 무변경)

alter table public.enterprise_monthly_settlements
  add column if not exists previous_carryover             int not null default 0
    check (previous_carryover >= 0),
  add column if not exists carryover_amount               int not null default 0
    check (carryover_amount >= 0),
  add column if not exists carryover_source_settlement_id uuid
    references public.enterprise_monthly_settlements(id) on delete set null,
  add column if not exists carryover_applied              boolean not null default false;

do $$
declare
  v_def text;
  v_old text := 'u.email as store_email';
  v_new text := '(select au.email::text from auth.users au where au.id = u.id) as store_email';
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'get_my_enterprise_ops_stores';
  if v_def is null then
    raise exception '0558: get_my_enterprise_ops_stores not found';
  end if;
  if position(v_old in v_def) = 0 then
    if position(v_new in v_def) > 0 then
      return; -- 이미 적용됨
    end if;
    raise exception '0558: get_my_enterprise_ops_stores 에서 바꿀 문구를 찾지 못했다: %', v_old;
  end if;
  execute replace(v_def, v_old, v_new);
end;
$$;

-- ops_stores 정렬절이 select 별칭(store_name)을 case 식 안에서 참조해
-- "column store_name does not exist" 로 실패했다 — 식을 직접 쓴다.
-- (이 목록은 total·offset 페이지 이동이 있어 매장 전부를 볼 수 있다.)
do $$
declare
  v_def text;
  v_old text := 'case when p_sort = ''name'' then store_name end';
  v_new text := 'case when p_sort = ''name'' then coalesce(public._announcement_store_label(u.id, null), u.nickname, ''(매장명 없음)'') end';
begin
  select pg_get_functiondef('public.get_my_enterprise_ops_stores'::regproc) into v_def;
  if position(v_old in v_def) = 0 then
    if position(v_new in v_def) > 0 then
      return;
    end if;
    raise exception '0558: ops_stores 정렬 문구를 찾지 못했다';
  end if;
  execute replace(v_def, v_old, v_new);
end;
$$;
