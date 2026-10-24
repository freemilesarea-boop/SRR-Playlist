-- 0422 — Phase ALGO-2E: Streaming v2 Calibration & Verification Fix
--
-- 목적:
--   Production shadow 모니터링에서 발견된 v2 검증 타이밍/세션 정체성 문제 보정.
--   1) play_30s row 는 방출 시점 session.verified_seconds(~20s) 를 얼려 저장 →
--      v2_verified_streams(=play_30s row 자체의 heartbeat_verified/verified_seconds 기준)=0
--   2) heartbeat 누적 30s 도달이 play_completed 에 찍혀 play_30s 기준 verified 뷰에 미반영
--   3) 동일 session_token 에서 session player_type(USER) 과 event 해석 player_type(ARTIST_PREVIEW) 불일치
--
-- 방식: session 상태를 참조하는 verified 판정 + 보수적 player_type canonical.
--       CREATE OR REPLACE view/function 만 사용. 기존 테이블 drop/rename/삭제 없음.
--
-- 절대 원칙:
--   • v1 무변경: record_stream_event_safe / stream_events / 정산 / 차트 / 추천 전부 그대로.
--   • Settlement v2 실지급 전환 금지 · Chart v2 전환 금지 · 추천/노출 연결 금지 · fraud 자동차단 금지.
--   • 기존 v2 데이터 삭제 금지(escalation 은 update-only, 하향 없음).
--   • Additive / CREATE OR REPLACE 만. 컬럼 집합·타입·순서 불변(뷰 호환).
--   • streaming_v2_shadow_enabled=false 로 언제든 차단 가능(플래그/파이프라인 무변경).

-- ─────────────────────────────────────────────────────────────────────
-- A. Player Type 우선순위(보수성) 랭크 + 보수적 병합 helper
--    우선순위(높을수록 보수적=정산 제외): ADMIN_PREVIEW > ARTIST_PREVIEW > SYSTEM
--                                        > ENTERPRISE > BRAND > STORE > USER
-- ─────────────────────────────────────────────────────────────────────
create or replace function public._v2_player_type_rank(p text)
returns int language sql immutable set search_path to 'public' as $$
  select case upper(coalesce(p,''))
    when 'ADMIN_PREVIEW'  then 7
    when 'ARTIST_PREVIEW' then 6
    when 'SYSTEM'         then 5
    when 'ENTERPRISE'     then 4
    when 'BRAND'          then 3
    when 'STORE'          then 2
    when 'USER'           then 1
    else 5 end;  -- 알 수 없으면 SYSTEM 급(보수적)
$$;

-- 두 player_type 중 더 보수적(높은 rank)인 쪽 반환
create or replace function public._v2_more_conservative_ptype(a text, b text)
returns text language sql immutable set search_path to 'public' as $$
  select case
    when b is null then a
    when a is null then b
    when public._v2_player_type_rank(a) >= public._v2_player_type_rank(b) then a
    else b end;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- B. record_stream_event_v2 보정 (동일 시그니처 CREATE OR REPLACE)
--    변경점:
--      • session canonical player_type 참조 → client 해석값과 더 보수적인 쪽 채택
--      • 불일치 시 session player_type 을 canonical 로 escalate(상향만, update-only)
--      • ineligible 재계산은 canonical 기준
--      • raw_payload 에 player_type_client/session/canonical/mismatch 기록
--      • verified_seconds/heartbeat_verified 스냅샷 로직은 유지(뷰가 session 기준으로 재판정)
--    v1 record_stream_event_safe 와 무관(별도 shadow 함수).
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.record_stream_event_v2(
  p_track_id uuid, p_event_type text, p_session_token text default null::text,
  p_player_type text default 'USER'::text, p_anonymous_id text default null::text,
  p_device_id text default null::text, p_device_class text default null::text,
  p_client_reported_seconds numeric default null::numeric, p_playlist_id uuid default null::uuid,
  p_brand_id uuid default null::uuid, p_store_id uuid default null::uuid,
  p_enterprise_account_id uuid default null::uuid, p_created_by_runtime uuid default null::uuid,
  p_player_volume numeric default null::numeric, p_player_muted boolean default null::boolean,
  p_visibility_state text default null::text, p_background_state text default null::text,
  p_network_state text default null::text, p_battery_saver boolean default null::boolean,
  p_source_page text default null::text, p_user_agent text default null::text,
  p_raw_payload jsonb default '{}'::jsonb)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_owner uuid; v_source_type text; v_release_status text;
  v_client_ptype text; v_session_ptype text; v_ptype text; v_mismatch boolean := false;
  v_ineligible text := null; v_hb_verified boolean := false; v_verified_sec numeric := null;
  v_id bigint; v_vol numeric := p_player_volume; v_payload jsonb;
