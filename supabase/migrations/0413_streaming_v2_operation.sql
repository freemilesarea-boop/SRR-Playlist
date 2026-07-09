-- 0413 — Phase ALGO-2B: Streaming v2 Shadow Operation & Validation tools
--
-- 목적:
--   0412 shadow foundation 위에 운영/검증 도구를 추가.
--   · admin_stream_v2_overview 필터 강화 (player_type/track/store/brand + diff rate)
--   · admin_stream_v2_replay  — session/track 이벤트 타임라인 (관리자 조회 전용)
--   · admin_stream_v2_health  — store/brand/user/global Streaming Health Score
--
-- 절대 원칙 (ALGO-2B):
--   • additive only. 기존 v1(record_stream_event_safe/stream_events/정산/차트) 무변경.
--   • v2 데이터는 관측용만. settlement_eligible 은 실제 정산 미사용.
--   • 전부 조회(SECURITY DEFINER, super_admin). write 없음.
--   • 0412 미적용 상태 전제 — 본 파일도 ALGO 승인 전 apply 금지.

-- ─────────────────────────────────────────────────────────────────────
-- A. Overview 강화 (필터 + 차이율 + 사유 분해). CREATE OR REPLACE (하위호환: 기본 null).
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_stream_v2_overview(
  p_days integer default 7,
  p_player_type text default null,
  p_track_id uuid default null,
  p_store_id uuid default null,
  p_brand_id uuid default null)
returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $$
declare
  v_since timestamptz; v jsonb;
  v_raw bigint; v_p30 bigint; v_verified bigint; v_eligible bigint; v_settle bigint;
  v_v1_elig bigint; v_diff_rate numeric;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  v_since := now() - (greatest(1, least(coalesce(p_days,7), 90)) || ' days')::interval;

  v_raw := (select count(*) from public.stream_ingest_v2 s where s.created_at>=v_since
              and (p_player_type is null or s.player_type=p_player_type)
              and (p_track_id is null or s.track_id=p_track_id)
              and (p_store_id is null or s.store_id=p_store_id)
              and (p_brand_id is null or s.brand_id=p_brand_id));
  v_p30 := (select count(*) from public.stream_ingest_v2 s where s.created_at>=v_since and s.event_type='play_30s'
              and (p_player_type is null or s.player_type=p_player_type)
              and (p_track_id is null or s.track_id=p_track_id)
              and (p_store_id is null or s.store_id=p_store_id)
              and (p_brand_id is null or s.brand_id=p_brand_id));
  v_verified := (select count(*) from public.v2_verified_streams s where s.created_at>=v_since
              and (p_player_type is null or s.player_type=p_player_type)
              and (p_track_id is null or s.track_id=p_track_id)
              and (p_store_id is null or s.store_id=p_store_id)
              and (p_brand_id is null or s.brand_id=p_brand_id));
  v_eligible := (select count(*) from public.v2_eligible_streams s where s.created_at>=v_since
              and (p_player_type is null or s.player_type=p_player_type)
              and (p_track_id is null or s.track_id=p_track_id)
              and (p_store_id is null or s.store_id=p_store_id)
              and (p_brand_id is null or s.brand_id=p_brand_id));
  v_settle := (select count(*) from public.v2_settlement_eligible_streams s where s.created_at>=v_since
              and (p_player_type is null or s.player_type=p_player_type)
              and (p_track_id is null or s.track_id=p_track_id)
              and (p_store_id is null or s.store_id=p_store_id)
              and (p_brand_id is null or s.brand_id=p_brand_id));

  -- v1 eligible (동일 기간, track 필터만 대응 — v1 엔 player_type/store/brand 없음)
  v_v1_elig := (select count(*) from public.stream_events se
                 where se.event_type='milestone_30s' and se.is_effective and se.eligible_for_payout
                   and se.created_at>=v_since and (p_track_id is null or se.track_id=p_track_id));
  v_diff_rate := case when v_v1_elig=0 then null else round((v_settle - v_v1_elig)::numeric / v_v1_elig * 100, 2) end;

  v := jsonb_build_object(
    'window_days', greatest(1, least(coalesce(p_days,7), 90)),
    'filters', jsonb_build_object('player_type', p_player_type, 'track_id', p_track_id, 'store_id', p_store_id, 'brand_id', p_brand_id),
    'funnel', jsonb_build_object('raw', v_raw, 'play_30s', v_p30, 'verified', v_verified, 'eligible', v_eligible, 'settlement_eligible', v_settle),
    'v1', jsonb_build_object('eligible_for_payout', v_v1_elig),
    'difference', jsonb_build_object('settlement_minus_v1', v_settle - v_v1_elig, 'rate_pct', v_diff_rate,
      'zone', case when v_diff_rate is null then 'n/a'
                   when abs(v_diff_rate) <= 5 then 'normal'
                   when abs(v_diff_rate) <= 15 then 'watch'
                   else 'investigate' end),
    'rejected_breakdown', (
      select coalesce(jsonb_object_agg(reason, c), '{}'::jsonb) from (
        select coalesce(ineligible_reason,'(passed)') reason, count(*) c
        from public.stream_ingest_v2 s where s.created_at>=v_since and s.event_type='play_30s'
          and (p_player_type is null or s.player_type=p_player_type)
          and (p_track_id is null or s.track_id=p_track_id)
          and (p_store_id is null or s.store_id=p_store_id)
          and (p_brand_id is null or s.brand_id=p_brand_id)
        group by 1) x),
    'player_type_breakdown', (
      select coalesce(jsonb_object_agg(player_type, c), '{}'::jsonb) from (
        select player_type, count(*) c from public.stream_ingest_v2 s where s.created_at>=v_since
          and (p_track_id is null or s.track_id=p_track_id)
          and (p_store_id is null or s.store_id=p_store_id)
          and (p_brand_id is null or s.brand_id=p_brand_id)
        group by 1) x),
    'fraud_watch', (select count(*) from public.stream_ingest_v2 s where s.created_at>=v_since and coalesce(s.fraud_score,0)>=60
          and (p_player_type is null or s.player_type=p_player_type)),
    'disputed', (select count(*) from public.stream_ingest_v2 s where s.created_at>=v_since and s.dispute_status<>'none'),
    'reconciliation', (
      select coalesce(jsonb_agg(row_to_json(r) order by r.day desc), '[]'::jsonb)
      from (select * from public.v2_shadow_reconciliation where day >= v_since::date) r)
  );
  return v;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- B. Replay / Timeline — session 또는 track 이벤트 시간순 (조회 전용)
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_stream_v2_replay(
  p_session_token text default null, p_track_id uuid default null, p_limit integer default 200)
returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $$
declare v jsonb;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  if p_session_token is null and p_track_id is null then
    raise exception 'session_token or track_id required';
  end if;

  select coalesce(jsonb_agg(row_to_json(e) order by e.created_at), '[]'::jsonb) into v
  from (
    select s.created_at, s.event_type, s.player_type, s.session_token, s.track_id,
           s.verified_seconds, s.client_reported_seconds, s.heartbeat_verified,
           s.player_volume, s.player_muted, s.visibility_state, s.background_state,
           s.eligible_reason, s.ineligible_reason, s.fraud_score, s.dispute_status,
           -- eligible 스냅샷 (play_30s 기준 뷰 규칙 재현)
           (s.event_type='play_30s' and s.heartbeat_verified and coalesce(s.verified_seconds,0)>=30
             and coalesce(s.visibility_state,'visible')='visible'
             and coalesce(s.player_volume,1)>=0.1 and coalesce(s.player_muted,false)=false
             and s.ineligible_reason is null
             and s.player_type not in ('ADMIN_PREVIEW','ARTIST_PREVIEW','SYSTEM')
             and coalesce(s.fraud_score,0)<60 and s.dispute_status='none') as eligible_snapshot
    from public.stream_ingest_v2 s
    where (p_session_token is null or s.session_token = p_session_token)
      and (p_track_id is null or s.track_id = p_track_id)
    order by s.created_at
    limit greatest(1, least(coalesce(p_limit,200), 1000))
  ) e;
  return v;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- C. Streaming Health Score — store/brand/user/global (관측 지표, 정산 미반영)
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_stream_v2_health(
  p_scope text default 'global', p_id uuid default null, p_days integer default 7)
returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $$
declare
  v_since timestamptz; v_scope text := lower(coalesce(p_scope,'global'));
  v_raw bigint; v_p30 bigint; v_verified bigint; v_eligible bigint; v_hb bigint; v_fraud bigint; v_rejected bigint;
  v_verified_rate numeric; v_eligible_rate numeric; v_hb_rate numeric; v_fraud_rate numeric; v_rejected_rate numeric;
  v_score numeric;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  if v_scope not in ('global','store','brand','user') then raise exception 'invalid scope'; end if;
  if v_scope <> 'global' and p_id is null then raise exception 'id required for scope %', v_scope; end if;
  v_since := now() - (greatest(1, least(coalesce(p_days,7), 90)) || ' days')::interval;

  -- 대상 play_30s 이벤트 집계 (scope 필터)
  select
    count(*) filter (where event_type='play_30s'),
    count(*) filter (where event_type='play_30s'
      and heartbeat_verified and coalesce(verified_seconds,0)>=30 and coalesce(visibility_state,'visible')='visible'),
    count(*) filter (where event_type='play_30s'
      and heartbeat_verified and coalesce(verified_seconds,0)>=30 and coalesce(visibility_state,'visible')='visible'
      and coalesce(player_volume,1)>=0.1 and coalesce(player_muted,false)=false and ineligible_reason is null
      and player_type not in ('ADMIN_PREVIEW','ARTIST_PREVIEW','SYSTEM') and coalesce(fraud_score,0)<60 and dispute_status='none'),
    count(*) filter (where event_type='play_30s' and heartbeat_verified),
    count(*) filter (where event_type='play_30s' and coalesce(fraud_score,0)>=60),
    count(*) filter (where event_type='play_30s' and ineligible_reason is not null),
    count(*)
  into v_p30, v_verified, v_eligible, v_hb, v_fraud, v_rejected, v_raw
  from public.stream_ingest_v2 s
  where s.created_at >= v_since
    and (v_scope='global'
         or (v_scope='store' and s.store_id=p_id)
         or (v_scope='brand' and s.brand_id=p_id)
         or (v_scope='user'  and s.user_id=p_id));

  v_verified_rate := case when v_p30=0 then 0 else v_verified::numeric/v_p30 end;
  v_eligible_rate := case when v_p30=0 then 0 else v_eligible::numeric/v_p30 end;
  v_hb_rate       := case when v_p30=0 then 0 else v_hb::numeric/v_p30 end;
  v_fraud_rate    := case when v_p30=0 then 0 else v_fraud::numeric/v_p30 end;
  v_rejected_rate := case when v_p30=0 then 0 else v_rejected::numeric/v_p30 end;
  v_score := round(v_verified_rate*40 + v_eligible_rate*30 + v_hb_rate*20 + (1 - v_fraud_rate)*10, 1);

  return jsonb_build_object(
    'scope', v_scope, 'id', p_id, 'window_days', greatest(1, least(coalesce(p_days,7), 90)),
    'play_30s_count', v_p30, 'raw_count', v_raw,
    'overall_health', v_score,
    'verified_rate', round(v_verified_rate,4), 'eligible_rate', round(v_eligible_rate,4),
    'heartbeat_success_rate', round(v_hb_rate,4), 'fraud_rate', round(v_fraud_rate,4), 'rejected_rate', round(v_rejected_rate,4),
    'top_rejection_reasons', (
      select coalesce(jsonb_object_agg(reason, c), '{}'::jsonb) from (
        select ineligible_reason reason, count(*) c
        from public.stream_ingest_v2 s
        where s.created_at>=v_since and s.event_type='play_30s' and s.ineligible_reason is not null
          and (v_scope='global' or (v_scope='store' and s.store_id=p_id) or (v_scope='brand' and s.brand_id=p_id) or (v_scope='user' and s.user_id=p_id))
        group by 1 order by 2 desc limit 8) x)
  );
end;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- D. 권한 (전부 super_admin 조회)
-- ─────────────────────────────────────────────────────────────────────
do $$
declare fn text;
begin
  foreach fn in array array[
    'public.admin_stream_v2_overview(integer,text,uuid,uuid,uuid)',
    'public.admin_stream_v2_replay(text,uuid,integer)',
    'public.admin_stream_v2_health(text,uuid,integer)'
  ] loop
    execute format('revoke execute on function %s from public, anon;', fn);
    execute format('grant  execute on function %s to authenticated;', fn);
  end loop;
end $$;

comment on function public.admin_stream_v2_replay(text,uuid,integer) is
  'ALGO-2B — session/track 이벤트 타임라인 (관측 전용). 왜 eligible/ineligible 인지 설명.';
comment on function public.admin_stream_v2_health(text,uuid,integer) is
  'ALGO-2B — Streaming Health Score (verified40/eligible30/heartbeat20/fraud10). 관측 지표, 정산 미반영.';
