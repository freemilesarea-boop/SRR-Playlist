-- 0232 — Placement risk flag (관찰 모드)
--
-- 0231 의 -1000 자동 차단 정책 보류 (taxonomy-v1 precision 검증 전).
-- 대신: 부적합 의심 배치를 placement_risk_flags 에 기록 → 관리자가 큐에서 승인/유지/삭제 선택.
--
-- 변경:
--   1. auto_place_track() 0114 원본으로 복원 (-1000 페널티 제거)
--   2. placement_risk_flags 테이블 신설
--   3. admin_flag_placement_risks — 의심 배치 자동 검출 + 플래그 생성 (멱등, dryRun 지원)
--   4. admin_list_placement_risks — pending 큐 조회
--   5. admin_decide_placement_risk — 승인/유지/삭제 선택
--
-- 0231 의 genre_block_rules 시드 데이터와 ai_store_profiles.blocked_genres 보강은
-- 유지 (CLAP recommendation / fit scoring 에 인풋 제공, 자동 차단은 안 함).

-- ===== 1. auto_place_track 원본 복원 =====
create or replace function public.auto_place_track(p_track_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  t record; a record; r record;
  v_artist_key text;
  v_threshold numeric := 30; v_max int := 5; v_artist_cap int := 3;
  v_placed int := 0; v_cand int := 0; v_log jsonb := '[]'::jsonb;
begin
  select * into t from public.tracks where id = p_track_id;
  if t.id is null then return jsonb_build_object('ok', false, 'reason', 'track_not_found'); end if;
  if coalesce(t.audio_url,'') = '' or not (t.release_status = 'released' or t.release_status is null) then
    insert into public.auto_placement_runs(track_id,status,candidate_count,placed_count,log_json)
      values (p_track_id,'skipped',0,0, jsonb_build_object('reason','not_released_or_no_audio'));
    return jsonb_build_object('ok', true, 'status', 'skipped');
  end if;

  perform public.derive_track_analysis(p_track_id);
  select * into a from public.track_analysis where track_id = p_track_id;
  v_artist_key := lower(btrim(coalesce(t.artist,'')));
  select count(*) into v_cand from public.playlists where is_auto_generated = true and status = 'released';

  for r in
    select p.id, p.title,
      (
        coalesce(case when (a.genre is not null and exists(select 1 from unnest(p.genre_tags) g where lower(g)=lower(a.genre)))
                       or exists(select 1 from unnest(p.genre_tags) g where lower(g) = any(select lower(x) from unnest(coalesce(t.genre_tags,'{}')) x))
                  then 25 else 0 end,0)
      + coalesce((select count(*) from unnest(p.mood_tags) m where m = any(a.mood_tags) or lower(coalesce(t.mood,'')) = lower(m)) * 15, 0)
      + coalesce(case when p.business_category is not null and (t.suitable_store = p.business_category or p.business_category = any(coalesce(t.business_tags,'{}'))) then 20 else 0 end,0)
      + coalesce(case when p.daypart is not null and (p.daypart = any(coalesce(t.time_slots,'{}')) or 'all' = any(coalesce(t.time_slots,'{}'))) then 10 else 0 end,0)
      + coalesce(case when p.bpm_min is not null and a.bpm is not null then (case when a.bpm between p.bpm_min and coalesce(p.bpm_max,9999) then 10 else -10 end) else 0 end,0)
      + coalesce(case when p.energy_min is not null and a.energy is not null then (case when a.energy between p.energy_min and coalesce(p.energy_max,100) then 10 else -5 end) else 0 end,0)
      + coalesce(case when p.vocal_preference='vocal' then (case when coalesce(t.instrumental,false) then -10 else 10 end)
                      when p.vocal_preference='instrumental' then (case when coalesce(t.instrumental,false) then 10 else -10 end)
                      else 0 end,0)
      + coalesce(a.quality_score - 70, 0)
      + case when t.created_at >= now() - interval '30 days' then 5 else 0 end
      )::numeric as score
    from public.playlists p
    where p.is_auto_generated = true and p.status = 'released'
    order by score desc
  loop
    exit when v_placed >= v_max or r.score < v_threshold;
    if v_artist_key <> '' and (
      select count(*) from public.playlist_tracks pt join public.tracks tt on tt.id = pt.track_id
      where pt.playlist_id = r.id and lower(btrim(coalesce(tt.artist,''))) = v_artist_key
    ) >= v_artist_cap then
      v_log := v_log || jsonb_build_object('playlist', r.title, 'score', round(r.score,1), 'skip', 'artist_cap');
      continue;
    end if;
    begin
      insert into public.playlist_tracks(playlist_id, track_id, order_index, match_score, placement_reason, placed_by)
      values (r.id, p_track_id,
        coalesce((select max(order_index)+1 from public.playlist_tracks where playlist_id = r.id), 0),
        round(r.score,1),
        format('자동 배치 (genre/mood/업종/시간 적합 · score %s)', round(r.score,1)), 'auto');
      v_placed := v_placed + 1;
      v_log := v_log || jsonb_build_object('playlist', r.title, 'score', round(r.score,1), 'placed', true);
    exception when unique_violation then
      v_log := v_log || jsonb_build_object('playlist', r.title, 'score', round(r.score,1), 'skip', 'already_placed');
    end;
  end loop;

  insert into public.auto_placement_runs(track_id,status,candidate_count,placed_count,log_json)
  values (p_track_id, case when v_placed > 0 then 'placed' else 'review' end, v_cand, v_placed, v_log);
  return jsonb_build_object('ok', true, 'placed', v_placed, 'candidates', v_cand,
    'status', case when v_placed > 0 then 'placed' else 'review' end);
end; $$;

-- ===== 2. placement_risk_flags 테이블 =====
create table if not exists public.placement_risk_flags (
  id bigserial primary key,
  playlist_id uuid not null references public.playlists(id) on delete cascade,
  track_id uuid not null references public.tracks(id) on delete cascade,
  risk_type text not null,                  -- 'genre_mismatch' (다른 risk_type 도 추후 확장)
  risk_reason text not null,                -- 사람이 읽는 사유 (예: "main_genre=Rock in 호텔")
  business_category text,
  main_genre text,
  matched_pattern text,                     -- 매치된 block pattern (예: 'rock')
  match_score numeric,                      -- placement 의 점수 (참고용)
  detected_at timestamptz not null default now(),
  detected_by_run_id uuid,                  -- batch 식별
  decision text not null default 'pending', -- 'pending' | 'approve' | 'keep' | 'remove'
  decided_at timestamptz,
  decided_by uuid references public.users(id) on delete set null,
  decision_note text,
  unique (playlist_id, track_id, risk_type)
);

create index if not exists placement_risk_flags_pending_idx
  on public.placement_risk_flags(detected_at desc) where decision = 'pending';
create index if not exists placement_risk_flags_track_idx
  on public.placement_risk_flags(track_id);

alter table public.placement_risk_flags enable row level security;
drop policy if exists placement_risk_flags_admin_read on public.placement_risk_flags;
create policy placement_risk_flags_admin_read on public.placement_risk_flags for select
  using (exists(select 1 from public.users u where u.id = auth.uid() and u.role = 'admin'));

-- ===== 3. admin_flag_placement_risks =====
-- 부적합 의심 placement 들에 대해 placement_risk_flags 행 자동 생성.
-- 멱등 (UNIQUE 충돌 시 skip). dryRun=true 면 대상만 반환.
create or replace function public.admin_flag_placement_risks(
  p_dry_run boolean default false,
  p_business_patterns text[] default array['호텔','라운지','와인바','카페 라운지','칵테일바','미용실'],
  p_genre_patterns text[] default array['rock','metal','punk','hard rock','hardstyle','hardcore','trap','drill'],
  p_run_id uuid default gen_random_uuid()
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_candidates jsonb;
  v_inserted int := 0;
begin
  if not exists (select 1 from public.users u where u.id = auth.uid() and u.role='admin') then
    raise exception 'unauthorized';
  end if;

  with cands as (
    select pt.playlist_id, pt.track_id, p.title as playlist_title, t.title as track_title,
           t.artist, t.main_genre, p.business_category, pt.match_score,
           (select pat from unnest(p_genre_patterns) pat
            where lower(coalesce(t.main_genre,'')) like '%' || lower(pat) || '%'
               or lower(coalesce(t.sub_genre,'')) like '%' || lower(pat) || '%'
            limit 1) as matched_pattern
    from public.playlist_tracks pt
    join public.playlists p on p.id = pt.playlist_id
    join public.tracks t on t.id = pt.track_id
    where t.removed_at is null
      and p.business_category = any(p_business_patterns)
      and exists(select 1 from unnest(p_genre_patterns) pat
                 where lower(coalesce(t.main_genre,'')) like '%' || lower(pat) || '%'
                    or lower(coalesce(t.sub_genre,'')) like '%' || lower(pat) || '%')
      -- allow 예외 패턴 매치 시 의심 대상에서 제외
      and not exists (
        select 1 from public.genre_block_rules gbr
        where gbr.business_category = p.business_category
          and gbr.block_kind = 'allow'
          and (
            position(lower(gbr.genre_pattern) in lower(coalesce(t.main_genre,''))) > 0
            or position(lower(gbr.genre_pattern) in lower(coalesce(t.sub_genre,''))) > 0
          )
      )
  )
  select coalesce(jsonb_agg(to_jsonb(c) order by c.playlist_title, c.match_score desc nulls last), '[]'::jsonb)
    into v_candidates from cands c;

  if p_dry_run then
    return jsonb_build_object(
      'ok', true, 'dryRun', true,
      'candidate_count', jsonb_array_length(v_candidates),
      'candidates', v_candidates
    );
  end if;

  -- 실제 플래그 INSERT (UNIQUE 충돌 시 자연 skip)
  with cands as (
    select pt.playlist_id, pt.track_id, p.title as playlist_title, t.main_genre,
           p.business_category, pt.match_score,
           (select pat from unnest(p_genre_patterns) pat
            where lower(coalesce(t.main_genre,'')) like '%' || lower(pat) || '%'
               or lower(coalesce(t.sub_genre,'')) like '%' || lower(pat) || '%'
            limit 1) as matched_pattern
    from public.playlist_tracks pt
    join public.playlists p on p.id = pt.playlist_id
    join public.tracks t on t.id = pt.track_id
    where t.removed_at is null
      and p.business_category = any(p_business_patterns)
      and exists(select 1 from unnest(p_genre_patterns) pat
                 where lower(coalesce(t.main_genre,'')) like '%' || lower(pat) || '%'
                    or lower(coalesce(t.sub_genre,'')) like '%' || lower(pat) || '%')
      and not exists (
        select 1 from public.genre_block_rules gbr
        where gbr.business_category = p.business_category
          and gbr.block_kind = 'allow'
          and (
            position(lower(gbr.genre_pattern) in lower(coalesce(t.main_genre,''))) > 0
            or position(lower(gbr.genre_pattern) in lower(coalesce(t.sub_genre,''))) > 0
          )
      )
  ),
  ins as (
    insert into public.placement_risk_flags (
      playlist_id, track_id, risk_type, risk_reason,
      business_category, main_genre, matched_pattern, match_score,
      detected_by_run_id
    )
    select c.playlist_id, c.track_id, 'genre_mismatch',
      format('main_genre=%s in %s (pattern: %s, score %s)',
             c.main_genre, c.business_category, c.matched_pattern, c.match_score),
      c.business_category, c.main_genre, c.matched_pattern, c.match_score, p_run_id
    from cands c
    on conflict (playlist_id, track_id, risk_type) do nothing
    returning 1
  )
  select count(*) into v_inserted from ins;

  return jsonb_build_object(
    'ok', true, 'dryRun', false,
    'candidate_count', jsonb_array_length(v_candidates),
    'inserted_count', v_inserted,
    'run_id', p_run_id
  );
end; $$;
revoke all on function public.admin_flag_placement_risks(boolean, text[], text[], uuid) from public, anon;
grant execute on function public.admin_flag_placement_risks(boolean, text[], text[], uuid) to authenticated, service_role;

-- ===== 4. admin_list_placement_risks =====
create or replace function public.admin_list_placement_risks(
  p_status text default 'pending',
  p_limit int default 100
)
returns table (
  flag_id bigint, playlist_id uuid, playlist_title text, business_category text,
  track_id uuid, title text, artist text,
  main_genre text, sub_genre text, mood text, suitable_store text,
  matched_pattern text, match_score numeric, risk_reason text,
  detected_at timestamptz, decision text, decided_at timestamptz, decision_note text,
  ai_pred_main_genre text, ai_pred_confidence numeric
)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if not exists (select 1 from public.users u where u.id = auth.uid() and u.role='admin') then
    raise exception 'unauthorized';
  end if;

  return query
  select
    f.id, f.playlist_id, p.title, f.business_category,
    f.track_id, t.title, t.artist,
    t.main_genre, t.sub_genre, t.mood, t.suitable_store,
    f.matched_pattern, f.match_score, f.risk_reason,
    f.detected_at, f.decision, f.decided_at, f.decision_note,
    pr.predicted_main_genre, pr.genre_confidence
  from public.placement_risk_flags f
  join public.playlists p on p.id = f.playlist_id
  join public.tracks t on t.id = f.track_id
  left join public.track_ai_predictions pr
    on pr.track_id = f.track_id and pr.model_version = 'taxonomy-v1'
  where (p_status = 'all' or f.decision = p_status)
  order by f.detected_at desc
  limit p_limit;
end; $$;
revoke all on function public.admin_list_placement_risks(text, int) from public, anon;
grant execute on function public.admin_list_placement_risks(text, int) to authenticated, service_role;

-- ===== 5. admin_decide_placement_risk =====
-- decision ∈ {'approve','keep','remove'}
--   approve  : 의심 풀고 학습 데이터로 표시 (배치 유지)
--   keep     : 의심 풀지만 학습 데이터로 표시 안 함 (배치 유지)
--   remove   : placement_tracks 에서 실제 삭제 + 플래그 'remove' 마크
create or replace function public.admin_decide_placement_risk(
  p_flag_id bigint, p_decision text, p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := auth.uid();
  v_flag record;
begin
  if not exists (select 1 from public.users u where u.id = v_admin and u.role='admin') then
    raise exception 'unauthorized';
  end if;
  if p_decision not in ('approve','keep','remove') then
    raise exception 'invalid decision: %', p_decision;
  end if;

  select * into v_flag from public.placement_risk_flags where id = p_flag_id;
  if not found then raise exception 'flag not found: %', p_flag_id; end if;
  if v_flag.decision <> 'pending' then
    raise exception 'already decided: %', v_flag.decision;
  end if;

  if p_decision = 'remove' then
    delete from public.playlist_tracks
    where playlist_id = v_flag.playlist_id and track_id = v_flag.track_id;
  end if;

  update public.placement_risk_flags
  set decision = p_decision, decided_at = now(), decided_by = v_admin, decision_note = p_note
  where id = p_flag_id;

  return jsonb_build_object('ok', true, 'flag_id', p_flag_id, 'decision', p_decision);
end; $$;
revoke all on function public.admin_decide_placement_risk(bigint, text, text) from public, anon;
grant execute on function public.admin_decide_placement_risk(bigint, text, text) to authenticated, service_role;

-- ===== 6. 통계 RPC =====
create or replace function public.admin_placement_risk_status()
returns table (
  pending_count bigint, approved_count bigint, kept_count bigint, removed_count bigint,
  last_run_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select
    count(*) filter (where decision = 'pending'),
    count(*) filter (where decision = 'approve'),
    count(*) filter (where decision = 'keep'),
    count(*) filter (where decision = 'remove'),
    max(detected_at)
  from public.placement_risk_flags;
$$;
revoke all on function public.admin_placement_risk_status() from public, anon;
grant execute on function public.admin_placement_risk_status() to authenticated, service_role;