begin
  select owner_user_id, source_type, release_status into v_owner, v_source_type, v_release_status
  from public.tracks where id = p_track_id;

  -- 1) client 해석 player_type (기존 로직: source_page/owner 기반)
  v_client_ptype := public._v2_resolve_player_type(p_player_type, p_source_page,
                                                   v_uid is not null and v_uid = v_owner);
  -- 2) session canonical 참조 → 더 보수적인 쪽 채택
  if p_session_token is not null then
    select player_type into v_session_ptype from public.stream_sessions_v2 where session_token = p_session_token;
  end if;
  v_ptype := public._v2_more_conservative_ptype(v_client_ptype, v_session_ptype);
  v_mismatch := (v_session_ptype is not null and upper(v_session_ptype) is distinct from upper(v_client_ptype));

  if v_vol is not null and (v_vol < 0 or v_vol > 1) then v_vol := null; end if;

  -- 3) ineligible 은 canonical 기준으로 판정
  if v_source_type is distinct from 'artist_upload' or v_release_status is distinct from 'released' then
    v_ineligible := 'unreleased';
  elsif v_ptype in ('ADMIN_PREVIEW','ARTIST_PREVIEW','SYSTEM') then
    v_ineligible := lower(v_ptype);
  elsif coalesce(p_player_muted,false) or (v_vol is not null and v_vol = 0) then
    v_ineligible := 'muted_play';
  elsif v_vol is not null and v_vol < 0.1 then
    v_ineligible := 'low_player_volume';
  end if;

  -- 4) session 검증 스냅샷(기존과 동일 — 뷰가 session live 로 재판정하므로 참고값)
  if p_session_token is not null then
    select verified_seconds, (verified_seconds >= 30)
      into v_verified_sec, v_hb_verified
    from public.stream_sessions_v2 where session_token = p_session_token;
  end if;

  -- 5) session player_type escalate (상향만; 하향/삭제 없음)
  if p_session_token is not null and v_session_ptype is not null and v_ptype is distinct from v_session_ptype then
    update public.stream_sessions_v2
       set player_type = v_ptype
     where session_token = p_session_token
       and public._v2_player_type_rank(v_ptype) > public._v2_player_type_rank(player_type);
  end if;

  v_payload := coalesce(p_raw_payload,'{}'::jsonb) || jsonb_build_object(
    'player_type_client', v_client_ptype, 'player_type_session', v_session_ptype,
    'player_type_canonical', v_ptype, 'player_type_mismatch', v_mismatch);

  insert into public.stream_ingest_v2 (
    event_type, track_id, user_id, anonymous_id, player_type,
    brand_id, store_id, enterprise_account_id, playlist_id,
    device_id, device_class, session_token,
    client_reported_seconds, verified_seconds, heartbeat_verified,
    player_volume, player_muted, visibility_state, background_state, network_state, battery_saver,
    eligible_reason, ineligible_reason, dispute_status,
    created_by_runtime, source_page, user_agent, ingest_source, raw_payload
  ) values (
    p_event_type, p_track_id, v_uid, nullif(btrim(p_anonymous_id),''), v_ptype,
    p_brand_id, p_store_id, p_enterprise_account_id, p_playlist_id,
    nullif(btrim(p_device_id),''), p_device_class, p_session_token,
    p_client_reported_seconds, v_verified_sec, coalesce(v_hb_verified,false),
    v_vol, p_player_muted, p_visibility_state, p_background_state, p_network_state, p_battery_saver,
    case when v_ineligible is null then 'passed' else null end, v_ineligible, 'none',
    p_created_by_runtime, p_source_page, p_user_agent, 'v2_shadow', v_payload
  ) returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id, 'player_type', v_ptype,
    'player_type_mismatch', v_mismatch,
    'heartbeat_verified', coalesce(v_hb_verified,false), 'verified_seconds', v_verified_sec,
    'ineligible_reason', v_ineligible);
