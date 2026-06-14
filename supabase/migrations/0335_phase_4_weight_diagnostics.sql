-- 0335 — Phase 4: fit_score 가중치 자동 조정 — 진단 + history (X6.68)
--
-- 목적:
--   현재 ai_scoring_config 가중치 (audio=0.50/meta=0.20/behavior=0.20/penalty=0.10)
--   가 실제 사용자 행동과 얼마나 정렬되어 있는지 데이터로 확인할 수 있게 함.
--
--   Phase 4 첫 단계: "안전한 자동화" = 진단 + 제안 + 1-click 적용
--   완전 자동 회귀는 표본 부족 (behavior_scores 134개 @ play_count≥5) → 다음 단계로 보류.
--
-- 변경:
--   1) ai_scoring_config_history — 가중치 변경 audit (이전 값 + 변경자 + reason)
--   2) trigger — UPDATE 시 자동 history 저장
--   3) admin_weight_diagnostics() RPC — 가중치-행동 정렬도 신호 5종
--   4) admin_suggest_weight_adjustment() RPC — 상관계수 기반 reweight 제안 (자동 적용 X)

-- =============================================================================
-- 1. ai_scoring_config_history (audit)
-- =============================================================================
create table if not exists public.ai_scoring_config_history (
  id uuid primary key default gen_random_uuid(),
  changed_at timestamptz not null default now(),
  changed_by uuid references public.users(id) on delete set null,
  old_config jsonb not null,
  new_config jsonb not null,
  reason text  -- "manual adjustment" | "applied suggestion" | "test" 등
);
create index if not exists ai_scoring_config_history_time_idx
  on public.ai_scoring_config_history (changed_at desc);

