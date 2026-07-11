-- 0465 — Phase AI-MUSIC-2: Intelligent Playlist Generation & Optimization
--
-- 목적:
--   AI-MUSIC-1(0464)의 Store/Track Profile · Compatibility · Recommendation · Discovery 위에, 실제로
--   Playlist 를 *생성* 하는 빌더 계층을 얹는다. 생성/최적화/시뮬레이션 판정은 전부 클라이언트 규칙 엔진
--   (src/lib/aiPlaylist)에서 수행하며, 이 migration 은 (1) 생성된 Playlist 제안/후보/시뮬레이션을 저장할
--   신규 격리 테이블, (2) 빌더 입력(최근 7일 재생 = fatigue 신호) 조회 RPC + 제안/비교/시뮬레이션 기록 RPC
--   를 제공한다. 실제 LLM/생성형 AI 없음.
--
-- 안전 (절대):
--   • Additive Only. 신규 테이블 3 + 신규 RPC. 기존 테이블/뷰/RLS/데이터/정산/노출/Playlist·Queue·Player
--     로직 무변경. playback_events_v2 / tracks 는 READ-ONLY 참조만.
--   • Production Apply 금지. Preview / rollback-txn 검증 전용. 운영 head 는 0453 유지.
--   • AI는 제안(Simulation) 만. 어떤 RPC 도 실제 Playlist/Queue 를 생성·배포·재생하거나 운영 정책을 실행하지
--     않는다. 생성된 Playlist 는 운영자 승인 전까지 제안 스냅샷으로만 저장된다.
--   • Security Definer + _is_super_admin() 게이트 + search_path 고정 + 파라미터 바인딩 + row 상한.

-- ─────────────────────────────────────────────────────────────────────
-- 1) AI 생성 산출물 저장 테이블 (신규, 격리 — 기존 데이터와 분리, 자동 배포 없음)
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.ai_generated_playlists (
  id            uuid primary key default gen_random_uuid(),
  store_id      uuid,
  store_type    text,
  strategy      text not null default 'BALANCED',
  time_slot     text,
  track_ids     jsonb not null default '[]'::jsonb,   -- 정렬된 track id 배열(제안 순서)
  track_count   int  not null default 0,
  diversity     numeric,
  fatigue_risk  numeric,
  curve_fit     numeric,
  confidence    text,
  energy_curve  jsonb not null default '[]'::jsonb,
  explain       jsonb not null default '[]'::jsonb,   -- per-track 설명 factor 스냅샷
  notes         jsonb not null default '[]'::jsonb,
  created_by    uuid,
  created_at    timestamptz not null default now()
);
comment on table public.ai_generated_playlists is 'AI-MUSIC-2 생성된 Playlist 제안 스냅샷(Simulation Only). 실제 Playlist/Queue 아님 — 운영자 승인 전 배포 없음.';
create index if not exists agp_store_idx on public.ai_generated_playlists (store_id, created_at desc);

create table if not exists public.ai_playlist_candidates (
  id             uuid primary key default gen_random_uuid(),
  store_id       uuid,
  comparison_id  uuid not null default gen_random_uuid(),   -- A/B/C 한 묶음 식별
  label          text not null default 'A',
  strategy       text not null default 'BALANCED',
  score          numeric,
  is_best        boolean not null default false,
  metrics        jsonb not null default '{}'::jsonb,
  created_by     uuid,
  created_at     timestamptz not null default now()
);
comment on table public.ai_playlist_candidates is 'AI-MUSIC-2 Playlist 후보 비교 스냅샷(A/B/C → Best). 자동 배포 없음.';
create index if not exists apc_cmp_idx on public.ai_playlist_candidates (comparison_id, created_at desc);
create index if not exists apc_store_idx on public.ai_playlist_candidates (store_id, created_at desc);

create table if not exists public.ai_playlist_simulations (
  id                    uuid primary key default gen_random_uuid(),
  store_id              uuid,
  playlist_id           uuid,                 -- ai_generated_playlists.id (soft ref, 격리 유지)
  predicted_skip        numeric,
  predicted_completion  numeric,
  diversity             numeric,
  fatigue_risk          numeric,
  mean_compatibility    numeric,
  band                  text,
  confidence            text,
  notes                 jsonb not null default '[]'::jsonb,
  created_by            uuid,
  created_at            timestamptz not null default now()
);
comment on table public.ai_playlist_simulations is 'AI-MUSIC-2 Playlist 시뮬레이션 스냅샷(예상 Skip/Complete/Diversity/Fatigue/Compat). 예측 전용.';
create index if not exists aps_store_idx on public.ai_playlist_simulations (store_id, created_at desc);

