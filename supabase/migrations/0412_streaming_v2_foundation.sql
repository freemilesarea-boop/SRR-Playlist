-- 0412 — Phase ALGO-2A: Eligible Stream Engine (Streaming v2 Shadow Foundation)
--
-- 목적:
--   기존 Streaming v1(record_stream_event_safe / stream_events / 정산 / 차트)을
--   한 줄도 건드리지 않고, 병행 shadow 로 Streaming v2 기반을 구축.
--   Raw → Verified → Eligible → Settlement-Eligible 파생 뷰 체인 + heartbeat 세션.
--
-- 절대 원칙 (ALGO-2A):
--   • additive only. 기존 테이블/함수/뷰 drop·rename·alter-required 없음.
--   • 정산/차트/Brand·Store Runtime 무변경. v2 는 관측(shadow)만.
--   • 모든 write 는 SECURITY DEFINER RPC. 익명/로그인 모두 지원.
--   • Feature flag 기본 OFF. 실패해도 v1/재생 영향 0 (호출측 fire-and-forget).
--   • 정산 전환·fraud 자동차단·exposure 연결 없음(후속 Phase).

-- ─────────────────────────────────────────────────────────────────────
-- A. Feature flag (additive seed, 기본 false)
-- ─────────────────────────────────────────────────────────────────────
insert into public.admin_settings (key, value, description)
values ('streaming_v2_shadow_enabled', 'false'::jsonb,
        'ALGO-2A: Streaming v2 shadow 기록 on/off. 기본 false. true 일 때만 client 가 record_stream_event_v2 를 병행 호출. 정산/차트 무관.')
on conflict (key) do nothing;