end;
$function$;

-- ─────────────────────────────────────────────────────────────────────
-- C. v2_verified_streams 재정의 (session 기반 검증)
--    새 기준(보수적, 세 갈래 OR):
--      (i)  같은 session.verified_seconds >= 30 AND heartbeat_count >= 2
--      (ii) 같은 session 의 후속 play_completed 가 heartbeat_verified AND verified_seconds>=30
--      (iii) legacy: sessionless row 자체가 이미 verified(구 동작 보존)
--    출력 컬럼/타입/순서 불변. player_type/verified_seconds 는 session 보정값으로 출력.
-- ─────────────────────────────────────────────────────────────────────
create or replace view public.v2_verified_streams as
select
  i.id, i.event_type, i.track_id, i.user_id, i.anonymous_id,
  public._v2_more_conservative_ptype(i.player_type, s.player_type) as player_type,
  i.brand_id, i.store_id, i.enterprise_account_id, i.playlist_id,
  i.device_id, i.device_class, i.session_token,
  i.client_reported_seconds,
  coalesce(s.verified_seconds, i.verified_seconds) as verified_seconds,
  (coalesce(s.verified_seconds, i.verified_seconds) >= 30) as heartbeat_verified,
  i.player_volume, i.player_muted, i.visibility_state, i.background_state, i.network_state, i.battery_saver,
  i.eligible_reason, i.ineligible_reason, i.fraud_score, i.stream_quality, i.dispute_status,
  i.created_by_runtime, i.source_page, i.user_agent, i.client_ip, i.ingest_source, i.raw_payload, i.created_at
from public.stream_ingest_v2 i
left join public.stream_sessions_v2 s on s.session_token = i.session_token
where i.event_type = 'play_30s'
  and coalesce(i.visibility_state,'visible') = 'visible'
  and (
        (s.session_token is not null and coalesce(s.verified_seconds,0) >= 30 and coalesce(s.heartbeat_count,0) >= 2)
     or exists (select 1 from public.stream_ingest_v2 c
                 where c.session_token = i.session_token and c.session_token is not null
                   and c.event_type = 'play_completed'
                   and c.heartbeat_verified = true and coalesce(c.verified_seconds,0) >= 30)
     or (i.heartbeat_verified = true and coalesce(i.verified_seconds,0) >= 30)
  );

-- v2_eligible_streams / v2_settlement_eligible_streams 는 재정의 불필요:
--   기존 정의가 v2_verified_streams 를 참조하므로 자동으로 보정 반영.
--   (player_type 보수화로 preview/admin/system 은 계속 eligible 제외, muted/low-volume 도 유지)

