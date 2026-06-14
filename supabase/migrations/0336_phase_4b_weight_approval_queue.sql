-- 0336 — Phase 4b: 회귀 가중치 최적화 + admin approval queue (X6.69)
--
-- 배경:
--   X6.68 (0335) 의 admin_suggest_weight_adjustment 는 |상관계수| 기반 reweight.
--   회귀 통계 (R², slope, N) 을 활용해 더 robust 한 가중치 도출 + 승인 큐로 운영 책임 분리.
--
-- 설계:
--   1) PostgreSQL 내장 회귀 aggregates 사용 (regr_slope, regr_r2, regr_count)
--      → 각 sub-score (audio/meta/behavior/penalty) 와 completion_rate 의 bivariate regression
--      → 가중치 = R² 정규화 합 (R² 합=1) — R² 가 "설명력" 이므로 직접적으로 적합도 신호
--   2) 표본 / R² 합 임계값으로 신뢰도 필터 (N<50 or sum_r2<0.05 → suggestion=null)
--   3) ai_weight_regression_suggestions 큐 — pending → approved (적용) / rejected (폐기)
--   4) admin_decide_weight_regression: approve 시 자동으로 ai_scoring_config 업데이트 (audit 추적)

-- =============================================================================
-- 1. ai_weight_regression_suggestions queue
-- =============================================================================
create table if not exists public.ai_weight_regression_suggestions (
  id uuid primary key default gen_random_uuid(),
  computed_at timestamptz not null default now(),
  -- 회귀 결과 + 진단 (diagnostics snapshot)
  suggestion jsonb not null,                  -- { fit_audio_w, fit_meta_w, ... }
  regression jsonb not null,                  -- { audio: {slope,r2,n}, meta:..., ... }
  sample_size int not null,
  -- 검토 상태
  status text not null default 'pending'
    check (status in ('pending','approved','rejected','superseded')),
  reviewed_by uuid references public.users(id) on delete set null,
  reviewed_at timestamptz,
  review_note text,
  -- 적용 시점 정보
  applied_at timestamptz,
  applied_config_snapshot jsonb              -- 적용 후의 ai_scoring_config 전체 snapshot
);

create index if not exists ai_weight_regression_suggestions_status_idx
  on public.ai_weight_regression_suggestions (status, computed_at desc);
create index if not exists ai_weight_regression_suggestions_computed_idx
  on public.ai_weight_regression_suggestions (computed_at desc);

