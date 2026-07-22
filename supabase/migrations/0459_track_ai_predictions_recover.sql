-- 0459 — RPC-MIGRATION-RECOVERY-1C · Cluster C: track AI predictions (Production-only drift recovery)
--
-- 배경: track_ai_predictions 테이블 + 4개 RPC 가 Production 에만 존재. Production 정의를 정확히 복구.
--
-- 보안:
--   · apply_track_ai_predictions / bulk_apply_high_confidence_ai_predictions 는 이미 admin 검사 +
--     actor=auth.uid() 존재 → verbatim 복구. (AI 모델/스코어링 로직 변경 없음 — 저장된 예측을
--     tracks 에 반영하는 admin 작업일 뿐, 예측 계산은 오프플랫폼.)
--   · ai_predictions_summary / list_pending_ai_predictions 는 Production 에서 language sql + admin
--     검사 없음(authenticated 노출) → 시그니처/반환형 유지한 채 plpgsql 로 전환해 admin 검사 추가.
--   · 모두 admin 전용(예측은 track 소유자 대상 사용자 reader 없음). 직접 table 접근은 RLS admin_read.
--
-- 적용 대상: 이번 Phase 는 Test Supabase 에만 적용. Production 미변경.

-- ── 테이블 ───────────────────────────────────────────────────────────────
create table if not exists public.track_ai_predictions (
  id                     uuid primary key default gen_random_uuid(),
  track_id               uuid not null references public.tracks(id) on delete cascade,
  model_version          text not null default 'laion-clap-music-v1+librosa',
  predicted_energy_level integer,
  energy_confidence      numeric(4,3),
  predicted_bpm          integer,
  bpm_confidence         numeric(4,3),
  predicted_tempo_feel   text,
  energy_label_scores    jsonb,
  applied_at             timestamptz,
  applied_by             uuid references public.users(id),
  created_at             timestamptz not null default now(),
  predicted_main_genre   text,
  predicted_sub_genres   text[],
  predicted_moods        text[],
  predicted_store_types  text[],
  predicted_dayparts     text[],
  genre_confidence       numeric(4,3),
  mood_confidence        numeric(4,3),
  store_type_confidence  numeric(4,3),
  daypart_confidence     numeric(4,3),
  prediction_scores      jsonb,
  constraint track_ai_predictions_track_id_model_version_key unique (track_id, model_version)
);

create index if not exists track_ai_predictions_track_idx on public.track_ai_predictions using btree (track_id);
create index if not exists track_ai_predictions_unapplied_idx on public.track_ai_predictions using btree (created_at desc) where (applied_at is null);
create index if not exists track_ai_predictions_main_genre_idx on public.track_ai_predictions using btree (predicted_main_genre) where (predicted_main_genre is not null);
create index if not exists track_ai_predictions_dayparts_gin_idx on public.track_ai_predictions using gin (predicted_dayparts);
create index if not exists track_ai_predictions_moods_gin_idx on public.track_ai_predictions using gin (predicted_moods);
create index if not exists track_ai_predictions_store_types_gin_idx on public.track_ai_predictions using gin (predicted_store_types);

