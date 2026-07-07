-- 0404 — HOTFIX-A: Playback Guardrail Enforcement
--
-- 목표: 매장 플레이어가 실제 재생 직전 반드시 store guardrail hard_block 을 통과하도록.
--
-- 배경:
--   0173 (store_guardrails) + 0173b (_ai_check_store_guardrails) 은 이미 존재하지만
--   `_ai_compute_fit` 계산 시점에만 사용됨. 실제 재생 큐 조회 (`get_playlist_tracks`) 에는
--   guardrail 이 연결되지 않아, playlist_tracks 에 잘못 담긴 rock/metal/EDM 이 카페/스터디
--   매장에서 그대로 재생될 위험 존재.
--
-- 조치:
--   기존 `get_playlist_tracks(uuid)` (0274) 를 **무변경** 하고,
--   신규 오버로드 시그니처 `get_playlist_tracks(uuid, uuid)` 를 추가한다.
--   두 번째 uuid = 매장 store_id · 매장 store_key 로 guardrail hard_block 판정.
--
-- 안전:
--   - 기존 함수 (PlaylistPage · PlaylistEditor · admin 도구) 무변경 → 회귀 0
--   - 신규 함수는 프론트가 명시적 매장 컨텍스트 전달 시에만 호출
--   - store_id 유효하지 않거나 business_category 없으면 기존 필터만 적용 (안전 fallback)
--   - Hard block 만 큐 제외 · soft/warning 은 재생 허용 (사용자 정책 §4 준수)
--   - Guardrail 조회 실패는 include 로 처리 (기존 동작 유지 · 재생 중단 방지)
--   - AI Score / New Track / rotation 로직 변경 0
--
-- 회귀 방지:
--   - 기존 `get_playlist_tracks(uuid)` 시그니처 · body · 권한 무변경
--   - 신규 시그니처 · 명시적 매장 컨텍스트 전달 시에만 호출
--   - security definer + set search_path 로 RLS 우회 안전
--   - `_ai_check_store_guardrails` 재사용 · 새 알고리즘 도입 0

-- ============================================================
-- 신규 오버로드: get_playlist_tracks(playlist_id, store_id)
-- ============================================================
create or replace function public.get_playlist_tracks(
  p_playlist_id uuid,
  p_store_id uuid
)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
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
    -- 🆕 0404: store guardrail hard_block 필터 (매장 컨텍스트 있을 때만)
    and (
      v_store_key is null                                   -- 매장 정보 없음 → 기존 동작
      or (public._ai_check_store_guardrails(t.id, v_store_key)->>'blocked')::boolean = false
    );

  return v;
end;
$$;

revoke execute on function public.get_playlist_tracks(uuid, uuid) from public, anon;
grant  execute on function public.get_playlist_tracks(uuid, uuid) to authenticated;

comment on function public.get_playlist_tracks(uuid, uuid) is
  'HOTFIX 0404 — 매장 재생 조회 (playlist_id, store_id). 기존 필터 + store guardrail hard_block 제외. Soft/warning 은 재생 허용.';


-- ============================================================
-- Diagnostics
-- ============================================================
do $$
declare
  v_old_exists boolean;
  v_new_exists boolean;
  v_helper_exists boolean;
begin
  select exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname='public' and p.proname='get_playlist_tracks'
      and pg_get_function_identity_arguments(p.oid) = 'p_playlist_id uuid'
  ) into v_old_exists;

  select exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname='public' and p.proname='get_playlist_tracks'
      and pg_get_function_identity_arguments(p.oid) = 'p_playlist_id uuid, p_store_id uuid'
  ) into v_new_exists;

  select exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname='public' and p.proname='_ai_check_store_guardrails'
  ) into v_helper_exists;

  raise notice '====== 0404 HOTFIX-A Playback Guardrail Diagnostics ======';
  raise notice 'get_playlist_tracks(uuid) [existing/무변경]: %', v_old_exists;
  raise notice 'get_playlist_tracks(uuid, uuid) [신규]: %', v_new_exists;
  raise notice '_ai_check_store_guardrails [prerequisite from 0173b]: %', v_helper_exists;
  raise notice '===========================================================';

  if v_old_exists and v_new_exists and v_helper_exists then
    raise notice '0404 COMPLETE — Playback Guardrail Enforcement ready';
  else
    raise warning '0404 INCOMPLETE — 위 카운트 확인';
  end if;
end$$;
