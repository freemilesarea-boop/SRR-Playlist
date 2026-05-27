-- 0199 — AI 가중치 수정 "제안" 생성 (Phase 3). 자동 적용 금지: 제안만 쌓고 관리자 승인 기록.
--   소스: metadata_training_examples (0198). 대상 knob: ai_scoring_config / ai_store_profiles / artist_profiles.metadata_trust_score.
--   ⚠ decide 는 가중치/설정을 절대 변경하지 않음(상태 기록만). 실제 반영(Phase 4)은 별도 승인 후 수동.

create table if not exists public.ai_weight_suggestions (
  id uuid primary key default gen_random_uuid(),
  suggestion_type text not null,             -- store_overpredict | store_underpredict | uploader_trust_down
  target_kind text not null,                 -- store | uploader
  target_key text not null,                  -- store_key 또는 owner_user_id
  metric jsonb not null default '{}'::jsonb,  -- 근거 카운트/비율
  suggested_direction text,                  -- down | up
  suggested_action text not null,            -- 사람이 읽는 권고
  target_config_key text,                    -- 참고용 knob 경로(설명)
  confidence numeric,                        -- 0~1
  source_window_days int,
  status text not null default 'pending',    -- pending | approved | rejected
  generated_at timestamptz not null default now(),
  decided_by uuid, decided_at timestamptz, decision_note text
);
create unique index if not exists uq_aiws_type_target on public.ai_weight_suggestions(suggestion_type, target_key);
create index if not exists idx_aiws_status on public.ai_weight_suggestions(status, generated_at desc);
alter table public.ai_weight_suggestions enable row level security;
drop policy if exists aiws_admin_read on public.ai_weight_suggestions;
create policy aiws_admin_read on public.ai_weight_suggestions for select
  using (exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin'));

-- 제안 생성 (분석만, 설정 무변경). 기존 pending 은 갱신, 이미 결정된 건 보존.
create or replace function public.admin_generate_weight_suggestions(p_days int default 90, p_min_samples int default 5)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_n int := 0;
begin
  if not public.can_manage_curation() then raise exception 'curation admin only'; end if;

  -- 1) store_overpredict: AI가 자주 예측했으나 관리자가 제거한 매장 → 가중치 하향/제외 임계 상향 권고
  insert into public.ai_weight_suggestions(suggestion_type,target_kind,target_key,metric,suggested_direction,suggested_action,target_config_key,confidence,source_window_days)
  select 'store_overpredict','store', store,
    jsonb_build_object('ai_predicted',ai_pred,'admin_removed',adm_rm,'overpredict_rate',rate),
    'down',
    format('AI가 ''%s'' 매장을 %s회 예측했으나 관리자가 %s회(%s%%) 제거. 해당 매장 적합 가중치 하향 또는 store_exclude_threshold 상향 검토.', store, ai_pred, adm_rm, rate),
    'ai_store_profiles['||store||'] / store_exclude_threshold', least(1.0, (rate/100.0)*least(1.0, ai_pred/20.0)), p_days
  from (
    select s store, count(*) ai_pred, count(*) filter (where not (s = any(coalesce(admin_final_store_tags,'{}'::text[])))) adm_rm,
           round(100.0*count(*) filter (where not (s = any(coalesce(admin_final_store_tags,'{}'::text[]))))/count(*),1) rate
    from public.metadata_training_examples e, unnest(coalesce(ai_store_tags,'{}'::text[])) s
    where created_at >= now()-(p_days||' days')::interval and (field_diffs->>'ai_present')::boolean is true
    group by s
  ) z where ai_pred >= p_min_samples and rate >= 50
  on conflict (suggestion_type,target_key) do update
    set metric=excluded.metric, suggested_action=excluded.suggested_action, confidence=excluded.confidence,
        source_window_days=excluded.source_window_days, generated_at=now()
    where public.ai_weight_suggestions.status='pending';
  get diagnostics v_n = row_count;

  -- 2) store_underpredict: 관리자가 자주 지정했으나 AI가 누락한 매장 → 가중치 상향 권고
  insert into public.ai_weight_suggestions(suggestion_type,target_kind,target_key,metric,suggested_direction,suggested_action,target_config_key,confidence,source_window_days)
  select 'store_underpredict','store', store,
    jsonb_build_object('admin_assigned',adm,'ai_missed',missed,'miss_rate',rate),
    'up',
    format('관리자가 ''%s'' 매장을 %s회 확정했으나 AI가 %s회(%s%%) 누락. 해당 매장 적합 가중치 상향 검토.', store, adm, missed, rate),
    'ai_store_profiles['||store||']', least(1.0, (rate/100.0)*least(1.0, adm/20.0)), p_days
  from (
    select s store, count(*) adm, count(*) filter (where not (s = any(coalesce(ai_store_tags,'{}'::text[])))) missed,
           round(100.0*count(*) filter (where not (s = any(coalesce(ai_store_tags,'{}'::text[]))))/count(*),1) rate
    from public.metadata_training_examples e, unnest(coalesce(admin_final_store_tags,'{}'::text[])) s
    where created_at >= now()-(p_days||' days')::interval and (field_diffs->>'ai_present')::boolean is true
    group by s
  ) z where adm >= p_min_samples and rate >= 50
  on conflict (suggestion_type,target_key) do update
    set metric=excluded.metric, suggested_action=excluded.suggested_action, confidence=excluded.confidence,
        source_window_days=excluded.source_window_days, generated_at=now()
    where public.ai_weight_suggestions.status='pending';
  get diagnostics v_n = v_n + row_count;

  -- 3) uploader_trust_down: 매장 태그를 자주 틀리는(과장) 업로더 → trust 하향 권고
  insert into public.ai_weight_suggestions(suggestion_type,target_kind,target_key,metric,suggested_direction,suggested_action,target_config_key,confidence,source_window_days)
  select 'uploader_trust_down','uploader', owner_user_id::text,
    jsonb_build_object('total',tot,'user_wrong',uw,'wrong_rate',round(100.0*uw/tot,1)),
    'down',
    format('업로더 %s 의 매장 태그가 %s/%s(%s%%) 관리자 최종과 불일치. metadata_trust_score 하향 검토.', left(owner_user_id::text,8), uw, tot, round(100.0*uw/tot,1)),
    'artist_profiles.metadata_trust_score', least(1.0, (uw::numeric/tot)*least(1.0, tot/10.0)), p_days
  from (
    select owner_user_id, count(*) tot, count(*) filter (where (field_diffs->'store'->>'user_match')='false') uw
    from public.metadata_training_examples
    where created_at >= now()-(p_days||' days')::interval and owner_user_id is not null
    group by owner_user_id
  ) z where tot >= p_min_samples and uw::numeric/tot >= 0.5
  on conflict (suggestion_type,target_key) do update
    set metric=excluded.metric, suggested_action=excluded.suggested_action, confidence=excluded.confidence,
        source_window_days=excluded.source_window_days, generated_at=now()
    where public.ai_weight_suggestions.status='pending';
  get diagnostics v_n = v_n + row_count;

  return jsonb_build_object('ok', true, 'generated_or_updated', v_n);