-- ─────────────────────────────────────────────────────────────────────
-- D. Calibration Report RPC (admin 전용, 분석 전용)
--    before(구 row-snapshot 기준) vs after(session 기준) verified/eligible 델타 +
--    player_type mismatch + heartbeat coverage + top mismatch 예시.
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_stream_v2_calibration_report(p_days int default 7)
returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $$
declare v_from timestamptz := now() - make_interval(days => greatest(coalesce(p_days,7),1)); v jsonb;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;

  with p30 as (  -- 윈도우 내 play_30s + 세션 조인
    select i.*, s.verified_seconds as sess_verified, s.heartbeat_count as sess_hb, s.player_type as sess_ptype
    from public.stream_ingest_v2 i
    left join public.stream_sessions_v2 s on s.session_token = i.session_token
    where i.event_type = 'play_30s' and i.created_at >= v_from
  ),
  flags as (
    select *,
      coalesce(visibility_state,'visible')='visible' as vis,
      -- before: row 자체 스냅샷
      (heartbeat_verified = true and coalesce(verified_seconds,0) >= 30) as v_before,
      -- after: session 기준 (뷰와 동일 3-갈래)
      ((session_token is not null and coalesce(sess_verified,0) >= 30 and coalesce(sess_hb,0) >= 2)
        or exists (select 1 from public.stream_ingest_v2 c where c.session_token = p30.session_token and c.session_token is not null
                     and c.event_type='play_completed' and c.heartbeat_verified=true and coalesce(c.verified_seconds,0)>=30)
        or (heartbeat_verified = true and coalesce(verified_seconds,0) >= 30)) as v_after,
      public._v2_more_conservative_ptype(player_type, sess_ptype) as canon_ptype,
      (sess_ptype is not null and upper(sess_ptype) is distinct from upper(player_type)) as ptype_mismatch
    from p30
  ),
  elig as (  -- eligible 필터(양쪽 공통): volume/muted/ineligible/preview/fraud/dispute
    select *,
      (coalesce(player_volume,1) >= 0.1 and coalesce(player_muted,false)=false and ineligible_reason is null
        and coalesce(fraud_score,0) < 60 and dispute_status='none') as base_ok,
      (canon_ptype <> all (array['ADMIN_PREVIEW','ARTIST_PREVIEW','SYSTEM'])) as ptype_ok
    from flags
  )
  select jsonb_build_object(
    'window_days', greatest(coalesce(p_days,7),1),
    'play_30s_count', (select count(*) from elig),
    'session_verified_count', (select count(distinct session_token) from elig where session_token is not null and coalesce(sess_verified,0) >= 30),
    'heartbeat_coverage_pct', (select case when count(*)=0 then 0 else round(count(*) filter (where coalesce(sess_hb,0) > 0)::numeric / count(*) * 100, 1) end from elig where session_token is not null),
    'session_verified_rate_pct', (select case when count(*)=0 then 0 else round(count(*) filter (where v_after and vis)::numeric / count(*) * 100, 1) end from elig),
    'completed_after_30s_count', (select count(distinct session_token) from public.stream_ingest_v2 c
        where c.event_type='play_completed' and c.heartbeat_verified=true and coalesce(c.verified_seconds,0)>=30 and c.created_at >= v_from),
    'player_type_mismatch_count', (select count(*) from elig where ptype_mismatch),
    'verified_before', (select count(*) from elig where v_before and vis),
    'verified_after',  (select count(*) from elig where v_after and vis),
    'verified_delta',  (select count(*) filter (where v_after and vis) - count(*) filter (where v_before and vis) from elig),
    'eligible_before', (select count(*) from elig where v_before and vis and base_ok
        and (player_type <> all (array['ADMIN_PREVIEW','ARTIST_PREVIEW','SYSTEM']))),
    'eligible_after',  (select count(*) from elig where v_after and vis and base_ok and ptype_ok),
    'eligible_delta',  (select count(*) filter (where v_after and vis and base_ok and ptype_ok)
        - count(*) filter (where v_before and vis and base_ok and (player_type <> all (array['ADMIN_PREVIEW','ARTIST_PREVIEW','SYSTEM']))) from elig),
    'top_mismatch_examples', (select coalesce(jsonb_agg(jsonb_build_object(
        'session_token', left(session_token,8), 'event_player_type', player_type, 'session_player_type', sess_ptype,
        'canonical', canon_ptype, 'verified_seconds', round(coalesce(sess_verified,verified_seconds),1)) ), '[]'::jsonb)
      from (select * from elig where ptype_mismatch order by created_at desc limit 10) m),
    'notes', 'before=play_30s row 스냅샷 기준 / after=session heartbeat 기준. eligible 은 preview·admin·system·muted·low-volume 제외 유지. 분석 전용 — 지급/차트 무관.'
  ) into v;
  return v;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- E. 권한
-- ─────────────────────────────────────────────────────────────────────
do $$
declare fn text;
begin
  foreach fn in array array[
    'public._v2_player_type_rank(text)',
    'public._v2_more_conservative_ptype(text,text)',
    'public.admin_stream_v2_calibration_report(integer)'
  ] loop
    execute format('revoke execute on function %s from public, anon;', fn);
  end loop;
  -- record_stream_event_v2 는 기존 권한 유지(클라이언트 shadow 호출). 여기서 재부여만.
  grant execute on function public.admin_stream_v2_calibration_report(integer) to authenticated;
  grant execute on function public._v2_player_type_rank(text) to authenticated;
  grant execute on function public._v2_more_conservative_ptype(text,text) to authenticated;
end $$;

comment on view public.v2_verified_streams is
  'ALGO-2E — session heartbeat 기준 verified 재정의(play_30s 스냅샷 타이밍 보정). player_type 보수적 canonical. shadow only.';
comment on function public.admin_stream_v2_calibration_report(integer) is
  'ALGO-2E — verified/eligible before(row) vs after(session) 델타 + player_type mismatch 진단. 분석 전용.';
