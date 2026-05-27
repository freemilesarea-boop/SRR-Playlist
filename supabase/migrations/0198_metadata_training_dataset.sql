-- 0198 — 관리자 검수 기반 메타데이터 학습 데이터셋 (Phase 1 수집 + Phase 2 통계). additive only.
--   개념: user_metadata(업로더) vs ai_metadata(AI 예측) vs admin_final(관리자 최종=정답라벨) 3자 비교 누적.
--   수집 훅: track_metadata_audit_log INSERT 트리거(이미 모든 메타 변경을 기록) → 승인/검수 RPC 무수정.
--   ⚠ 모델 자동 변경 없음. stream_events/settlement/release_status 무관. 트리거는 best-effort(실패해도 검수/승인 비차단).

-- ---------- 1) 테이블 ----------
create table if not exists public.metadata_training_examples (
  id uuid primary key default gen_random_uuid(),
  track_id uuid not null,
  owner_user_id uuid,
  reviewed_by uuid,
  -- 업로더 입력값(최초 원본)
  user_genre text[], user_moods text[], user_store_tags text[], user_tempo_feel text,
  -- AI 예측값
  ai_genre text[], ai_moods text[], ai_store_tags text[], ai_tempo_feel text,
  -- 관리자 최종 확정값(정답 라벨)
  admin_final_genre text[], admin_final_moods text[], admin_final_store_tags text[], admin_final_tempo_feel text,
  -- 스냅샷
  audio_features_snapshot jsonb,
  guardrail_snapshot jsonb,
  embedding_snapshot jsonb,
  -- 분류/신뢰도
  correction_type text,                 -- user_wrong | ai_wrong | both_wrong | ai_correct | admin_override
  field_diffs jsonb,                    -- 필드별 {user_match, ai_match}
  confidence_score numeric,
  source text,                          -- audit source (artist_selected/ai_applied/admin 등)
  changed_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists idx_mte_track on public.metadata_training_examples(track_id, created_at desc);
create index if not exists idx_mte_correction on public.metadata_training_examples(correction_type);
create index if not exists idx_mte_owner on public.metadata_training_examples(owner_user_id);
alter table public.metadata_training_examples enable row level security;
drop policy if exists mte_admin_read on public.metadata_training_examples;
create policy mte_admin_read on public.metadata_training_examples for select
  using (exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin'));

-- ---------- 2) 헬퍼 ----------
-- 정렬·중복제거 후 집합 동등 비교 (null=빈배열)
create or replace function public._arr_set_eq(a text[], b text[]) returns boolean
language sql immutable as $$
  select (select array(select distinct e from unnest(coalesce(a,'{}')) e order by 1))
       = (select array(select distinct e from unnest(coalesce(b,'{}')) e order by 1));
$$;

-- 업로더 원본 메타(최초 변경 직전 before; 없으면 현재 tracks 값=아직 업로더값)
create or replace function public._track_user_original_meta(p_track_id uuid) returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare v jsonb;
begin
  select before into v from public.track_metadata_audit_log
   where track_id = p_track_id order by changed_at asc limit 1;
  if v is null then
    select jsonb_build_object('genre_tags',genre_tags,'mood_tags',mood_tags,
      'business_type_tags',business_type_tags,'tempo_feel',tempo_feel)
      into v from public.tracks where id = p_track_id;
  end if;
  return coalesce(v, '{}'::jsonb);
end; $$;

-- ---------- 3) 수집 트리거 (audit-log insert 훅) ----------
create or replace function public._trg_record_metadata_training() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare
  v_is_admin boolean;
  v_user jsonb; v_ai public.track_ai_metadata%rowtype; v_owner uuid;
  v_user_store text[]; v_ai_store text[]; v_admin_store text[];
  v_ai_present boolean; v_user_match boolean; v_ai_match boolean; v_admin_novel boolean;
  v_corr text;
