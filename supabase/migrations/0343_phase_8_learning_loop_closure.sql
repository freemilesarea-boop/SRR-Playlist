-- 0343 — Phase 8: 학습 루프 누락 보강 — cluster cron + 신곡 fit 백필 + 제안 만료 (X6.76)
--
-- 배경 (현재 진단):
--   1) decision_pattern_clusters: 마지막 refresh 6h30m 전, 그 사이 357건 새 결정 미반영
--      → cluster 갱신 트리거/cron 없음
--   2) playlist_track_fit_scores: 신곡 released 되어도 자동 평가 안 됨
--      → Phase 7 daily_refresh 가 14일 + 200 cap 으로 일부만 평가
--      → 추천 풀이 admin 수동 recompute 트랙들로 고정 (5,918 active, 70+ = 25건)
--   3) ai_weight_regression_suggestions: pending 6건 모두 검토 없이 방치
--      → segment 별 새 cron 도 같은 segment 만 superseded → 다른 segment 영원히 남음
--
-- 변경:
--   1) cron_refresh_decision_clusters() + pg_cron 매일 04:00 KST (19:00 UTC)
--   2) cron_backfill_new_track_fit_scores() + pg_cron 매일 02:00 KST (17:00 UTC)
--      · CLAP 임베딩 또는 ai_metadata 있는 트랙만 대상 (낭비 방지)
--      · 1회 max 500 쌍 (lock 보호)
--   3) ai_weight_regression_suggestions.status 에 'expired' 추가
--      cron_expire_stale_weight_suggestions() + pg_cron 매일 03:00 KST (18:00 UTC)
--      · 7일 이상 pending → expired (운영자가 잊은 제안 정리)

-- =============================================================================
-- 1. cluster refresh cron — refresh_decision_pattern_clusters 가 idempotent 라 그대로 wrap
-- =============================================================================
create or replace function public.cron_refresh_decision_clusters()
returns jsonb language plpgsql security definer set search_path to 'public' as $$
begin
  return public.refresh_decision_pattern_clusters();
end; $$;

revoke execute on function public.cron_refresh_decision_clusters() from public, anon;
grant execute on function public.cron_refresh_decision_clusters() to service_role, postgres;


-- =============================================================================
-- 2. 신곡 fit_score 백필 cron
--    - released + audio_url 있는 트랙 × released 플리 조합 중
--      fit_score 미계산 + (track_ai_metadata 있거나 track_embeddings 있는 트랙) 만
--    - 1회 max 500 쌍 (lock budget)
--    - 우선순위: 최근 released 트랙 먼저 (released_at desc)
-- =============================================================================
create or replace function public.cron_backfill_new_track_fit_scores(p_max_pairs int default 500)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_processed int := 0;
  v_pair record;
begin
  for v_pair in
    with eligible_tracks as (
      select t.id as track_id, t.released_at
      from public.tracks t
      where t.release_status='released'
        and t.audio_url is not null and t.audio_url <> ''
        and (
          exists (select 1 from public.track_ai_metadata m where m.track_id = t.id)
          or exists (select 1 from public.track_embeddings e where e.track_id = t.id)
        )
    ),
    eligible_pls as (
      select id from public.playlists
      where status='released' and archived_at is null
    )
    select et.track_id, ep.id as playlist_id
    from eligible_tracks et
    cross join eligible_pls ep
    where not exists (
      select 1 from public.playlist_track_fit_scores fs
      where fs.playlist_id = ep.id and fs.track_id = et.track_id
    )
    order by et.released_at desc nulls last
    limit greatest(1, p_max_pairs)
  loop
    begin
      perform public._ai_compute_fit(v_pair.playlist_id, v_pair.track_id);
      v_processed := v_processed + 1;
    exception when others then
      -- per-pair 실패 무시 (다음 pair 진행)
      continue;
    end;
  end loop;

  return jsonb_build_object('ok', true, 'processed', v_processed, 'max_pairs', p_max_pairs);
end; $$;

revoke execute on function public.cron_backfill_new_track_fit_scores(int) from public, anon;
grant execute on function public.cron_backfill_new_track_fit_scores(int) to service_role, postgres;


-- =============================================================================
-- 3. 회귀 제안 'expired' 추가 + 만료 cron
-- =============================================================================
-- status check constraint 재정의 (expired 추가)
alter table public.ai_weight_regression_suggestions
  drop constraint if exists ai_weight_regression_suggestions_status_check;
alter table public.ai_weight_regression_suggestions
  add constraint ai_weight_regression_suggestions_status_check
  check (status in ('pending','approved','rejected','superseded','expired'));

create or replace function public.cron_expire_stale_weight_suggestions(p_days int default 7)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_n int;
begin
  update public.ai_weight_regression_suggestions
     set status='expired', reviewed_at=now(),
         review_note = coalesce(review_note, '') || '[auto-expired after ' || p_days || 'd no review]'
   where status='pending'
     and computed_at < now() - (p_days || ' days')::interval;
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'expired', v_n, 'threshold_days', p_days);
end; $$;

revoke execute on function public.cron_expire_stale_weight_suggestions(int) from public, anon;
grant execute on function public.cron_expire_stale_weight_suggestions(int) to service_role, postgres;