alter table public.ai_weight_regression_suggestions enable row level security;
drop policy if exists weight_reg_sug_admin_read on public.ai_weight_regression_suggestions;
create policy weight_reg_sug_admin_read on public.ai_weight_regression_suggestions for select
  using (exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin'));


-- =============================================================================
-- 2. admin_compute_regression_weights(window_days)
--    회귀 기반 가중치 도출 + 큐에 pending 으로 적재.
--    같은 시점에 여러 번 호출 시 기존 pending 은 superseded 로 마킹 (중복 방지).
-- =============================================================================
create or replace function public.admin_compute_regression_weights(p_window_days int default 30)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_min_play_count int := 5;
  v_min_sample int := 50;
  v_min_sum_r2 numeric := 0.05;
  v_n int;
  v_audio_slope numeric; v_audio_r2 numeric;
  v_meta_slope numeric;  v_meta_r2 numeric;
  v_behavior_slope numeric; v_behavior_r2 numeric;
  v_penalty_slope numeric; v_penalty_r2 numeric;
  v_sum_r2 numeric;
  v_w_audio numeric; v_w_meta numeric; v_w_behavior numeric; v_w_penalty numeric;
  v_id uuid;
  v_suggestion jsonb;
  v_regression jsonb;
begin
  if not exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin') then
    raise exception 'admin only';
  end if;

  -- 회귀 통계 계산 (bivariate, 각 sub-score vs completion_rate)
  with eligible as (
    select fs.audio_score, fs.metadata_score, fs.behavior_score, fs.penalty_score,
           b.completion_rate, b.play_count
    from public.playlist_track_fit_scores fs
    join public.track_behavior_scores b
      on b.track_id = fs.track_id and b.window_days = 30
    where fs.status='active' and b.play_count >= v_min_play_count
  )
  select
    count(*),
    regr_slope(completion_rate, audio_score),    coalesce(regr_r2(completion_rate, audio_score), 0),
    regr_slope(completion_rate, metadata_score), coalesce(regr_r2(completion_rate, metadata_score), 0),
    regr_slope(completion_rate, behavior_score), coalesce(regr_r2(completion_rate, behavior_score), 0),
    regr_slope(completion_rate, penalty_score),  coalesce(regr_r2(completion_rate, penalty_score), 0)
  into v_n,
       v_audio_slope, v_audio_r2,
       v_meta_slope, v_meta_r2,
       v_behavior_slope, v_behavior_r2,
       v_penalty_slope, v_penalty_r2
  from eligible;

  v_regression := jsonb_build_object(
    'audio',    jsonb_build_object('slope', round(coalesce(v_audio_slope,0)::numeric, 5),    'r2', round(v_audio_r2::numeric, 4)),
    'meta',     jsonb_build_object('slope', round(coalesce(v_meta_slope,0)::numeric, 5),     'r2', round(v_meta_r2::numeric, 4)),
    'behavior', jsonb_build_object('slope', round(coalesce(v_behavior_slope,0)::numeric, 5), 'r2', round(v_behavior_r2::numeric, 4)),
    'penalty',  jsonb_build_object('slope', round(coalesce(v_penalty_slope,0)::numeric, 5),  'r2', round(v_penalty_r2::numeric, 4)),
    'n', v_n,
    'window_days', p_window_days,
    'min_play_count', v_min_play_count
  );

  if v_n < v_min_sample then
    return jsonb_build_object(
      'ok', true, 'queued', false,
      'reason', 'insufficient_sample',
      'sample_size', v_n,
      'min_required', v_min_sample,
      'regression', v_regression
    );
  end if;

  v_sum_r2 := v_audio_r2 + v_meta_r2 + v_behavior_r2 + v_penalty_r2;

  if v_sum_r2 < v_min_sum_r2 then
    -- R² 합이 너무 작음 = 어떤 feature 도 completion 을 잘 설명 못함 → 변경 불가
    return jsonb_build_object(
      'ok', true, 'queued', false,
      'reason', 'no_explanatory_power',
      'sum_r2', round(v_sum_r2::numeric, 4),
      'min_required', v_min_sum_r2,
      'regression', v_regression
    );
  end if;

  -- R² 정규화 → 가중치 (합=1)
  v_w_audio := round((v_audio_r2 / v_sum_r2)::numeric, 3);
  v_w_meta := round((v_meta_r2 / v_sum_r2)::numeric, 3);
  v_w_behavior := round((v_behavior_r2 / v_sum_r2)::numeric, 3);
  v_w_penalty := round((v_penalty_r2 / v_sum_r2)::numeric, 3);

  v_suggestion := jsonb_build_object(
    'fit_audio_w', v_w_audio,
    'fit_meta_w', v_w_meta,
    'fit_behavior_w', v_w_behavior,
    'fit_penalty_w', v_w_penalty
  );

  -- 기존 pending 은 superseded 로 marking (1 시점 1 pending 정책)
  update public.ai_weight_regression_suggestions
     set status='superseded', reviewed_at=now()
   where status='pending';

  insert into public.ai_weight_regression_suggestions (suggestion, regression, sample_size, status)
  values (v_suggestion, v_regression, v_n, 'pending')
  returning id into v_id;

  return jsonb_build_object(
    'ok', true, 'queued', true,
    'suggestion_id', v_id,
    'suggestion', v_suggestion,
    'regression', v_regression,
    'sample_size', v_n
  );
end; $$;

revoke execute on function public.admin_compute_regression_weights(int) from public, anon;
grant execute on function public.admin_compute_regression_weights(int) to authenticated;


-- =============================================================================
-- 3. admin_decide_weight_regression(id, approve, note)
--    approve=true → ai_scoring_config 업데이트 (audit history 자동 기록)
--    approve=false → rejected 로 마킹
-- =============================================================================
create or replace function public.admin_decide_weight_regression(
  p_id uuid,
  p_approve boolean,
  p_note text default null
)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid uuid := auth.uid();
  v_sug record;
  v_new_config jsonb;
begin
  if not exists (select 1 from public.users u where u.id=v_uid and u.role='admin') then
    raise exception 'admin only';
  end if;

  select * into v_sug from public.ai_weight_regression_suggestions where id = p_id for update;
  if v_sug.id is null then
    raise exception 'suggestion not found';
  end if;
  if v_sug.status <> 'pending' then
    raise exception 'suggestion is not pending (current status: %)', v_sug.status;
  end if;

  if p_approve then
    -- ai_scoring_config 업데이트 (trigger 가 history 자동 기록)
    update public.ai_scoring_config set
      fit_audio_w = coalesce((v_sug.suggestion->>'fit_audio_w')::numeric, fit_audio_w),
      fit_meta_w = coalesce((v_sug.suggestion->>'fit_meta_w')::numeric, fit_meta_w),
      fit_behavior_w = coalesce((v_sug.suggestion->>'fit_behavior_w')::numeric, fit_behavior_w),
      fit_penalty_w = coalesce((v_sug.suggestion->>'fit_penalty_w')::numeric, fit_penalty_w),
      updated_at = now(), updated_by = v_uid
    where id=1;

    select to_jsonb(c) into v_new_config from public.ai_scoring_config c where id=1;

    update public.ai_weight_regression_suggestions
       set status='approved', reviewed_by=v_uid, reviewed_at=now(), review_note=p_note,
           applied_at=now(), applied_config_snapshot=v_new_config
     where id=p_id;

    -- history 의 가장 최근 row 에 reason 채움
    update public.ai_scoring_config_history
       set reason = 'applied_suggestion:' || p_id::text
     where id = (select id from public.ai_scoring_config_history order by changed_at desc limit 1)
       and reason is null;
  else
    update public.ai_weight_regression_suggestions
       set status='rejected', reviewed_by=v_uid, reviewed_at=now(), review_note=p_note
     where id=p_id;
  end if;

  return jsonb_build_object('ok', true, 'approved', p_approve, 'id', p_id);
end; $$;

revoke execute on function public.admin_decide_weight_regression(uuid, boolean, text) from public, anon;
grant execute on function public.admin_decide_weight_regression(uuid, boolean, text) to authenticated;


-- =============================================================================
-- 4. admin_list_weight_regressions(status, limit)
-- =============================================================================
create or replace function public.admin_list_weight_regressions(
  p_status text default 'pending',
  p_limit int default 20
)
returns table(
  id uuid,
  computed_at timestamptz,
  status text,
  sample_size int,
  suggestion jsonb,
  regression jsonb,
  reviewed_by uuid,
  reviewed_by_name text,
  reviewed_at timestamptz,
  review_note text,
  applied_at timestamptz
) language sql stable security definer set search_path to 'public' as $$
  select s.id, s.computed_at, s.status, s.sample_size, s.suggestion, s.regression,
         s.reviewed_by, coalesce(u.full_name, u.nickname) as reviewed_by_name,
         s.reviewed_at, s.review_note, s.applied_at
  from public.ai_weight_regression_suggestions s
  left join public.users u on u.id = s.reviewed_by
  where exists (select 1 from public.users uu where uu.id=auth.uid() and uu.role='admin')
    and (p_status = 'all' or s.status = p_status)
  order by s.computed_at desc
  limit greatest(1, p_limit);
$$;

grant execute on function public.admin_list_weight_regressions(text, int) to authenticated;