-- RLS: super-admin read; writes via RPC only.
do $$ declare t text;
begin
  foreach t in array array['ai_generated_playlists','ai_playlist_candidates','ai_playlist_simulations'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('drop policy if exists %I on public.%I', t||'_super_admin_read', t);
    execute format('create policy %I on public.%I for select using (public._is_super_admin())', t||'_super_admin_read', t);
    execute format('revoke insert, update, delete on public.%I from authenticated, anon', t);
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────────────
-- 2) Builder inputs — 최근 N일(기본 7) 매장별 트랙 재생 수(= fatigue 신호). READ-ONLY.
--    (Store/Track Profile · Compatibility 입력은 AI-MUSIC-1 RPC 를 재사용; 여기선 fatigue 신호만 제공.)
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_ai_playlist_builder(p_store uuid, p_days int default 7, p_limit int default 500)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_days int := least(greatest(coalesce(p_days,7),1),90); v_limit int := least(greatest(coalesce(p_limit,500),1),2000); v jsonb; v_total int;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  if p_store is null then raise exception 'store required'; end if;
  with rec as (
    select track_id, count(*) c
    from public.playback_events_v2
    where business_id = p_store and track_id is not null and created_at >= now() - make_interval(days => v_days)
    group by track_id order by count(*) desc limit v_limit
  )
  select coalesce(jsonb_object_agg(track_id::text, c), '{}'::jsonb), coalesce(sum(c),0) into v, v_total from rec;
  return jsonb_build_object('ok', true, 'windowDays', v_days, 'recentPlays', v, 'totalRecentPlays', v_total,
    'note', 'fatigue 신호(최근 재생수)만 제공 — 실제 빌드는 클라이언트 규칙 엔진에서 수행, 자동 배포 없음');
end; $$;
revoke execute on function public.admin_ai_playlist_builder(uuid,int,int) from public;
do $$ begin begin grant execute on function public.admin_ai_playlist_builder(uuid,int,int) to authenticated; exception when undefined_object then null; end; end $$;

-- ─────────────────────────────────────────────────────────────────────
-- 3) Generated playlist candidates — 저장된 생성 제안 목록. READ-ONLY.
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_ai_playlist_candidates(p_store uuid default null, p_limit int default 50)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb; v_limit int := least(greatest(coalesce(p_limit,50),1),200);
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  select jsonb_build_object('ok', true, 'playlists', coalesce((
    select jsonb_agg(jsonb_build_object('id', g.id, 'storeId', g.store_id, 'storeType', g.store_type,
      'strategy', g.strategy, 'timeSlot', g.time_slot, 'trackCount', g.track_count, 'diversity', g.diversity,
      'fatigueRisk', g.fatigue_risk, 'curveFit', g.curve_fit, 'confidence', g.confidence, 'trackIds', g.track_ids,
      'notes', g.notes, 'createdAt', to_char(g.created_at,'YYYY-MM-DD"T"HH24:MI:SS"Z"')) order by g.created_at desc)
    from (select * from public.ai_generated_playlists
          where (p_store is null or store_id = p_store) order by created_at desc limit v_limit) g
  ), '[]'::jsonb)) into v;
  return v;
end; $$;
revoke execute on function public.admin_ai_playlist_candidates(uuid,int) from public;
do $$ begin begin grant execute on function public.admin_ai_playlist_candidates(uuid,int) to authenticated; exception when undefined_object then null; end; end $$;

-- ─────────────────────────────────────────────────────────────────────
-- 4) Record a generated playlist proposal (advisory — 배포/재생 없음).
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.record_ai_generated_playlist(
  p_store uuid, p_store_type text, p_strategy text, p_time_slot text, p_track_ids jsonb, p_track_count int,
  p_diversity numeric, p_fatigue_risk numeric, p_curve_fit numeric, p_confidence text, p_energy_curve jsonb,
  p_explain jsonb, p_notes jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  insert into public.ai_generated_playlists (store_id, store_type, strategy, time_slot, track_ids, track_count,
    diversity, fatigue_risk, curve_fit, confidence, energy_curve, explain, notes, created_by)
    values (p_store, left(coalesce(p_store_type,''),80), left(coalesce(p_strategy,'BALANCED'),40), left(coalesce(p_time_slot,''),40),
      coalesce(p_track_ids,'[]'::jsonb), greatest(coalesce(p_track_count,0),0), p_diversity, p_fatigue_risk, p_curve_fit,
      left(coalesce(p_confidence,''),24), coalesce(p_energy_curve,'[]'::jsonb), coalesce(p_explain,'[]'::jsonb), coalesce(p_notes,'[]'::jsonb), auth.uid())
    returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'note', 'advisory proposal stored — not deployed/played');