alter table public.ai_scoring_config_history enable row level security;
drop policy if exists ai_cfg_hist_admin_read on public.ai_scoring_config_history;
create policy ai_cfg_hist_admin_read on public.ai_scoring_config_history for select
  using (exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin'));


-- =============================================================================
-- 2. trigger — config UPDATE 시 자동 history 저장
--    (admin_update_ai_scoring_config RPC 외 path 도 추적)
-- =============================================================================
create or replace function public._tg_ai_scoring_config_history()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if to_jsonb(old) is distinct from to_jsonb(new) then
    insert into public.ai_scoring_config_history (changed_by, old_config, new_config, reason)
    values (new.updated_by, to_jsonb(old), to_jsonb(new), null);
  end if;
  return new;
end; $$;

drop trigger if exists tg_ai_scoring_config_history on public.ai_scoring_config;
create trigger tg_ai_scoring_config_history
  after update on public.ai_scoring_config
  for each row execute function public._tg_ai_scoring_config_history();


-- =============================================================================
-- 3. admin_weight_diagnostics() — 가중치-행동 정렬도 신호
--
-- 출력:
--   - mismatches: 가중치가 실제 행동과 안 맞는 패턴 카운트
--     - high_fit_high_skip: fit≥70 인데 skip_rate≥40% (audio weight 과다신뢰?)
--     - low_fit_high_completion: fit<40 인데 completion≥60% (behavior weight 과소신뢰?)
--   - correlations: 각 sub-score 와 실제 행동(completion_rate) pearson 상관
--     - audio_corr / meta_corr / behavior_corr / penalty_corr (negative 예상)
--   - sample_size: 통계 신뢰도 가늠용
--
-- 정책: 표본 < 50 이면 "신뢰도 낮음" 플래그 (코너 케이스로 가중치 변경 금지)
-- =============================================================================
create or replace function public.admin_weight_diagnostics(p_window_days int default 30)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_cutoff_high numeric;
  v_cutoff_low numeric;
  v_skip_high numeric := 0.40;
  v_completion_high numeric := 0.60;
  v_min_play_count int := 5;
  v_result jsonb;
  v_high_fit_high_skip int;
  v_low_fit_high_completion int;
  v_total_evaluated int;
  v_audio_corr numeric;
  v_meta_corr numeric;
  v_behavior_corr numeric;
  v_penalty_corr numeric;
begin
  if not exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin') then
    raise exception 'admin only';
  end if;

  select fit_recommend_cutoff, fit_exclude_cutoff
    into v_cutoff_high, v_cutoff_low
    from public.ai_scoring_config where id=1;

  -- 평가 가능한 트랙: fit_scores 와 behavior 모두 가진 + play_count >= 5
  with eligible as (
    select fs.playlist_id, fs.track_id, fs.final_fit_score,
           fs.audio_score, fs.metadata_score, fs.behavior_score, fs.penalty_score,
           b.completion_rate, b.skip_rate, b.play_count
    from public.playlist_track_fit_scores fs
    join public.track_behavior_scores b on b.track_id = fs.track_id and b.window_days = 30
    where fs.status='active'
      and b.play_count >= v_min_play_count
  )
  select
    count(*) filter (where final_fit_score >= v_cutoff_high and skip_rate >= v_skip_high),
    count(*) filter (where final_fit_score <  v_cutoff_low  and completion_rate >= v_completion_high),
    count(*),
    corr(audio_score, completion_rate),
    corr(metadata_score, completion_rate),
    corr(behavior_score, completion_rate),
    corr(penalty_score, completion_rate)
  into v_high_fit_high_skip, v_low_fit_high_completion, v_total_evaluated,
       v_audio_corr, v_meta_corr, v_behavior_corr, v_penalty_corr
  from eligible;

  v_result := jsonb_build_object(
    'ok', true,
    'window_days', p_window_days,
    'min_play_count', v_min_play_count,
    'sample_size', v_total_evaluated,
    'confidence', case
      when v_total_evaluated >= 200 then 'high'
      when v_total_evaluated >=  50 then 'medium'
      else 'low'
    end,
    'mismatches', jsonb_build_object(
      'high_fit_high_skip', v_high_fit_high_skip,
      'high_fit_high_skip_pct', case when v_total_evaluated > 0 then
        round((v_high_fit_high_skip * 100.0 / v_total_evaluated)::numeric, 1) else null end,
      'low_fit_high_completion', v_low_fit_high_completion,
      'low_fit_high_completion_pct', case when v_total_evaluated > 0 then
        round((v_low_fit_high_completion * 100.0 / v_total_evaluated)::numeric, 1) else null end
    ),
    'correlations', jsonb_build_object(
      'audio_vs_completion', round(coalesce(v_audio_corr, 0)::numeric, 3),
      'meta_vs_completion', round(coalesce(v_meta_corr, 0)::numeric, 3),
      'behavior_vs_completion', round(coalesce(v_behavior_corr, 0)::numeric, 3),
      'penalty_vs_completion', round(coalesce(v_penalty_corr, 0)::numeric, 3)
    ),
    'computed_at', now()
  );

  return v_result;
end; $$;

revoke execute on function public.admin_weight_diagnostics(int) from public, anon;
grant execute on function public.admin_weight_diagnostics(int) to authenticated;


-- =============================================================================
-- 4. admin_suggest_weight_adjustment() — 상관계수 기반 가중치 reweight 제안
--
-- 알고리즘 (drift correction, 자동 적용 안 함):
--   각 sub-score 의 |corr(score, completion_rate)| 를 raw weight 후보로 사용.
--   penalty 는 음의 상관이 클수록 강화 (|negative corr|).
--   |corr| 합으로 정규화 → 가중치 합이 1 유지.
--
-- 안전장치:
--   - 표본 < 50 → suggestion=null (호출자 안내)
--   - 새 가중치가 현재와 ±0.10 이상 차이 → "high_drift=true" 플래그
--   - 절대 자동 적용 안 함 — admin 이 UI 에서 확인 후 적용
--
-- 한계:
--   회귀가 아닌 단순 상관계수 reweight. fit 산정 시 보정용 신호로만 사용.
-- =============================================================================
create or replace function public.admin_suggest_weight_adjustment(p_window_days int default 30)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_diag jsonb;
  v_sample int;
  v_audio numeric; v_meta numeric; v_behavior numeric; v_penalty numeric;
  v_sum numeric;
  v_w_audio numeric; v_w_meta numeric; v_w_behavior numeric; v_w_penalty numeric;
  v_cur_audio numeric; v_cur_meta numeric; v_cur_behavior numeric; v_cur_penalty numeric;
  v_max_drift numeric;
begin
  if not exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin') then
    raise exception 'admin only';
  end if;

  v_diag := public.admin_weight_diagnostics(p_window_days);
  v_sample := (v_diag->>'sample_size')::int;

  if v_sample < 50 then
    return jsonb_build_object(
      'ok', true,
      'suggestion', null,
      'reason', 'insufficient_sample',
      'sample_size', v_sample,
      'min_required', 50,
      'diagnostics', v_diag
    );
  end if;

  -- 상관계수 → 가중치 후보 (절대값 사용, penalty 는 음의 상관이 강할수록 높음)
  v_audio := abs(coalesce((v_diag#>>'{correlations,audio_vs_completion}')::numeric, 0));
  v_meta := abs(coalesce((v_diag#>>'{correlations,meta_vs_completion}')::numeric, 0));
  v_behavior := abs(coalesce((v_diag#>>'{correlations,behavior_vs_completion}')::numeric, 0));
  v_penalty := abs(coalesce((v_diag#>>'{correlations,penalty_vs_completion}')::numeric, 0));

  v_sum := v_audio + v_meta + v_behavior + v_penalty;
  if v_sum < 0.01 then
    -- 상관이 모두 0 ~= 신호 없음 — 변경 권고 안 함
    return jsonb_build_object(
      'ok', true,
      'suggestion', null,
      'reason', 'no_signal_correlation',
      'diagnostics', v_diag
    );
  end if;

  -- 정규화 (sum = 1)
  v_w_audio := round((v_audio / v_sum)::numeric, 3);
  v_w_meta := round((v_meta / v_sum)::numeric, 3);
  v_w_behavior := round((v_behavior / v_sum)::numeric, 3);
  v_w_penalty := round((v_penalty / v_sum)::numeric, 3);

  select fit_audio_w, fit_meta_w, fit_behavior_w, fit_penalty_w
    into v_cur_audio, v_cur_meta, v_cur_behavior, v_cur_penalty
    from public.ai_scoring_config where id=1;

  v_max_drift := greatest(
    abs(v_w_audio - v_cur_audio),
    abs(v_w_meta - v_cur_meta),
    abs(v_w_behavior - v_cur_behavior),
    abs(v_w_penalty - v_cur_penalty)
  );

  return jsonb_build_object(
    'ok', true,
    'suggestion', jsonb_build_object(
      'fit_audio_w', v_w_audio,
      'fit_meta_w', v_w_meta,
      'fit_behavior_w', v_w_behavior,
      'fit_penalty_w', v_w_penalty
    ),
    'current', jsonb_build_object(
      'fit_audio_w', v_cur_audio,
      'fit_meta_w', v_cur_meta,
      'fit_behavior_w', v_cur_behavior,
      'fit_penalty_w', v_cur_penalty
    ),
    'diffs', jsonb_build_object(
      'fit_audio_w', round((v_w_audio - v_cur_audio)::numeric, 3),
      'fit_meta_w', round((v_w_meta - v_cur_meta)::numeric, 3),
      'fit_behavior_w', round((v_w_behavior - v_cur_behavior)::numeric, 3),
      'fit_penalty_w', round((v_w_penalty - v_cur_penalty)::numeric, 3)
    ),
    'max_drift', round(v_max_drift::numeric, 3),
    'high_drift', v_max_drift >= 0.10,
    'diagnostics', v_diag,
    'note', 'algorithmic suggestion only — admin review required before apply'
  );
end; $$;

revoke execute on function public.admin_suggest_weight_adjustment(int) from public, anon;
grant execute on function public.admin_suggest_weight_adjustment(int) to authenticated;


-- =============================================================================
-- 5. admin_list_weight_history() — 가중치 변경 이력
-- =============================================================================
create or replace function public.admin_list_weight_history(p_limit int default 20)
returns table(
  changed_at timestamptz,
  changed_by uuid,
  changed_by_name text,
  old_config jsonb,
  new_config jsonb,
  reason text
) language sql stable security definer set search_path to 'public' as $$
  select h.changed_at, h.changed_by, coalesce(u.full_name, u.nickname), h.old_config, h.new_config, h.reason
  from public.ai_scoring_config_history h
  left join public.users u on u.id = h.changed_by
  where exists (select 1 from public.users uu where uu.id=auth.uid() and uu.role='admin')
  order by h.changed_at desc
  limit greatest(1, p_limit);
$$;

grant execute on function public.admin_list_weight_history(int) to authenticated;
