-- 0176 — 고위험 우선 검수 + 저신뢰 업로더 관리 + trust 변화 기록. additive. 정산/차트 미변경.
create table if not exists public.metadata_trust_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null, old_score numeric, new_score numeric, reason text, created_at timestamptz not null default now()
);
create index if not exists idx_mth_user on public.metadata_trust_history(user_id, created_at desc);
alter table public.metadata_trust_history enable row level security;
drop policy if exists mth_admin_read on public.metadata_trust_history;
create policy mth_admin_read on public.metadata_trust_history for select using (exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin'));

-- trust 재계산 + 변화 기록 (0174 버전 대체)
create or replace function public.admin_recompute_metadata_trust()
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_n int := 0; r record;
begin
  if not exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin') then raise exception 'admin only'; end if;
  for r in
    select ap.user_id, ap.metadata_trust_score as old_score,
      greatest(0, round(100
        - 70.0 * coalesce((select count(distinct f.track_id) from public.track_guardrail_flags f where f.owner_user_id=ap.user_id and f.severity='hard_block'),0)
              / nullif((select count(*) from public.tracks t where t.owner_user_id=ap.user_id and t.removed_at is null and t.release_status in ('released','approved','scheduled')),0)
        - 20.0 * coalesce((select count(distinct f.track_id) from public.track_guardrail_flags f where f.owner_user_id=ap.user_id and f.severity='soft_block'),0)
              / nullif((select count(*) from public.tracks t where t.owner_user_id=ap.user_id and t.removed_at is null and t.release_status in ('released','approved','scheduled')),0)
      )) as new_score
    from public.artist_profiles ap
  loop
    if r.new_score is not null and r.new_score is distinct from r.old_score then
      update public.artist_profiles set metadata_trust_score=r.new_score where user_id=r.user_id;
      insert into public.metadata_trust_history(user_id, old_score, new_score, reason) values (r.user_id, r.old_score, r.new_score, 'guardrail 위반율 기반 재계산');
      v_n := v_n + 1;
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'updated', v_n);
end; $$;
grant execute on function public.admin_recompute_metadata_trust() to authenticated;

create or replace function public.admin_list_high_risk_tracks(p_limit int default 200)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v jsonb;
begin
  if not exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin') then raise exception 'admin only'; end if;
  select coalesce(jsonb_agg(row_to_json(x) order by x.risk_score desc, x.created_at desc),'[]'::jsonb) into v from (
    select t.id as track_id, t.title, t.artist, t.release_status, t.created_at,
      coalesce(ap.metadata_trust_score,100) as trust_score, public._metadata_trust_tier(ap.metadata_trust_score) as trust_tier,
      (coalesce(ap.metadata_trust_score,100) < 50) as low_trust,
      exists(select 1 from public.track_guardrail_flags f where f.track_id=t.id and f.severity='hard_block') as guardrail_hard,
      coalesce(m.mismatch_score,0) >= 0.5 as ai_mismatch_high,
      coalesce(r.disagreement_score,0) >= 50 as embedding_disagree_high,
      (q.integrated_lufs is not null and ((q.integrated_lufs between -15 and -13.5) or (q.integrated_lufs between -10.5 and -9))) as lufs_boundary,
      (select count(distinct f.store_key) from public.track_guardrail_flags f where f.track_id=t.id and f.severity='hard_block') as hard_stores,
      m.mismatch_score, ap.artist_name as owner_name, t.owner_user_id,
      ( (case when coalesce(ap.metadata_trust_score,100) < 50 then 40 else 0 end)
      + (case when exists(select 1 from public.track_guardrail_flags f where f.track_id=t.id and f.severity='hard_block') then 30 else 0 end)
      + (case when coalesce(m.mismatch_score,0) >= 0.5 then 20 else 0 end)
      + (case when coalesce(r.disagreement_score,0) >= 50 then 15 else 0 end)
      + (case when (q.integrated_lufs is not null and ((q.integrated_lufs between -15 and -13.5) or (q.integrated_lufs between -10.5 and -9))) then 10 else 0 end)
      ) as risk_score
    from public.tracks t
    left join public.artist_profiles ap on ap.user_id=t.owner_user_id
    left join public.track_ai_metadata m on m.track_id=t.id
    left join public.track_embedding_reviews r on r.track_id=t.id
    left join lateral (select integrated_lufs from public.track_audio_quality qq where qq.track_id=t.id order by analyzed_at desc limit 1) q on true
    where t.source_type='artist_upload' and t.removed_at is null
      and t.release_status in ('submitted','review_pending','changes_requested','released','approved','scheduled')
  ) x
  where x.low_trust or x.guardrail_hard or x.ai_mismatch_high or x.embedding_disagree_high or x.lufs_boundary
  limit greatest(1, p_limit);
  return v;
end; $$;
grant execute on function public.admin_list_high_risk_tracks(int) to authenticated;

create or replace function public.admin_get_uploader_detail(p_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_name text; v_score numeric; v_tier text; v_tracks jsonb; v_hist jsonb; v_top_rules text; v_notice text; v_hard int;
begin
  if not exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin') then raise exception 'admin only'; end if;
  select artist_name, metadata_trust_score into v_name, v_score from public.artist_profiles where user_id=p_user_id;
  v_tier := public._metadata_trust_tier(v_score);
  select coalesce(jsonb_agg(row_to_json(a) order by a.hard_stores desc),'[]'::jsonb) into v_tracks from (
    select t.id as track_id, t.title, t.main_genre, count(*) filter (where f.severity='hard_block') as hard_stores,
      array_agg(distinct f.store_key) filter (where f.severity='hard_block') as blocked_stores
    from public.track_guardrail_flags f join public.tracks t on t.id=f.track_id
    where f.owner_user_id=p_user_id group by t.id, t.title, t.main_genre) a;
  select coalesce(jsonb_agg(row_to_json(h) order by h.created_at desc),'[]'::jsonb) into v_hist from (
    select old_score, new_score, reason, created_at from public.metadata_trust_history where user_id=p_user_id order by created_at desc limit 20) h;
  select string_agg(rule_key||'('||cnt||')', ', ') into v_top_rules from (
    select rk as rule_key, count(*) cnt from public.track_guardrail_flags f, unnest(f.violated_rules) rk where f.owner_user_id=p_user_id group by rk order by count(*) desc limit 5) z;
  select count(distinct track_id) into v_hard from public.track_guardrail_flags where owner_user_id=p_user_id and severity='hard_block';
  v_notice := format('안녕하세요 %s님. 최근 등록하신 음원 중 %s곡에서 매장 분위기와 맞지 않는 메타데이터가 확인되었습니다. 주요 항목: %s. 장르·무드·BPM·에너지를 음원 실제 특성에 맞게 정확히 입력해 주시면 노출/배치 정확도가 크게 향상됩니다. 부정확한 메타데이터는 자동 배치에서 제외되고 관리자 검수가 강화됩니다.',
    coalesce(v_name,'아티스트'), coalesce(v_hard,0), coalesce(v_top_rules,'(분석 전)'));
  return jsonb_build_object('user_id', p_user_id, 'artist_name', v_name, 'trust_score', coalesce(v_score,100), 'tier', v_tier,
    'violation_tracks', v_tracks, 'trust_history', v_hist, 'notice_message', v_notice);
end; $$;
grant execute on function public.admin_get_uploader_detail(uuid) to authenticated;