begin
  -- 관리자 변경만 정답라벨로 수집 (업로더 자가수정은 제외)
  select exists(select 1 from public.users u where u.id = NEW.changed_by and u.role='admin') into v_is_admin;
  if not coalesce(v_is_admin, false) then return NEW; end if;

  v_user := public._track_user_original_meta(NEW.track_id);
  select * into v_ai from public.track_ai_metadata where track_id = NEW.track_id order by updated_at desc limit 1;
  v_ai_present := found;
  select owner_user_id into v_owner from public.tracks where id = NEW.track_id;

  v_user_store  := array(select jsonb_array_elements_text(coalesce(v_user->'business_type_tags','[]'::jsonb)));
  v_admin_store := array(select jsonb_array_elements_text(coalesce(NEW.after->'business_type_tags','[]'::jsonb)));
  v_ai_store    := coalesce(v_ai.ai_situations, '{}');

  v_user_match := public._arr_set_eq(v_user_store, v_admin_store);
  v_ai_match   := case when v_ai_present then public._arr_set_eq(v_ai_store, v_admin_store) else false end;
  -- admin 값이 user/ai 어디에도 없으면 override(신규 분류)
  v_admin_novel := not exists (
    select 1 from unnest(v_admin_store) s
     where s = any(v_user_store) or s = any(v_ai_store));

  if v_ai_present and not v_ai_match and not v_user_match then
    v_corr := case when v_admin_novel and array_length(v_admin_store,1) is not null then 'admin_override' else 'both_wrong' end;
  elsif v_ai_present and not v_ai_match and v_user_match then
    v_corr := 'ai_wrong';
  elsif v_ai_present and v_ai_match then
    v_corr := 'ai_correct';
  elsif not v_ai_present and not v_user_match then
    v_corr := 'user_wrong';
  else
    v_corr := 'ai_correct';
  end if;

  insert into public.metadata_training_examples(
    track_id, owner_user_id, reviewed_by,
    user_genre, user_moods, user_store_tags, user_tempo_feel,
    ai_genre, ai_moods, ai_store_tags, ai_tempo_feel,
    admin_final_genre, admin_final_moods, admin_final_store_tags, admin_final_tempo_feel,
    audio_features_snapshot, guardrail_snapshot, embedding_snapshot,
    correction_type, field_diffs, confidence_score, source, changed_by)
  values (
    NEW.track_id, v_owner, NEW.changed_by,
    array(select jsonb_array_elements_text(coalesce(v_user->'genre_tags','[]'::jsonb))),
    array(select jsonb_array_elements_text(coalesce(v_user->'mood_tags','[]'::jsonb))),
    v_user_store, v_user->>'tempo_feel',
    case when v_ai_present then v_ai.ai_genres end,
    case when v_ai_present then v_ai.ai_moods end,
    case when v_ai_present then v_ai.ai_situations end,
    case when v_ai_present then v_ai.ai_energy_level end,   -- AI엔 tempo_feel 없음 → energy_level 대용(문서화)
    array(select jsonb_array_elements_text(coalesce(NEW.after->'genre_tags','[]'::jsonb))),
    array(select jsonb_array_elements_text(coalesce(NEW.after->'mood_tags','[]'::jsonb))),
    v_admin_store, NEW.after->>'tempo_feel',
    (select to_jsonb(f) from public.track_audio_features f where f.track_id = NEW.track_id limit 1),
    case when v_ai_present then jsonb_build_object('ai_store_fit', v_ai.ai_store_fit, 'ai_exclusions', v_ai.ai_exclusions, 'mismatch_score', v_ai.mismatch_score) end,
    (select to_jsonb(e) from public.track_embeddings e where e.track_id = NEW.track_id limit 1),  -- 현재 0행(skeleton)
    v_corr,
    jsonb_build_object(
      'store', jsonb_build_object('user_match', v_user_match, 'ai_match', v_ai_match),
      'ai_present', v_ai_present),
    case when v_ai_present then v_ai.metadata_confidence end,
    NEW.source, NEW.changed_by);
  return NEW;
exception when others then
  -- best-effort: 학습 수집 실패가 검수/승인/메타수정 흐름을 막지 않도록
  return NEW;
end; $$;

drop trigger if exists trg_record_metadata_training on public.track_metadata_audit_log;
create trigger trg_record_metadata_training
  after insert on public.track_metadata_audit_log
  for each row execute function public._trg_record_metadata_training();