-- ── RLS (직접 table 접근은 admin 전용) ──────────────────────────────────────
alter table public.track_ai_predictions enable row level security;
drop policy if exists track_ai_predictions_admin_read on public.track_ai_predictions;
create policy track_ai_predictions_admin_read on public.track_ai_predictions for select
  using (exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin'));

-- ── 함수 (writes verbatim; readers 보안 교정) ───────────────────────────────
-- SECURITY FIX: language sql + admin 검사 없음 → plpgsql + admin guard (시그니처/반환형 유지)
create or replace function public.ai_predictions_summary()
 returns table(total_predictions integer, pending_count integer, applied_count integer, avg_energy_confidence numeric, high_conf_pending integer)
 language plpgsql stable security definer set search_path to 'public'
as $function$
begin
  if not exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin') then
    raise exception 'unauthorized';
  end if;
  return query
  select count(*)::int, count(*) filter (where applied_at is null)::int,
    count(*) filter (where applied_at is not null)::int,
    avg(energy_confidence)::numeric(4,3),
    count(*) filter (where applied_at is null and energy_confidence >= 0.6)::int
  from public.track_ai_predictions;
end; $function$;

-- SECURITY FIX: 동일 — plpgsql + admin guard
create or replace function public.list_pending_ai_predictions(p_limit integer default 50)
 returns table(id uuid, track_id uuid, track_title text, track_artist text, cover_url text, main_genre text, sub_genre text, current_energy_level integer, current_bpm integer, current_tempo_feel text, predicted_energy_level integer, energy_confidence numeric, predicted_bpm integer, predicted_tempo_feel text, model_version text, created_at timestamptz)
 language plpgsql stable security definer set search_path to 'public'
as $function$
begin
  if not exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin') then
    raise exception 'unauthorized';
  end if;
  return query
  select p.id, p.track_id, t.title, t.artist, t.cover_url, t.main_genre, t.sub_genre,
    t.energy_level, t.bpm, t.tempo_feel,
    p.predicted_energy_level, p.energy_confidence, p.predicted_bpm, p.predicted_tempo_feel,
    p.model_version, p.created_at
  from public.track_ai_predictions p
  join public.tracks t on t.id = p.track_id
  where p.applied_at is null and t.visibility_status = 'approved' and t.removed_at is null
  order by p.energy_confidence desc nulls last, p.created_at desc
  limit p_limit;
end; $function$;

-- Production verbatim (이미 admin guard + actor=auth.uid; AI 로직 변경 없음)
create or replace function public.apply_track_ai_predictions(p_prediction_id uuid, p_apply_energy boolean default true, p_apply_bpm boolean default true, p_apply_tempo_feel boolean default true, p_overwrite_existing boolean default false)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
declare v_pred record; v_track record;
begin
  if not exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin') then raise exception 'unauthorized'; end if;
  select * into v_pred from public.track_ai_predictions where id = p_prediction_id;
  if v_pred is null then raise exception 'prediction_not_found'; end if;
  if v_pred.applied_at is not null then raise exception 'already_applied'; end if;
  select * into v_track from public.tracks where id = v_pred.track_id;
  if v_track is null then raise exception 'track_not_found'; end if;
  update public.tracks set
    energy_level = case when p_apply_energy and v_pred.predicted_energy_level is not null and (p_overwrite_existing or energy_level is null) then v_pred.predicted_energy_level else energy_level end,
    bpm = case when p_apply_bpm and v_pred.predicted_bpm is not null and (p_overwrite_existing or bpm is null) then v_pred.predicted_bpm else bpm end,
    tempo_feel = case when p_apply_tempo_feel and v_pred.predicted_tempo_feel is not null and (p_overwrite_existing or tempo_feel is null) then v_pred.predicted_tempo_feel else tempo_feel end
  where id = v_pred.track_id;
  update public.track_ai_predictions set applied_at = now(), applied_by = auth.uid() where id = p_prediction_id;
end; $function$;

create or replace function public.bulk_apply_high_confidence_ai_predictions(p_confidence_threshold numeric default 0.6, p_limit integer default 500)
 returns integer language plpgsql security definer set search_path to 'public'
as $function$
declare v_count int := 0; r record;
begin
  if not exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin') then raise exception 'unauthorized'; end if;
  for r in
    select p.id, p.track_id, p.predicted_energy_level, p.predicted_bpm, p.predicted_tempo_feel, p.energy_confidence
    from public.track_ai_predictions p join public.tracks t on t.id = p.track_id
    where p.applied_at is null and p.energy_confidence >= p_confidence_threshold and t.visibility_status='approved' and t.removed_at is null
    order by p.energy_confidence desc limit p_limit
  loop
    update public.tracks set energy_level = coalesce(energy_level, r.predicted_energy_level), bpm = coalesce(bpm, r.predicted_bpm), tempo_feel = coalesce(tempo_feel, r.predicted_tempo_feel) where id = r.track_id;
    update public.track_ai_predictions set applied_at = now(), applied_by = auth.uid() where id = r.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end; $function$;

-- ── Grants (fail-closed: revoke PUBLIC, anon 없음, authenticated + 내부 admin 검사) ──
revoke all on function public.ai_predictions_summary() from public;
revoke all on function public.list_pending_ai_predictions(integer) from public;
revoke all on function public.apply_track_ai_predictions(uuid,boolean,boolean,boolean,boolean) from public;
revoke all on function public.bulk_apply_high_confidence_ai_predictions(numeric,integer) from public;

grant execute on function public.ai_predictions_summary() to authenticated;
grant execute on function public.list_pending_ai_predictions(integer) to authenticated;
grant execute on function public.apply_track_ai_predictions(uuid,boolean,boolean,boolean,boolean) to authenticated;
grant execute on function public.bulk_apply_high_confidence_ai_predictions(numeric,integer) to authenticated;

comment on function public.ai_predictions_summary() is 'RPC-MIGRATION-RECOVERY-1C: admin-guarded (was over-exposed to authenticated in Production).';
comment on function public.list_pending_ai_predictions(integer) is 'RPC-MIGRATION-RECOVERY-1C: admin-guarded (was over-exposed to authenticated in Production).';
