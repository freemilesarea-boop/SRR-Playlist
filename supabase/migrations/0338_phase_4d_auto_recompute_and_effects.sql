-- 0338 — Phase 4d: 가중치 적용 후 fit_score 자동 재계산 + segment 효과 측정 (X6.71)
--
-- 배경:
--   Phase 4c 까지 가중치 변경되어도 기존 fit_score 는 변하지 않음 (recompute 필요).
--   운영자가 적합도 탭 가서 수동 recompute 클릭해야 효과 확인 가능 → 자동화.
--   또한 가중치 변경이 실제 사용자 행동을 개선했는지 알 길이 없음 → before/after 측정.
--
-- 변경:
--   1) fit_score_recompute_jobs 큐 + 트리거 (base config + overrides 변경 시 enqueue)
--   2) process_fit_recompute_jobs() — 배치 처리 (max 30s budget)
--   3) cron_process_fit_recompute_queue() — pg_cron 2분 간격
--   4) ai_weight_effect_snapshots 테이블 — 가중치 적용 전/후 집계 stats
--   5) admin_take_weight_effect_snapshot(suggestion_id, type) RPC
--   6) admin_decide_weight_regression — approve 시 'before' snapshot 자동
--   7) cron_take_pending_after_snapshots() — 적용 후 7일 경과 시 'after' snapshot 자동
--   8) pg_cron daily after-snapshot
--   9) admin_list_weight_effects(suggestion_id) RPC


-- =============================================================================
-- 1. 큐 테이블
-- =============================================================================
create table if not exists public.fit_score_recompute_jobs (
  id uuid primary key default gen_random_uuid(),
  scope text not null,                 -- 'base' | 'override:<store_type>/<daypart>'
  store_type text,                     -- override 시 매장 slug (NULL = 전체)
  daypart text,                        -- override 시 시간대 (NULL = 전체)
  status text not null default 'pending'
    check (status in ('pending','running','done','error')),
  enqueued_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  processed_count int default 0,
  total_count int,
  error text,
  trigger_source text                  -- 'config_update' | 'override_insert' | 'override_update' | 'override_delete' | 'manual'
);
create index if not exists fit_recompute_jobs_pending_idx
  on public.fit_score_recompute_jobs (enqueued_at) where status='pending';
create index if not exists fit_recompute_jobs_recent_idx
  on public.fit_score_recompute_jobs (enqueued_at desc);