end; $$;
grant execute on function public.admin_generate_weight_suggestions(int,int) to authenticated;

create or replace function public.admin_list_weight_suggestions(p_status text default null)
returns setof public.ai_weight_suggestions language sql stable security definer set search_path to 'public' as $$
  select * from public.ai_weight_suggestions
  where (exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin'))
    and (p_status is null or status = p_status)
  order by status, confidence desc nulls last, generated_at desc;
$$;
grant execute on function public.admin_list_weight_suggestions(text) to authenticated;

-- 승인/반려 (상태 기록만 — 가중치/설정 변경 없음. Phase 4에서 별도 수동 반영).
create or replace function public.admin_decide_weight_suggestion(p_id uuid, p_decision text, p_note text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.can_manage_curation() then raise exception 'curation admin only'; end if;
  if p_decision not in ('approved','rejected','pending') then raise exception 'invalid decision'; end if;
  update public.ai_weight_suggestions
    set status=p_decision, decided_by=auth.uid(), decided_at=now(), decision_note=p_note
    where id=p_id;
  if not found then raise exception 'suggestion not found'; end if;
  return jsonb_build_object('ok', true, 'id', p_id, 'status', p_decision);
end; $$;
grant execute on function public.admin_decide_weight_suggestion(uuid,text,text) to authenticated;