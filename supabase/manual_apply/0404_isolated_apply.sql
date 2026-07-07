-- ============================================================================
-- 0404 ISOLATED APPLY — Playback Guardrail Enforcement (Production SQL Editor용)
-- ============================================================================
-- 목적: 리포지토리 0404_hotfix_playback_guardrail_enforcement.sql 을
--       0395~0403 과 무관하게 "단독(isolated)" 으로 Production 에 적용.
--
-- 안전 계약 (반드시 준수):
--   - 기존 get_playlist_tracks(uuid) : 절대 무변경 (본 스크립트는 두-인자 시그니처만 생성)
--   - 신규 get_playlist_tracks(uuid, uuid) 오버로드만 생성
--   - 데이터 변경 0 · 테이블(DDL) 변경 0 · 함수 생성 외 작업 0
--   - schema_migrations 기록 안 함 (0395~0403 미적용 상태의 계통을 건드리지 않기 위함)
--
-- 실행 방식: 전체를 Supabase SQL Editor 에 그대로 붙여넣고 1회 실행.
--            prerequisite 미충족 시 트랜잭션이 즉시 중단(EXCEPTION)되어 아무것도 생성되지 않음.
-- ============================================================================

begin;

-- ── STEP 0: PREREQUISITE CHECK (fail-fast) ──────────────────────────────────
-- 하나라도 누락 시 EXCEPTION → 트랜잭션 rollback → 함수 미생성. (실행 전 중단)
do $guard$
declare
  v_missing text := '';
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'get_playlist_tracks'
      and pg_get_function_identity_arguments(p.oid) = 'p_playlist_id uuid'
  ) then v_missing := v_missing || 'get_playlist_tracks(uuid) [기존/0274]; '; end if;

  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = '_ai_check_store_guardrails'
      and pg_get_function_identity_arguments(p.oid) = 'p_track_id uuid, p_store_key text'
  ) then v_missing := v_missing || '_ai_check_store_guardrails(uuid,text) [0173b]; '; end if;

  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'normalize_store_label'
      and pg_get_function_identity_arguments(p.oid) = 'p_label text'
  ) then v_missing := v_missing || 'normalize_store_label(text); '; end if;

  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = '_playlist_store_key'
      and pg_get_function_identity_arguments(p.oid) = 'p_playlist_id uuid'
  ) then v_missing := v_missing || '_playlist_store_key(uuid); '; end if;

  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = '_business_track_excluded'
      and pg_get_function_identity_arguments(p.oid) = 'p_track_id uuid, p_store_key text'
  ) then v_missing := v_missing || '_business_track_excluded(uuid,text); '; end if;

  if length(v_missing) > 0 then
    raise exception '0404 PREREQUISITE FAILED — 누락 함수: %  (0173/0274 계열 미적용 의심. 적용 중단)', v_missing;
  end if;

  raise notice '0404 PREREQUISITE OK — 전제 함수 5종 모두 존재. 신규 오버로드 생성 진행.';
end
$guard$;

-- ── STEP 1: 신규 오버로드 생성 (기존 uuid 버전 무변경) ───────────────────────
-- 두-인자 시그니처이므로 (uuid) 단일-인자 함수에는 영향 없음.
create or replace function public.get_playlist_tracks(
  p_playlist_id uuid,
  p_store_id uuid
)
returns jsonb
language plpgsql stable security definer set search_path = public
as $fn$
declare
  v jsonb;
  v_sk text;               -- 기존 playlist store_key (release/exclusion 층)
  v_store_key text;        -- 매장 store_key (guardrail 판정용)
  v_business_category text;
begin
  -- 1) 기존 playlist store_key (0274 재사용)
  v_sk := public._playlist_store_key(p_playlist_id);

  -- 2) 매장 컨텍스트: business_category → normalize_store_label → guardrail store_key
  --    매장 정보 조회 실패는 안전 fallback (null) — guardrail 필터 미적용, 기존 필터만
  select coalesce(u.business_category, '') into v_business_category
    from public.users u
   where u.id = p_store_id
     and u.account_type = 'business'
   limit 1;

  if v_business_category is not null and length(btrim(v_business_category)) > 0 then
    v_store_key := public.normalize_store_label(v_business_category);
  end if;

  -- 3) 트랙 조회 (0274 로직 그대로) + guardrail hard_block 필터 추가
  select coalesce(jsonb_agg(to_jsonb(t) order by pt.order_index), '[]'::jsonb) into v
  from public.playlist_tracks pt
  join public.tracks t on t.id = pt.track_id
  left join public.playlist_track_fit_scores f
    on f.playlist_id = pt.playlist_id and f.track_id = pt.track_id
  where pt.playlist_id = p_playlist_id
    and pt.removed_at is null
    and t.release_status in ('released','approved') and t.removed_at is null
    and t.audio_url is not null and length(btrim(t.audio_url)) > 0
    and t.cover_url is not null and length(btrim(t.cover_url)) > 0
    and (t.audio_health_status is null or t.audio_health_status in ('ok','unknown'))
    and not public._business_track_excluded(t.id, v_sk)
    and (f.status is null or f.status = 'active')
    -- 0404: store guardrail hard_block 필터 (매장 컨텍스트 있을 때만)
    and (
      v_store_key is null                                   -- 매장 정보 없음 → 기존 동작
      or (public._ai_check_store_guardrails(t.id, v_store_key)->>'blocked')::boolean = false
    );

  return v;
end;
$fn$;

-- ── STEP 2: 권한 (신규 함수 한정) ───────────────────────────────────────────
revoke execute on function public.get_playlist_tracks(uuid, uuid) from public, anon;
grant  execute on function public.get_playlist_tracks(uuid, uuid) to authenticated;

comment on function public.get_playlist_tracks(uuid, uuid) is
  'HOTFIX 0404 — 매장 재생 조회 (playlist_id, store_id). 기존 필터 + store guardrail hard_block 제외. Soft/warning 은 재생 허용. (isolated apply)';

commit;

-- ── STEP 3: POST-APPLY DIAGNOSTIC (결과 셋으로 확인) ─────────────────────────
select
  exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
         where n.nspname='public' and p.proname='get_playlist_tracks'
           and pg_get_function_identity_arguments(p.oid)='p_playlist_id uuid')                 as existing_uuid_kept,      -- 반드시 true (무변경)
  exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
         where n.nspname='public' and p.proname='get_playlist_tracks'
           and pg_get_function_identity_arguments(p.oid)='p_playlist_id uuid, p_store_id uuid') as new_overload_created,    -- 반드시 true (신규)
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='get_playlist_tracks')                              as total_overloads,         -- 2 기대
  (select array_agg(perm) from (
     select unnest(coalesce(p.proacl, array[]::aclitem[]))::text as perm
     from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname='get_playlist_tracks'
       and pg_get_function_identity_arguments(p.oid)='p_playlist_id uuid, p_store_id uuid'
   ) s)                                                                                        as new_fn_acl;             -- authenticated=X 포함 기대