alter table public.fit_score_recompute_jobs enable row level security;
drop policy if exists fit_recompute_jobs_admin_read on public.fit_score_recompute_jobs;
create policy fit_recompute_jobs_admin_read on public.fit_score_recompute_jobs for select
  using (exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin'));


-- =============================================================================
-- 2. enqueue 헬퍼 (dedup — 동일 scope pending 있으면 skip)
-- =============================================================================
create or replace function public._enqueue_fit_recompute(
  p_scope text, p_store_type text, p_daypart text, p_source text
)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_id uuid;
begin
  -- 동일 scope pending 있으면 dedup
  select id into v_id from public.fit_score_recompute_jobs
   where status='pending' and scope = p_scope
   limit 1;
  if v_id is not null then return v_id; end if;

  insert into public.fit_score_recompute_jobs (scope, store_type, daypart, trigger_source)
  values (p_scope, p_store_type, p_daypart, p_source)
  returning id into v_id;
  return v_id;
end; $$;


-- =============================================================================
-- 3. 트리거 — base config + overrides 변경 시 enqueue
-- =============================================================================
create or replace function public._tg_enqueue_fit_recompute_base()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  -- 가중치 4개 중 하나라도 변경된 경우만
  if old.fit_audio_w is distinct from new.fit_audio_w
     or old.fit_meta_w is distinct from new.fit_meta_w
     or old.fit_behavior_w is distinct from new.fit_behavior_w
     or old.fit_penalty_w is distinct from new.fit_penalty_w then
    perform public._enqueue_fit_recompute('base', null, null, 'config_update');
  end if;
  return new;
end; $$;

drop trigger if exists tg_enqueue_fit_recompute_base on public.ai_scoring_config;
create trigger tg_enqueue_fit_recompute_base
  after update on public.ai_scoring_config
  for each row execute function public._tg_enqueue_fit_recompute_base();


create or replace function public._tg_enqueue_fit_recompute_override()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  v_store text;
  v_dp text;
  v_scope text;
  v_source text;
begin
  if tg_op = 'DELETE' then
    v_store := old.store_type; v_dp := old.daypart; v_source := 'override_delete';
  else
    v_store := new.store_type; v_dp := new.daypart;
    v_source := case tg_op when 'INSERT' then 'override_insert' else 'override_update' end;
  end if;
  v_scope := 'override:' || coalesce(v_store, '*') || '/' || coalesce(v_dp, '*');
  perform public._enqueue_fit_recompute(v_scope, v_store, v_dp, v_source);
  if tg_op = 'DELETE' then return old; else return new; end if;
end; $$;

drop trigger if exists tg_enqueue_fit_recompute_override on public.ai_scoring_config_overrides;
create trigger tg_enqueue_fit_recompute_override
  after insert or update or delete on public.ai_scoring_config_overrides
  for each row execute function public._tg_enqueue_fit_recompute_override();


-- =============================================================================
-- 4. process_fit_recompute_jobs — 배치 처리
--    한 번 호출 시 1개 pending 작업 처리 (다음 cron 틱에서 다음 작업)
-- =============================================================================
create or replace function public.process_fit_recompute_jobs(p_max_pairs int default 5000)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_job record;
  v_processed int := 0;
  v_total int := 0;
  v_pair record;
begin
  -- 1개 pending 작업 선점 (FOR UPDATE SKIP LOCKED)
  select * into v_job from public.fit_score_recompute_jobs
   where status='pending'
   order by enqueued_at
   limit 1
   for update skip locked;

  if v_job.id is null then
    return jsonb_build_object('ok', true, 'job_processed', false, 'reason', 'no_pending');
  end if;

  update public.fit_score_recompute_jobs
     set status='running', started_at=now()
   where id = v_job.id;

  begin
    if v_job.scope = 'base' then
      -- base config 변경 → 모든 fit_scores 재계산 (배치 cap)
      select count(*) into v_total from public.playlist_track_fit_scores where status='active';
      for v_pair in
        select playlist_id, track_id from public.playlist_track_fit_scores
         where status='active'
         order by updated_at nulls first
         limit p_max_pairs
      loop
        perform public._ai_compute_fit(v_pair.playlist_id, v_pair.track_id);
        v_processed := v_processed + 1;
      end loop;
    else
      -- override → segment 매칭 playlists 만
      with target_playlists as (
        select p.id from public.playlists p
        where (v_job.store_type is null
               or public.normalize_store_label(p.business_category) = v_job.store_type)
          and (v_job.daypart is null or p.daypart = v_job.daypart)
      )
      select count(*) into v_total
      from public.playlist_track_fit_scores fs
      join target_playlists tp on tp.id = fs.playlist_id
      where fs.status='active';

      for v_pair in
        select fs.playlist_id, fs.track_id
        from public.playlist_track_fit_scores fs
        join (
          select p.id from public.playlists p
          where (v_job.store_type is null
                 or public.normalize_store_label(p.business_category) = v_job.store_type)
            and (v_job.daypart is null or p.daypart = v_job.daypart)
        ) tp on tp.id = fs.playlist_id
        where fs.status='active'
        order by fs.updated_at nulls first
        limit p_max_pairs
      loop
        perform public._ai_compute_fit(v_pair.playlist_id, v_pair.track_id);
        v_processed := v_processed + 1;
      end loop;
    end if;

    -- 처리량 < total 이면 작업 미완료 → pending 으로 복귀 (다음 cron 에서 이어서)
    if v_processed < v_total then
      update public.fit_score_recompute_jobs
         set status='pending',
             processed_count = coalesce(processed_count,0) + v_processed,
             total_count = v_total
       where id = v_job.id;
    else
      update public.fit_score_recompute_jobs
         set status='done', finished_at=now(),
             processed_count = coalesce(processed_count,0) + v_processed,
             total_count = v_total
       where id = v_job.id;
    end if;

  exception when others then
    update public.fit_score_recompute_jobs
       set status='error', finished_at=now(),
           processed_count = coalesce(processed_count,0) + v_processed,
           error = SQLERRM
     where id = v_job.id;
    raise;
  end;

  return jsonb_build_object(
    'ok', true,
    'job_processed', true,
    'job_id', v_job.id,
    'scope', v_job.scope,
    'processed', v_processed,
    'total', v_total,
    'remaining', greatest(0, v_total - v_processed)
  );
end; $$;

revoke execute on function public.process_fit_recompute_jobs(int) from public, anon;
grant execute on function public.process_fit_recompute_jobs(int) to authenticated, service_role;


-- =============================================================================
-- 5. cron wrapper
-- =============================================================================
create or replace function public.cron_process_fit_recompute_queue()
returns jsonb language plpgsql security definer set search_path to 'public' as $$
begin
  return public.process_fit_recompute_jobs(5000);
end; $$;
revoke execute on function public.cron_process_fit_recompute_queue() from public, anon;
grant execute on function public.cron_process_fit_recompute_queue() to service_role;


-- =============================================================================
-- 6. effect snapshots — 가중치 적용 전/후 집계
-- =============================================================================
create table if not exists public.ai_weight_effect_snapshots (
  id uuid primary key default gen_random_uuid(),
  suggestion_id uuid not null references public.ai_weight_regression_suggestions(id) on delete cascade,
  snapshot_type text not null check (snapshot_type in ('before','after')),
  taken_at timestamptz not null default now(),
  -- segment 식별 (suggestion 의 segment 와 동일)
  store_type text,
  daypart text,
  -- 집계 stats (NULL safe — 데이터 부족 시 NULL)
  affected_playlists int,
  affected_tracks int,
  avg_fit_score numeric,
  median_fit_score numeric,
  pct_above_70 numeric,         -- fit ≥70 비율 (%)
  pct_below_40 numeric,         -- fit <40 비율 (%)
  -- 실제 행동 신호 (track_behavior_scores window=30)
  avg_completion_rate numeric,
  avg_skip_rate numeric,
  behavior_sample_size int,     -- play_count ≥5 인 트랙 수
  -- 진단 jsonb (추가 신호용)
  details jsonb,
  unique (suggestion_id, snapshot_type)
);
create index if not exists ai_weight_effect_snapshots_sug_idx
  on public.ai_weight_effect_snapshots (suggestion_id);
create index if not exists ai_weight_effect_snapshots_after_pending_idx
  on public.ai_weight_effect_snapshots (taken_at)
  where snapshot_type = 'before';

alter table public.ai_weight_effect_snapshots enable row level security;
drop policy if exists weight_effect_admin_read on public.ai_weight_effect_snapshots;
create policy weight_effect_admin_read on public.ai_weight_effect_snapshots for select
  using (exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin'));


-- =============================================================================
-- 7. snapshot 계산 헬퍼
-- =============================================================================
create or replace function public._compute_weight_effect_snapshot(
  p_suggestion_id uuid,
  p_snapshot_type text
)
returns void language plpgsql security definer set search_path to 'public' as $$
declare
  v_sug record;
  v_store text;
  v_dp text;
  v_aff_playlists int;
  v_aff_tracks int;
  v_avg_fit numeric;
  v_median_fit numeric;
  v_pct_high numeric;
  v_pct_low numeric;
  v_avg_compl numeric;
  v_avg_skip numeric;
  v_behav_n int;
begin
  select * into v_sug from public.ai_weight_regression_suggestions where id = p_suggestion_id;
  if v_sug.id is null then return; end if;
  v_store := nullif(v_sug.suggestion->>'store_type', '');
  v_dp    := nullif(v_sug.suggestion->>'daypart', '');

  with target_playlists as (
    select p.id from public.playlists p
    where (v_store is null
           or public.normalize_store_label(p.business_category) = v_store)
      and (v_dp is null or p.daypart = v_dp)
  ),
  affected as (
    select fs.playlist_id, fs.track_id, fs.final_fit_score
    from public.playlist_track_fit_scores fs
    join target_playlists tp on tp.id = fs.playlist_id
    where fs.status='active'
  )
  select count(distinct playlist_id), count(*),
         avg(final_fit_score),
         percentile_cont(0.5) within group (order by final_fit_score),
         100.0 * count(*) filter (where final_fit_score >= 70) / nullif(count(*), 0),
         100.0 * count(*) filter (where final_fit_score <  40) / nullif(count(*), 0)
    into v_aff_playlists, v_aff_tracks, v_avg_fit, v_median_fit, v_pct_high, v_pct_low
    from affected;

  with target_playlists as (
    select p.id from public.playlists p
    where (v_store is null
           or public.normalize_store_label(p.business_category) = v_store)
      and (v_dp is null or p.daypart = v_dp)
  ),
  affected_behavior as (
    select distinct fs.track_id
    from public.playlist_track_fit_scores fs
    join target_playlists tp on tp.id = fs.playlist_id
    where fs.status='active'
  )
  select avg(b.completion_rate), avg(b.skip_rate), count(*)
    into v_avg_compl, v_avg_skip, v_behav_n
    from public.track_behavior_scores b
    join affected_behavior ab on ab.track_id = b.track_id
   where b.window_days = 30 and b.play_count >= 5;

  insert into public.ai_weight_effect_snapshots (
    suggestion_id, snapshot_type, store_type, daypart,
    affected_playlists, affected_tracks,
    avg_fit_score, median_fit_score, pct_above_70, pct_below_40,
    avg_completion_rate, avg_skip_rate, behavior_sample_size
  ) values (
    p_suggestion_id, p_snapshot_type, v_store, v_dp,
    v_aff_playlists, v_aff_tracks,
    round(coalesce(v_avg_fit, 0)::numeric, 2),
    round(coalesce(v_median_fit, 0)::numeric, 2),
    round(coalesce(v_pct_high, 0)::numeric, 1),
    round(coalesce(v_pct_low, 0)::numeric, 1),
    round(coalesce(v_avg_compl, 0)::numeric, 4),
    round(coalesce(v_avg_skip, 0)::numeric, 4),
    coalesce(v_behav_n, 0)
  )
  on conflict (suggestion_id, snapshot_type) do update set
    taken_at = now(),
    affected_playlists = excluded.affected_playlists,
    affected_tracks = excluded.affected_tracks,
    avg_fit_score = excluded.avg_fit_score,
    median_fit_score = excluded.median_fit_score,
    pct_above_70 = excluded.pct_above_70,
    pct_below_40 = excluded.pct_below_40,
    avg_completion_rate = excluded.avg_completion_rate,
    avg_skip_rate = excluded.avg_skip_rate,
    behavior_sample_size = excluded.behavior_sample_size;
end; $$;


-- =============================================================================
-- 8. admin_take_weight_effect_snapshot — 수동 트리거
-- =============================================================================
create or replace function public.admin_take_weight_effect_snapshot(
  p_suggestion_id uuid,
  p_snapshot_type text default 'after'
)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
begin
  if not exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin') then
    raise exception 'admin only';
  end if;
  if p_snapshot_type not in ('before','after') then
    raise exception 'snapshot_type must be before or after';
  end if;
  perform public._compute_weight_effect_snapshot(p_suggestion_id, p_snapshot_type);
  return jsonb_build_object('ok', true, 'suggestion_id', p_suggestion_id, 'type', p_snapshot_type);
end; $$;

revoke execute on function public.admin_take_weight_effect_snapshot(uuid, text) from public, anon;
grant execute on function public.admin_take_weight_effect_snapshot(uuid, text) to authenticated;


-- =============================================================================
-- 9. admin_decide_weight_regression 재정의 — approve 시 'before' snapshot 자동
-- =============================================================================
create or replace function public.admin_decide_weight_regression(
  p_id uuid, p_approve boolean, p_note text default null
)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid uuid := auth.uid();
  v_sug record;
  v_new_config jsonb;
  v_store_type text;
  v_daypart text;
  v_target text;
begin
  if not exists (select 1 from public.users u where u.id=v_uid and u.role='admin') then
    raise exception 'admin only';
  end if;

  select * into v_sug from public.ai_weight_regression_suggestions where id = p_id for update;
  if v_sug.id is null then raise exception 'suggestion not found'; end if;
  if v_sug.status <> 'pending' then
    raise exception 'suggestion is not pending (current status: %)', v_sug.status;
  end if;

  v_store_type := nullif(v_sug.suggestion->>'store_type', '');
  v_daypart    := nullif(v_sug.suggestion->>'daypart', '');

  if p_approve then
    -- X6.71 — 'before' snapshot 자동 (가중치 적용 전 상태)
    perform public._compute_weight_effect_snapshot(p_id, 'before');

    if v_store_type is null and v_daypart is null then
      update public.ai_scoring_config set
        fit_audio_w    = (v_sug.suggestion->>'fit_audio_w')::numeric,
        fit_meta_w     = (v_sug.suggestion->>'fit_meta_w')::numeric,
        fit_behavior_w = (v_sug.suggestion->>'fit_behavior_w')::numeric,
        fit_penalty_w  = (v_sug.suggestion->>'fit_penalty_w')::numeric,
        updated_at = now(), updated_by = v_uid
      where id=1;
      v_target := 'base_config';
      update public.ai_scoring_config_history
         set reason = 'applied_suggestion:' || p_id::text
       where id = (select id from public.ai_scoring_config_history order by changed_at desc limit 1)
         and reason is null;
    else
      insert into public.ai_scoring_config_overrides
        (store_type, daypart, fit_audio_w, fit_meta_w, fit_behavior_w, fit_penalty_w,
         source, source_suggestion_id, updated_by, updated_at)
      values (
        v_store_type, v_daypart,
        (v_sug.suggestion->>'fit_audio_w')::numeric,
        (v_sug.suggestion->>'fit_meta_w')::numeric,
        (v_sug.suggestion->>'fit_behavior_w')::numeric,
        (v_sug.suggestion->>'fit_penalty_w')::numeric,
        'regression:' || p_id::text, p_id, v_uid, now()
      )
      on conflict (store_type, daypart) do update set
        fit_audio_w    = excluded.fit_audio_w,
        fit_meta_w     = excluded.fit_meta_w,
        fit_behavior_w = excluded.fit_behavior_w,
        fit_penalty_w  = excluded.fit_penalty_w,
        source = excluded.source,
        source_suggestion_id = excluded.source_suggestion_id,
        updated_by = excluded.updated_by,
        updated_at = now();
      v_target := 'override:' || coalesce(v_store_type,'*') || '/' || coalesce(v_daypart,'*');
    end if;

    select to_jsonb(c) into v_new_config from public.ai_scoring_config c where id=1;
    update public.ai_weight_regression_suggestions
       set status='approved', reviewed_by=v_uid, reviewed_at=now(), review_note=p_note,
           applied_at=now(), applied_config_snapshot=v_new_config
     where id=p_id;
  else
    update public.ai_weight_regression_suggestions
       set status='rejected', reviewed_by=v_uid, reviewed_at=now(), review_note=p_note
     where id=p_id;
    v_target := 'none';
  end if;

  return jsonb_build_object('ok', true, 'approved', p_approve, 'id', p_id, 'target', v_target);
end; $$;


-- =============================================================================
-- 10. cron_take_pending_after_snapshots
--    approved suggestion 중 applied_at ≥ 7일 전 + 'after' snapshot 없는 것 처리.
-- =============================================================================
create or replace function public.cron_take_pending_after_snapshots()
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_count int := 0;
  v_sug record;
begin
  for v_sug in
    select s.id
    from public.ai_weight_regression_suggestions s
    left join public.ai_weight_effect_snapshots ea
      on ea.suggestion_id = s.id and ea.snapshot_type = 'after'
    where s.status = 'approved'
      and s.applied_at is not null
      and s.applied_at < now() - interval '7 days'
      and ea.id is null
    limit 50
  loop
    perform public._compute_weight_effect_snapshot(v_sug.id, 'after');
    v_count := v_count + 1;
  end loop;
  return jsonb_build_object('ok', true, 'after_snapshots_taken', v_count);
end; $$;

revoke execute on function public.cron_take_pending_after_snapshots() from public, anon;
grant execute on function public.cron_take_pending_after_snapshots() to service_role;


-- =============================================================================
-- 11. admin RPCs — recompute jobs + effect list
-- =============================================================================
create or replace function public.admin_list_fit_recompute_jobs(p_limit int default 30)
returns table(
  id uuid, scope text, store_type text, daypart text,
  status text, enqueued_at timestamptz, started_at timestamptz, finished_at timestamptz,
  processed_count int, total_count int, trigger_source text, error text
) language sql stable security definer set search_path to 'public' as $$
  select j.id, j.scope, j.store_type, j.daypart,
         j.status, j.enqueued_at, j.started_at, j.finished_at,
         j.processed_count, j.total_count, j.trigger_source, j.error
  from public.fit_score_recompute_jobs j
  where exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin')
  order by j.enqueued_at desc
  limit greatest(1, p_limit);
$$;
grant execute on function public.admin_list_fit_recompute_jobs(int) to authenticated;


create or replace function public.admin_list_weight_effects(p_suggestion_id uuid default null, p_limit int default 30)
returns table(
  suggestion_id uuid,
  store_type text, daypart text,
  before_avg_fit numeric, after_avg_fit numeric, delta_fit numeric,
  before_pct_high numeric, after_pct_high numeric, delta_pct_high numeric,
  before_avg_completion numeric, after_avg_completion numeric, delta_completion numeric,
  before_avg_skip numeric, after_avg_skip numeric, delta_skip numeric,
  before_sample int, after_sample int,
  before_taken_at timestamptz, after_taken_at timestamptz,
  applied_at timestamptz
) language sql stable security definer set search_path to 'public' as $$
  with before_s as (
    select suggestion_id, store_type, daypart,
           avg_fit_score, pct_above_70, avg_completion_rate, avg_skip_rate,
           behavior_sample_size, taken_at
    from public.ai_weight_effect_snapshots where snapshot_type='before'
  ),
  after_s as (
    select suggestion_id, avg_fit_score, pct_above_70,
           avg_completion_rate, avg_skip_rate,
           behavior_sample_size, taken_at
    from public.ai_weight_effect_snapshots where snapshot_type='after'
  )
  select
    b.suggestion_id, b.store_type, b.daypart,
    b.avg_fit_score, a.avg_fit_score,
    round((coalesce(a.avg_fit_score,b.avg_fit_score) - b.avg_fit_score)::numeric, 2),
    b.pct_above_70, a.pct_above_70,
    round((coalesce(a.pct_above_70,b.pct_above_70) - b.pct_above_70)::numeric, 1),
    b.avg_completion_rate, a.avg_completion_rate,
    round((coalesce(a.avg_completion_rate,b.avg_completion_rate) - b.avg_completion_rate)::numeric, 4),
    b.avg_skip_rate, a.avg_skip_rate,
    round((coalesce(a.avg_skip_rate,b.avg_skip_rate) - b.avg_skip_rate)::numeric, 4),
    b.behavior_sample_size, a.behavior_sample_size,
    b.taken_at, a.taken_at,
    s.applied_at
  from before_s b
  left join after_s a on a.suggestion_id = b.suggestion_id
  join public.ai_weight_regression_suggestions s on s.id = b.suggestion_id
  where exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin')
    and (p_suggestion_id is null or b.suggestion_id = p_suggestion_id)
  order by s.applied_at desc nulls last
  limit greatest(1, p_limit);
$$;
grant execute on function public.admin_list_weight_effects(uuid, int) to authenticated;