-- client 가 읽을 수 있는 공개 flag RPC (admin_settings 는 RLS 로 비공개)
create or replace function public.get_streaming_v2_flag()
returns boolean
language sql stable security definer set search_path to 'public'
as $$
  select coalesce((select (value #>> '{}')::boolean from public.admin_settings where key = 'streaming_v2_shadow_enabled'), false);
$$;

-- ─────────────────────────────────────────────────────────────────────
-- B. 테이블
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.stream_sessions_v2 (
  session_token     text primary key,
  nonce             text not null,
  user_id           uuid,
  anonymous_id      text,
  device_id         text,
  track_id          uuid,
  player_type       text not null default 'USER',
  verified_seconds  numeric not null default 0,
  heartbeat_count   integer not null default 0,
  last_heartbeat_at timestamptz,
  created_at        timestamptz not null default now()
);
create index if not exists ssv2_device_idx on public.stream_sessions_v2(device_id, created_at);

create table if not exists public.stream_ingest_v2 (
  id                     bigint generated always as identity primary key,
  event_type             text not null,   -- play_started/play_verified/play_30s/play_completed/play_skipped/heartbeat/...
  track_id               uuid references public.tracks(id) on delete set null,
  user_id                uuid,
  anonymous_id           text,
  player_type            text not null default 'USER'
    check (player_type in ('USER','STORE','BRAND','ENTERPRISE','ADMIN_PREVIEW','ARTIST_PREVIEW','SYSTEM')),
  brand_id               uuid,
  store_id               uuid,
  enterprise_account_id  uuid,
  playlist_id            uuid,
  device_id              text,
  device_class           text,
  session_token          text,
  client_reported_seconds numeric,
  verified_seconds       numeric,
  heartbeat_verified     boolean not null default false,
  player_volume          numeric,
  player_muted           boolean,
  visibility_state       text,
  background_state       text,
  network_state          text,
  battery_saver          boolean,
  eligible_reason        text,
  ineligible_reason      text,
  fraud_score            numeric(5,2),
  stream_quality         numeric,
  dispute_status         text not null default 'none'
    check (dispute_status in ('none','flagged','disputed','voided')),
  created_by_runtime     uuid,
  source_page            text,
  user_agent             text,
  client_ip              inet,
  ingest_source          text not null default 'v2_shadow',
  raw_payload            jsonb not null default '{}'::jsonb,
  created_at             timestamptz not null default now()
);
create index if not exists siv2_track_time_idx on public.stream_ingest_v2(track_id, created_at);
create index if not exists siv2_user_track_idx on public.stream_ingest_v2(user_id, track_id, created_at);
create index if not exists siv2_device_idx on public.stream_ingest_v2(device_id, created_at);
create index if not exists siv2_session_idx on public.stream_ingest_v2(session_token);
create index if not exists siv2_ptype_time_idx on public.stream_ingest_v2(player_type, created_at);
create index if not exists siv2_event_time_idx on public.stream_ingest_v2(event_type, created_at);

create table if not exists public.stream_dispute_flags (
  id            bigint generated always as identity primary key,
  ingest_id     bigint references public.stream_ingest_v2(id) on delete cascade,
  track_id      uuid,
  status        text not null default 'flagged' check (status in ('flagged','disputed','voided','cleared')),
  reason        text,
  flagged_by    uuid,
  created_at    timestamptz not null default now()
);
create index if not exists sdf_ingest_idx on public.stream_dispute_flags(ingest_id);

alter table public.stream_sessions_v2  enable row level security;
alter table public.stream_ingest_v2    enable row level security;
alter table public.stream_dispute_flags enable row level security;
do $$ begin
  if not exists (select 1 from pg_policy where polname='ssv2_admin_read') then
    create policy ssv2_admin_read on public.stream_sessions_v2 for select using (public._is_super_admin());
  end if;
  if not exists (select 1 from pg_policy where polname='siv2_admin_read') then
    create policy siv2_admin_read on public.stream_ingest_v2 for select using (public._is_super_admin());
  end if;
  if not exists (select 1 from pg_policy where polname='sdf_admin_read') then
    create policy sdf_admin_read on public.stream_dispute_flags for select using (public._is_super_admin());
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────
-- C. 파생 뷰 체인 (Raw → Verified → Eligible → Settlement-Eligible)
-- ─────────────────────────────────────────────────────────────────────
create or replace view public.v2_verified_streams as
  select * from public.stream_ingest_v2
  where event_type = 'play_30s'
    and heartbeat_verified = true
    and coalesce(verified_seconds, 0) >= 30
    and coalesce(visibility_state, 'visible') = 'visible';

create or replace view public.v2_eligible_streams as
  select * from public.v2_verified_streams
  where coalesce(player_volume, 1) >= 0.1
    and coalesce(player_muted, false) = false
    and ineligible_reason is null
    and player_type not in ('ADMIN_PREVIEW','ARTIST_PREVIEW','SYSTEM')
    and coalesce(fraud_score, 0) < 60
    and dispute_status = 'none';

create or replace view public.v2_settlement_eligible_streams as
  select e.* from public.v2_eligible_streams e
  where exists (select 1 from public.eligible_settlement_tracks est where est.track_id = e.track_id);

-- v1 vs v2 일별 대사 (KST 기준). 정산 전환 판단용.
create or replace view public.v2_shadow_reconciliation as
  with v1 as (
    select (created_at at time zone 'Asia/Seoul')::date as d,
           count(*) filter (where event_type='milestone_30s') as v1_milestone_30s,
           count(*) filter (where event_type='milestone_30s' and is_effective and eligible_for_payout) as v1_eligible
    from public.stream_events group by 1
  ),
  v2 as (
    select (created_at at time zone 'Asia/Seoul')::date as d,
           count(*) as v2_raw,
           count(*) filter (where event_type='play_30s') as v2_play_30s
    from public.stream_ingest_v2 group by 1
  ),
  v2v as (
    select (created_at at time zone 'Asia/Seoul')::date as d, count(*) as v2_verified
    from public.v2_verified_streams group by 1
  ),
  v2e as (
    select (created_at at time zone 'Asia/Seoul')::date as d, count(*) as v2_eligible
    from public.v2_eligible_streams group by 1
  ),
  v2s as (
    select (created_at at time zone 'Asia/Seoul')::date as d, count(*) as v2_settlement_eligible
    from public.v2_settlement_eligible_streams group by 1
  )
  select coalesce(v1.d, v2.d) as day,
         coalesce(v1.v1_milestone_30s,0) as v1_milestone_30s,
         coalesce(v1.v1_eligible,0) as v1_eligible,
         coalesce(v2.v2_raw,0) as v2_raw,
         coalesce(v2.v2_play_30s,0) as v2_play_30s,
         coalesce(v2v.v2_verified,0) as v2_verified,
         coalesce(v2e.v2_eligible,0) as v2_eligible,
         coalesce(v2s.v2_settlement_eligible,0) as v2_settlement_eligible,
         (coalesce(v2s.v2_settlement_eligible,0) - coalesce(v1.v1_eligible,0)) as diff_settlement_vs_v1
  from v1
  full outer join v2   on v2.d   = v1.d
  left join v2v on v2v.d = coalesce(v1.d, v2.d)
  left join v2e on v2e.d = coalesce(v1.d, v2.d)
  left join v2s on v2s.d = coalesce(v1.d, v2.d);

-- ─────────────────────────────────────────────────────────────────────
-- D. 내부 헬퍼 — player_type 보수적 판정 (source_page/소유권 교차검증)
-- ─────────────────────────────────────────────────────────────────────
create or replace function public._v2_resolve_player_type(p_claimed text, p_source_page text, p_is_owner boolean)
returns text
language plpgsql immutable set search_path to 'public'
as $$
declare v text := upper(coalesce(nullif(btrim(p_claimed),''), 'USER'));
begin
  if v not in ('USER','STORE','BRAND','ENTERPRISE','ADMIN_PREVIEW','ARTIST_PREVIEW','SYSTEM') then v := 'SYSTEM'; end if;
  -- source_page / 소유권이 우선 (보수적: preview 로 하향)
  if p_source_page ilike '/admin%' then return 'ADMIN_PREVIEW'; end if;
  if p_source_page ilike '/artist%' then return 'ARTIST_PREVIEW'; end if;
  if p_is_owner then return 'ARTIST_PREVIEW'; end if;
  if p_source_page ilike '/brand/player%' then return 'BRAND'; end if;
  if p_source_page ilike '/business/player%' then return 'STORE'; end if;
  -- 라우트로 확인 안 되는데 매장/브랜드/본사를 주장하면 검증 불가 → SYSTEM(정산 제외)
  if v in ('STORE','BRAND','ENTERPRISE') then return 'SYSTEM'; end if;
  return v;   -- USER
end;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- E. Write RPC (SECURITY DEFINER, 익명/로그인 지원, 실패해도 v1 무관)
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.start_stream_session_v2(
  p_track_id uuid, p_player_type text default 'USER',
  p_anonymous_id text default null, p_device_id text default null)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare v_token text; v_nonce text; v_uid uuid := auth.uid();
begin
  v_token := gen_random_uuid()::text;
  v_nonce := gen_random_uuid()::text;
  insert into public.stream_sessions_v2 (session_token, nonce, user_id, anonymous_id, device_id, track_id, player_type)
  values (v_token, v_nonce, v_uid, nullif(btrim(p_anonymous_id),''), nullif(btrim(p_device_id),''),
          p_track_id, upper(coalesce(nullif(btrim(p_player_type),''),'USER')));
  return jsonb_build_object('ok', true, 'session_token', v_token, 'nonce', v_nonce);
end;
$$;

create or replace function public.verify_stream_heartbeat_v2(
  p_session_token text, p_position numeric default null, p_playing boolean default true,
  p_volume numeric default null, p_muted boolean default false, p_visibility text default 'visible')
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare s public.stream_sessions_v2%rowtype; v_delta numeric; v_valid boolean;
begin
  select * into s from public.stream_sessions_v2 where session_token = p_session_token;
  if not found then return jsonb_build_object('ok', false, 'reason', 'session_not_found'); end if;

  -- 유효 재생 조건: 재생중 ∧ 화면 표시 ∧ 뮤트 아님 ∧ 볼륨 10%+
  v_valid := coalesce(p_playing, false)
             and coalesce(p_visibility, 'visible') = 'visible'
             and coalesce(p_muted, false) = false
             and coalesce(p_volume, 1) >= 0.1;

  -- heartbeat 간 wall-time 경과분만 누적 (client position 신뢰 안 함), 15초 상한
  if s.last_heartbeat_at is null then v_delta := 0;
  else v_delta := least(extract(epoch from (now() - s.last_heartbeat_at)), 15); end if;

  update public.stream_sessions_v2
     set verified_seconds = verified_seconds + case when v_valid then greatest(v_delta, 0) else 0 end,
         heartbeat_count = heartbeat_count + 1,
         last_heartbeat_at = now()
   where session_token = p_session_token
   returning * into s;

  return jsonb_build_object('ok', true, 'verified_seconds', s.verified_seconds,
    'heartbeat_count', s.heartbeat_count, 'valid', v_valid);
end;
$$;

create or replace function public.record_stream_event_v2(
  p_track_id uuid, p_event_type text,
  p_session_token text default null, p_player_type text default 'USER',
  p_anonymous_id text default null, p_device_id text default null, p_device_class text default null,
  p_client_reported_seconds numeric default null,
  p_playlist_id uuid default null, p_brand_id uuid default null, p_store_id uuid default null,
  p_enterprise_account_id uuid default null, p_created_by_runtime uuid default null,
  p_player_volume numeric default null, p_player_muted boolean default null,
  p_visibility_state text default null, p_background_state text default null,
  p_network_state text default null, p_battery_saver boolean default null,
  p_source_page text default null, p_user_agent text default null,
  p_raw_payload jsonb default '{}'::jsonb)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_owner uuid; v_source_type text; v_release_status text;
  v_ptype text; v_ineligible text := null; v_hb_verified boolean := false; v_verified_sec numeric := null;
  v_id bigint; v_vol numeric := p_player_volume;
begin
  -- 존재하지 않는 트랙이어도 shadow 기록은 남긴다(관측). owner 판정만.
  select owner_user_id, source_type, release_status into v_owner, v_source_type, v_release_status
  from public.tracks where id = p_track_id;

  v_ptype := public._v2_resolve_player_type(p_player_type, p_source_page,
                                            v_uid is not null and v_uid = v_owner);

  if v_vol is not null and (v_vol < 0 or v_vol > 1) then v_vol := null; end if;

  -- shadow ineligible_reason (기록만, 강제 없음 — v1 규칙 미러)
  if v_source_type is distinct from 'artist_upload' or v_release_status is distinct from 'released' then
    v_ineligible := 'unreleased';
  elsif v_ptype in ('ADMIN_PREVIEW','ARTIST_PREVIEW','SYSTEM') then
    v_ineligible := lower(v_ptype);
  elsif coalesce(p_player_muted,false) or (v_vol is not null and v_vol = 0) then
    v_ineligible := 'muted_play';
  elsif v_vol is not null and v_vol < 0.1 then
    v_ineligible := 'low_player_volume';
  end if;

  -- heartbeat 세션 검증 (있으면)
  if p_session_token is not null then
    select verified_seconds, (verified_seconds >= 30)
      into v_verified_sec, v_hb_verified
    from public.stream_sessions_v2 where session_token = p_session_token;
  end if;

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
    p_created_by_runtime, p_source_page, p_user_agent, 'v2_shadow', coalesce(p_raw_payload,'{}'::jsonb)
  ) returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id, 'player_type', v_ptype,
    'heartbeat_verified', coalesce(v_hb_verified,false), 'verified_seconds', v_verified_sec,
    'ineligible_reason', v_ineligible);
end;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- F. Admin RPC — dispute flag + overview
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.flag_stream_v2(p_ingest_id bigint, p_status text default 'flagged', p_reason text default null)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare v_track uuid;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  if p_status not in ('flagged','disputed','voided','cleared') then raise exception 'invalid status'; end if;
  select track_id into v_track from public.stream_ingest_v2 where id = p_ingest_id;
  if v_track is null then raise exception 'ingest event not found'; end if;

  insert into public.stream_dispute_flags (ingest_id, track_id, status, reason, flagged_by)
  values (p_ingest_id, v_track, p_status, p_reason, auth.uid());
  update public.stream_ingest_v2
     set dispute_status = case when p_status='cleared' then 'none' else p_status end
   where id = p_ingest_id;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.admin_stream_v2_overview(p_days integer default 7)
returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $$
declare v_since timestamptz; v jsonb;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  v_since := now() - (greatest(1, least(coalesce(p_days,7), 90)) || ' days')::interval;

  v := jsonb_build_object(
    'window_days', greatest(1, least(coalesce(p_days,7), 90)),
    'funnel', jsonb_build_object(
      'raw', (select count(*) from public.stream_ingest_v2 where created_at >= v_since),
      'play_30s', (select count(*) from public.stream_ingest_v2 where created_at >= v_since and event_type='play_30s'),
      'verified', (select count(*) from public.v2_verified_streams where created_at >= v_since),
      'eligible', (select count(*) from public.v2_eligible_streams where created_at >= v_since),
      'settlement_eligible', (select count(*) from public.v2_settlement_eligible_streams where created_at >= v_since)),
    'rejected_breakdown', (
      select coalesce(jsonb_object_agg(reason, c), '{}'::jsonb) from (
        select coalesce(ineligible_reason,'(none)') reason, count(*) c
        from public.stream_ingest_v2 where created_at >= v_since and event_type='play_30s'
        group by 1) x),
    'player_type_breakdown', (
      select coalesce(jsonb_object_agg(player_type, c), '{}'::jsonb) from (
        select player_type, count(*) c from public.stream_ingest_v2
        where created_at >= v_since group by 1) x),
    'fraud_watch', (select count(*) from public.stream_ingest_v2 where created_at >= v_since and coalesce(fraud_score,0) >= 60),
    'disputed', (select count(*) from public.stream_ingest_v2 where created_at >= v_since and dispute_status <> 'none'),
    'reconciliation', (
      select coalesce(jsonb_agg(row_to_json(r) order by r.day desc), '[]'::jsonb)
      from (select * from public.v2_shadow_reconciliation where day >= v_since::date) r)
  );
  return v;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- G. 권한
-- ─────────────────────────────────────────────────────────────────────
do $$
declare fn text;
begin
  -- 공개(익명 포함) 기록 경로
  foreach fn in array array[
    'public.get_streaming_v2_flag()',
    'public.start_stream_session_v2(uuid,text,text,text)',
    'public.verify_stream_heartbeat_v2(text,numeric,boolean,numeric,boolean,text)',
    'public.record_stream_event_v2(uuid,text,text,text,text,text,text,numeric,uuid,uuid,uuid,uuid,uuid,numeric,boolean,text,text,text,boolean,text,text,jsonb)'
  ] loop
    execute format('revoke execute on function %s from public;', fn);
    execute format('grant  execute on function %s to anon, authenticated;', fn);
  end loop;
  -- 관리자 전용
  foreach fn in array array[
    'public.flag_stream_v2(bigint,text,text)',
    'public.admin_stream_v2_overview(integer)'
  ] loop
    execute format('revoke execute on function %s from public, anon;', fn);
    execute format('grant  execute on function %s to authenticated;', fn);
  end loop;
end $$;

comment on table public.stream_ingest_v2 is
  'ALGO-2A — Streaming v2 shadow raw. record_stream_event_v2 로만 기록. 정산/차트 미사용(관측). Raw→Verified→Eligible→Settlement 뷰 체인의 기반.';
comment on view public.v2_shadow_reconciliation is
  'ALGO-2A — v1(stream_events) vs v2 일별 대사. 정산 전환(ALGO-3) 판단용.';
