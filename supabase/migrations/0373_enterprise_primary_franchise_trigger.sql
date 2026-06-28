-- 0373 — Phase 1-11 hotfix: enterprise_accounts → primary franchise 자동 보장
--
-- 원인 (분석 보고):
--   - admin_create_enterprise_account (v1, 0351) 는 franchise 인자 자체 없음
--   - admin_create_enterprise_account_v2 (v2, 0363) 는 p_franchise_name 빈 값이면 skip
--   - 결과: primary 0개 본사가 생성될 수 있음 → claim_enterprise_store_account /
--           admin_generate_enterprise_monthly_settlement 모두 'primary franchise not configured' 실패
--
-- 해결 (Q1=A, Q2=A, Q3=A, Q5=B):
--   - DB-level AFTER INSERT trigger 하나로 모든 경로 보장
--   - 기존 RPC 본문/시그니처 무변경 (single source of truth = trigger)
--   - 같은 enterprise_name 의 active franchise 재사용 (중복 방지)
--   - slug = brand_code 의 lower+alphanum (없으면 NULL)
--   - 기존 primary 없는 본사 idempotent 복구
--
-- 절대 원칙:
--   - 기존 RPC 시그니처/본문 변경 0
--   - claim / monthly settlement / store / player / heartbeat / artist 무관
--   - soft-delete 본사 (deleted_at <> null) 는 trigger/복구 모두 skip
--   - v2 RPC 의 명시적 franchise 생성과 race-safe (on conflict do nothing)

-- ============================================================
-- 1) _ensure_primary_franchise — AFTER INSERT 함수
-- ============================================================
create or replace function public._ensure_primary_franchise()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_franchise_id uuid;
  v_slug text;
begin
  -- soft-deleted 본사는 무시 (정상 INSERT 시 deleted_at 은 null 이므로 99% 무관, 방어층)
  if NEW.deleted_at is not null then return NEW; end if;

  -- 이미 primary 있으면 no-op (v2 RPC 가 같은 트랜잭션에서 INSERT 한 경우 대비)
  if exists (
    select 1 from public.enterprise_franchises
     where enterprise_account_id = NEW.id
       and role = 'primary'
       and deleted_at is null
  ) then
    return NEW;
  end if;

  -- 같은 enterprise_name 의 active franchise 재사용 (Q3=A)
  select id into v_franchise_id
    from public.franchises
   where name = NEW.enterprise_name
     and status = 'active'
   limit 1;

  if v_franchise_id is null then
    -- 신규 franchise 생성
    -- slug (Q2=A): brand_code 가 있으면 소문자+alphanum 정리값, 없으면 NULL
    v_slug := nullif(
      lower(regexp_replace(coalesce(NEW.brand_code, ''), '[^a-zA-Z0-9]', '', 'g')),
      ''
    );

    insert into public.franchises (name, slug, status, created_by)
    values (NEW.enterprise_name, v_slug, 'active', NEW.created_by)
    returning id into v_franchise_id;
  end if;

  insert into public.enterprise_franchises
    (enterprise_account_id, franchise_id, role, status)
  values
    (NEW.id, v_franchise_id, 'primary', 'active')
  on conflict do nothing;  -- v2 RPC race-safe (enterprise_franchises_pair_unique)

  return NEW;
end;
$$;

comment on function public._ensure_primary_franchise() is
  'Phase 1-11 hotfix (0373) — enterprise_accounts INSERT 시 primary franchise 자동 보장.';


-- ============================================================
-- 2) Trigger 등록
-- ============================================================
drop trigger if exists trg_ea_ensure_primary_franchise on public.enterprise_accounts;
create trigger trg_ea_ensure_primary_franchise
  after insert on public.enterprise_accounts
  for each row execute function public._ensure_primary_franchise();


-- ============================================================
-- 3) 기존 데이터 복구 — primary 없는 active/invited 본사 자동 매핑
--    idempotent — 이미 있는 본사는 skip
-- ============================================================
do $$
declare
  v_ea record;
  v_franchise_id uuid;
  v_slug text;
  v_recovered int := 0;
  v_reused int := 0;
  v_created_franchise int := 0;
begin
  for v_ea in
    select ea.*
      from public.enterprise_accounts ea
     where ea.deleted_at is null
       and ea.status in ('active', 'invited')
       and not exists (
         select 1 from public.enterprise_franchises ef
          where ef.enterprise_account_id = ea.id
            and ef.role = 'primary'
            and ef.deleted_at is null
       )
  loop
    -- 같은 이름의 active franchise 재사용
    select id into v_franchise_id
      from public.franchises
     where name = v_ea.enterprise_name
       and status = 'active'
     limit 1;

    if v_franchise_id is not null then
      v_reused := v_reused + 1;
    else
      v_slug := nullif(
        lower(regexp_replace(coalesce(v_ea.brand_code, ''), '[^a-zA-Z0-9]', '', 'g')),
        ''
      );
      insert into public.franchises (name, slug, status, created_by)
      values (v_ea.enterprise_name, v_slug, 'active', v_ea.created_by)
      returning id into v_franchise_id;
      v_created_franchise := v_created_franchise + 1;
    end if;

    insert into public.enterprise_franchises
      (enterprise_account_id, franchise_id, role, status)
    values
      (v_ea.id, v_franchise_id, 'primary', 'active')
    on conflict do nothing;

    v_recovered := v_recovered + 1;
    raise notice '  recovered: % (franchise=%, slug=%)',
      v_ea.enterprise_name, v_franchise_id, v_slug;
  end loop;

  raise notice '====== 0373 Recovery ======';
  raise notice 'recovered enterprises: %', v_recovered;
  raise notice '  franchises reused : %', v_reused;
  raise notice '  franchises created: %', v_created_franchise;
  raise notice '===========================';
end$$;


-- ============================================================
-- 4) Diagnostics
-- ============================================================
do $$
declare
  v_fn int;
  v_trigger int;
  v_missing_primary int;
begin
  select count(*) into v_fn from pg_proc
    where proname = '_ensure_primary_franchise' and pronamespace = 'public'::regnamespace;
  select count(*) into v_trigger from pg_trigger
    where tgname = 'trg_ea_ensure_primary_franchise' and tgrelid = 'public.enterprise_accounts'::regclass;
  select count(*) into v_missing_primary
    from public.enterprise_accounts ea
   where ea.deleted_at is null
     and ea.status in ('active','invited')
     and not exists (
       select 1 from public.enterprise_franchises ef
        where ef.enterprise_account_id = ea.id
          and ef.role = 'primary'
          and ef.deleted_at is null
     );

  raise notice '====== 0373 Diagnostics ======';
  raise notice '_ensure_primary_franchise function: % / 1', v_fn;
  raise notice 'trg_ea_ensure_primary_franchise trigger: % / 1', v_trigger;
  raise notice 'enterprises still missing primary: %', v_missing_primary;
  raise notice '==============================';

  if v_fn = 1 and v_trigger = 1 and v_missing_primary = 0 then
    raise notice '0373 COMPLETE — primary franchise auto-ensure ready';
  else
    raise warning '0373 INCOMPLETE — 위 카운트 확인';
  end if;
end$$;