end; $$;
revoke execute on function public.record_ai_generated_playlist(uuid,text,text,text,jsonb,int,numeric,numeric,numeric,text,jsonb,jsonb,jsonb) from public;
do $$ begin begin grant execute on function public.record_ai_generated_playlist(uuid,text,text,text,jsonb,int,numeric,numeric,numeric,text,jsonb,jsonb,jsonb) to authenticated; exception when undefined_object then null; end; end $$;

-- ─────────────────────────────────────────────────────────────────────
-- 5) Record a candidate comparison (A/B/C → Best) (advisory).
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_ai_playlist_compare(p_store uuid, p_candidates jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_cmp uuid := gen_random_uuid(); v_row jsonb; v_n int := 0;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  if p_candidates is null or jsonb_typeof(p_candidates) <> 'array' then raise exception 'candidates array required'; end if;
  for v_row in select * from jsonb_array_elements(p_candidates) loop
    insert into public.ai_playlist_candidates (store_id, comparison_id, label, strategy, score, is_best, metrics, created_by)
      values (p_store, v_cmp, left(coalesce(v_row->>'label','A'),8), left(coalesce(v_row->>'strategy','BALANCED'),40),
        (v_row->>'score')::numeric, coalesce((v_row->>'isBest')::boolean, false), coalesce(v_row->'metrics','{}'::jsonb), auth.uid());
    v_n := v_n + 1;
    exit when v_n >= 12;   -- row cap
  end loop;
  return jsonb_build_object('ok', true, 'comparisonId', v_cmp, 'stored', v_n, 'note', 'advisory comparison stored — not deployed');
end; $$;
revoke execute on function public.admin_ai_playlist_compare(uuid,jsonb) from public;
do $$ begin begin grant execute on function public.admin_ai_playlist_compare(uuid,jsonb) to authenticated; exception when undefined_object then null; end; end $$;

-- ─────────────────────────────────────────────────────────────────────
-- 6) Record a playlist simulation snapshot (advisory — 예측 전용).
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_ai_playlist_simulation(
  p_store uuid, p_playlist uuid, p_predicted_skip numeric, p_predicted_completion numeric, p_diversity numeric,
  p_fatigue_risk numeric, p_mean_compatibility numeric, p_band text, p_confidence text, p_notes jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  insert into public.ai_playlist_simulations (store_id, playlist_id, predicted_skip, predicted_completion, diversity,
    fatigue_risk, mean_compatibility, band, confidence, notes, created_by)
    values (p_store, p_playlist, p_predicted_skip, p_predicted_completion, p_diversity, p_fatigue_risk, p_mean_compatibility,
      left(coalesce(p_band,''),24), left(coalesce(p_confidence,''),24), coalesce(p_notes,'[]'::jsonb), auth.uid())
    returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'note', 'simulation snapshot stored — prediction only, nothing deployed');
end; $$;
revoke execute on function public.admin_ai_playlist_simulation(uuid,uuid,numeric,numeric,numeric,numeric,numeric,text,text,jsonb) from public;
do $$ begin begin grant execute on function public.admin_ai_playlist_simulation(uuid,uuid,numeric,numeric,numeric,numeric,numeric,text,text,jsonb) to authenticated; exception when undefined_object then null; end; end $$;

-- ─────────────────────────────────────────────────────────────────────
-- ROLLBACK (참고용 — Preview/rollback-txn 검증 전용. Production apply 금지):
--   drop function if exists public.admin_ai_playlist_simulation(uuid,uuid,numeric,numeric,numeric,numeric,numeric,text,text,jsonb);
--   drop function if exists public.admin_ai_playlist_compare(uuid,jsonb);
--   drop function if exists public.record_ai_generated_playlist(uuid,text,text,text,jsonb,int,numeric,numeric,numeric,text,jsonb,jsonb,jsonb);
--   drop function if exists public.admin_ai_playlist_candidates(uuid,int);
--   drop function if exists public.admin_ai_playlist_builder(uuid,int,int);
--   drop table if exists public.ai_playlist_simulations;
--   drop table if exists public.ai_playlist_candidates;
--   drop table if exists public.ai_generated_playlists;
-- 신규(0465) 테이블 3 + 함수 5. 롤백은 순수 DROP. 기존 데이터/스키마/RLS/정산/노출/Playlist·Queue·Player 로직 영향 없음.
-- playback_events_v2 / tracks 는 READ-ONLY.