-- ---------- 4) 명시 기록 RPC (변경 없이 "문제 없음/AI 정답 확인" 케이스) ----------
create or replace function public.record_metadata_training_example(
  p_track_id uuid, p_correction_type text default 'ai_correct', p_reason text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_id uuid; v_user jsonb; v_ai public.track_ai_metadata%rowtype; v_owner uuid; v_present boolean;
begin
  if not exists (select 1 from public.users u where u.id = auth.uid() and u.role='admin') then
    raise exception 'admin only';
  end if;
  v_user := public._track_user_original_meta(p_track_id);
  select * into v_ai from public.track_ai_metadata where track_id = p_track_id order by updated_at desc limit 1;
  v_present := found;
  select owner_user_id into v_owner from public.tracks where id = p_track_id;
  insert into public.metadata_training_examples(
    track_id, owner_user_id, reviewed_by,
    user_genre, user_moods, user_store_tags, user_tempo_feel,
    ai_genre, ai_moods, ai_store_tags, ai_tempo_feel,
    admin_final_genre, admin_final_moods, admin_final_store_tags, admin_final_tempo_feel,
    audio_features_snapshot, guardrail_snapshot, embedding_snapshot,
    correction_type, field_diffs, confidence_score, source, changed_by)
  select
    p_track_id, v_owner, auth.uid(),
    array(select jsonb_array_elements_text(coalesce(v_user->'genre_tags','[]'::jsonb))),
    array(select jsonb_array_elements_text(coalesce(v_user->'mood_tags','[]'::jsonb))),
    array(select jsonb_array_elements_text(coalesce(v_user->'business_type_tags','[]'::jsonb))),
    v_user->>'tempo_feel',
    case when v_present then v_ai.ai_genres end, case when v_present then v_ai.ai_moods end,
    case when v_present then v_ai.ai_situations end, case when v_present then v_ai.ai_energy_level end,
    t.genre_tags, t.mood_tags, t.business_type_tags, t.tempo_feel,
    (select to_jsonb(f) from public.track_audio_features f where f.track_id = p_track_id limit 1),
    case when v_present then jsonb_build_object('ai_store_fit', v_ai.ai_store_fit, 'ai_exclusions', v_ai.ai_exclusions, 'mismatch_score', v_ai.mismatch_score) end,
    (select to_jsonb(e) from public.track_embeddings e where e.track_id = p_track_id limit 1),
    coalesce(p_correction_type,'ai_correct'),
    jsonb_build_object('explicit', true, 'reason', p_reason),
    case when v_present then v_ai.metadata_confidence end,
    'admin_confirm', auth.uid()
  from public.tracks t where t.id = p_track_id
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end; $$;
grant execute on function public.record_metadata_training_example(uuid, text, text) to authenticated;

-- ---------- 5) 통계 RPC (Phase 2) ----------
create or replace function public.admin_metadata_training_stats(p_days int default 90)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid(); v_total int; v_ai_correct int; res jsonb;
begin
  if not exists (select 1 from public.users u where u.id = v_uid and u.role='admin') then raise exception 'admin only'; end if;
  select count(*) , count(*) filter (where correction_type='ai_correct')
    into v_total, v_ai_correct
  from public.metadata_training_examples
  where created_at >= now() - (p_days||' days')::interval and (field_diffs->>'ai_present')::boolean is true;

  res := jsonb_build_object(
    'window_days', p_days,
    'total_examples', (select count(*) from public.metadata_training_examples where created_at >= now() - (p_days||' days')::interval),
    'ai_evaluated', v_total,
    'ai_accuracy', case when v_total>0 then round(100.0*v_ai_correct/v_total,1) else null end,
    'by_correction_type', (select coalesce(jsonb_object_agg(correction_type, c),'{}'::jsonb) from (
       select correction_type, count(*) c from public.metadata_training_examples
       where created_at >= now() - (p_days||' days')::interval group by correction_type) z),
    -- 매장별 AI 오답률 (admin 최종 store 기준)
    'ai_wrong_by_store', (select coalesce(jsonb_agg(jsonb_build_object('store', store, 'wrong', wrong, 'total', tot, 'wrong_rate', round(100.0*wrong/nullif(tot,0),1)) order by wrong desc),'[]'::jsonb) from (
       select s as store,
              count(*) tot,
              count(*) filter (where (field_diffs->'store'->>'ai_match')='false') wrong
       from public.metadata_training_examples e, unnest(coalesce(e.admin_final_store_tags,'{}')) s
       where e.created_at >= now() - (p_days||' days')::interval and (e.field_diffs->>'ai_present')::boolean is true
       group by s having count(*) >= 1 order by wrong desc limit 20) z),
    -- 장르별 AI 오답률
    'ai_wrong_by_genre', (select coalesce(jsonb_agg(jsonb_build_object('genre', g, 'wrong', wrong, 'total', tot) order by wrong desc),'[]'::jsonb) from (
       select g, count(*) tot, count(*) filter (where (field_diffs->'store'->>'ai_match')='false') wrong
       from public.metadata_training_examples e, unnest(coalesce(e.admin_final_genre,'{}')) g
       where e.created_at >= now() - (p_days||' days')::interval and (e.field_diffs->>'ai_present')::boolean is true
       group by g order by wrong desc limit 20) z),
    -- 업로더별 user_wrong(과장 태그) 빈도
    'uploader_user_wrong', (select coalesce(jsonb_agg(jsonb_build_object('owner_user_id', owner_user_id, 'user_wrong', uw, 'total', tot) order by uw desc),'[]'::jsonb) from (
       select owner_user_id, count(*) tot, count(*) filter (where (field_diffs->'store'->>'user_match')='false') uw
       from public.metadata_training_examples
       where created_at >= now() - (p_days||' days')::interval
       group by owner_user_id having count(*) filter (where (field_diffs->'store'->>'user_match')='false') > 0
       order by uw desc limit 20) z),
    -- AI가 자주 틀리는 패턴: ai_store → admin_store
    'frequent_ai_miss', (select coalesce(jsonb_agg(jsonb_build_object('ai', ai_s, 'admin', adm_s, 'n', n) order by n desc),'[]'::jsonb) from (
       select array_to_string(ai_store_tags,',') ai_s, array_to_string(admin_final_store_tags,',') adm_s, count(*) n
       from public.metadata_training_examples
       where created_at >= now() - (p_days||' days')::interval and correction_type in ('ai_wrong','both_wrong','admin_override')
       group by 1,2 order by n desc limit 15) z));
  return res;
end; $$;
grant execute on function public.admin_metadata_training_stats(int) to authenticated;
