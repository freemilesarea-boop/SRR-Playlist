-- ============================================
-- 0475_admin_artist_intel.sql
--
-- Phase ADMIN-ARTIST-1 — Artist Intelligence Dashboard 집계 RPC 5개.
--
-- PR #362~#365 위에 이어, 아티스트 Lifecycle(가입→승인→QC→유통→스트리밍→정산)을
-- 실제 운영 데이터로 분석한다. 기존 Settlement/QC/유통/스트리밍/Member/Revenue RPC
-- 전부 무변경(신규 이름). 읽기 전용 집계. 데이터 수정 없음.
--
-- ── 실제 Artist 데이터 모델 (프로덕션 read-only 확인) ─────────────────────
--   artist_profiles(114): user_id · approval_status(approved 112/pending 1/rejected 1)
--     · approved_at · rejected_reason · created_at · metadata_trust_score.
--   tracks(2696): owner_user_id · release_status(released 1162/removed 1502/submitted 32)
--     · visibility_status · metadata_review_status·audio_review_status(approved 1199/pending)
--     · approved_at · released_at · review_started_at · created_at · main_genre/genre · bpm(전부 null).
--   audio_qc_reports(393): track_id · qc_score(avg 93.9) · distortion_score.
--   admin_qc_queue(407): track_id · status(open 369/resolved 38) · reason(플래그 사유).
--   track_audio_features(2696): bpm(199곡만 값) · key_name/musical_key(전부 null) · duration_seconds.
--   artist_settlements(31): artist_user_id · status(carried_over 7/held 23/pending 1; paid 0)
--     · artist_net_settlement · final_payout_amount(전부 0) · carried_over_amount · paid_at(전부 null).
--   stream_events: artist_user_id (스트리밍 발생 아티스트 판별).
--   artist_lifetime_streams(19): total_streams rollup(부분 커버).
--
-- ── 시간대 ─── 오늘/이번달 경계는 KST(Asia/Seoul), 최근 N일은 rolling. (0472 동일)
--
-- ── 지원/미지원 (추정 금지 → "데이터 없음") ────────────────────────────────
--   지원: 승인/QC/유통/스트리밍/정산 단계 · QC 점수/사유 · 장르 분포 · 평균 승인시간.
--   부분: BPM 분포(199곡만) · artist_lifetime_streams(19명 rollup).
--   미지원: Key 분포(track_audio_features.key 전부 null) · QC 처리시간
--     (review_started_at↔approved_at 역전/음수 — 데이터 불일치) · Distribution/Genre
--     변경 이력 로그 · Artist Promotion · 국가(country 필드 없음) · 실지급(paid) 정산.
--
-- ── 정합성 ─── funnel 단조(가입≥승인≥업로드≥QC≥유통≥스트리밍≥정산), 전환율 0~100.
--   raw count + supported flag 만 반환하고 비율/단조 검증은 프론트 순수함수가 담당.
-- ============================================

-- 관리자 가드는 0472 의 _admin_growth_guard() 재사용.

-- ─────────────────────────────────────────────────────────────────────────
-- 1) admin_artist_summary() — Artist KPI.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_artist_summary()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'Asia/Seoul')::date;
  v_month date := date_trunc('month', v_today)::date;
  v_result jsonb;
begin
  perform public._admin_growth_guard();

  with ap as (select * from public.artist_profiles),
  approved as (select user_id from ap where approval_status = 'approved')
  select jsonb_build_object(
    'total_artists', (select count(*) from ap),
    'today_signups', (select count(*) from ap where (created_at at time zone 'Asia/Seoul')::date = v_today),
    'month_signups', (select count(*) from ap where (created_at at time zone 'Asia/Seoul')::date >= v_month),
    'pending', (select count(*) from ap where approval_status = 'pending'),
    'approved', (select count(*) from ap where approval_status = 'approved'),
    'rejected', (select count(*) from ap where approval_status = 'rejected'),
    -- 활성 = 승인 & 회원계정 비탈퇴/비정지
    'active_artists', (select count(*) from approved a join public.users u on u.id = a.user_id where u.withdrawn_at is null and u.disabled_at is null),
    'first_upload', (select count(distinct t.owner_user_id) from public.tracks t join ap on ap.user_id = t.owner_user_id),
    'distributed', (select count(distinct t.owner_user_id) from public.tracks t join ap on ap.user_id = t.owner_user_id where t.release_status = 'released'),
    'streaming', (select count(distinct se.artist_user_id) from public.stream_events se join ap on ap.user_id = se.artist_user_id),
    'settled', (select count(distinct s.artist_user_id) from public.artist_settlements s),
    'settle_paid', (select count(distinct s.artist_user_id) from public.artist_settlements s where s.status = 'paid' or s.paid_at is not null),
    'avg_qc_score', (select coalesce(round(avg(qc_score), 1), 0) from public.audio_qc_reports),
    'avg_approval_hours', (select coalesce(round(avg(extract(epoch from (approved_at - created_at)) / 3600.0), 1), 0) from public.tracks where approved_at is not null),
    'generated_at', now()
  ) into v_result;

  return v_result;
end;
$$;

grant execute on function public.admin_artist_summary() to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 2) admin_artist_funnel() — Lifecycle 퍼널 (단조). raw count + supported.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_artist_funnel()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_result jsonb;
begin
  perform public._admin_growth_guard();

  with ap as (select user_id from public.artist_profiles),
  t as (select * from public.tracks tr join ap on ap.user_id = tr.owner_user_id)
  select jsonb_build_object(
    'steps', jsonb_build_array(
      jsonb_build_object('key','signup',   'label','가입',          'count',(select count(*) from public.artist_profiles),'supported',true),
      jsonb_build_object('key','approved', 'label','승인',          'count',(select count(*) from public.artist_profiles where approval_status='approved'),'supported',true),
      jsonb_build_object('key','upload',   'label','첫 음원 업로드','count',(select count(distinct owner_user_id) from t),'supported',true),
      jsonb_build_object('key','qc_review','label','QC 진행',       'count',(select count(distinct owner_user_id) from t where review_started_at is not null or metadata_review_status is not null),'supported',true,'note','검수 착수/제출'),
      jsonb_build_object('key','qc_pass',  'label','QC 통과',       'count',(select count(distinct owner_user_id) from t where metadata_review_status='approved' and audio_review_status='approved'),'supported',true),
      jsonb_build_object('key','released', 'label','유통',          'count',(select count(distinct owner_user_id) from t where release_status='released'),'supported',true),
      jsonb_build_object('key','stream',   'label','첫 스트리밍',   'count',(select count(distinct se.artist_user_id) from public.stream_events se join ap on ap.user_id=se.artist_user_id),'supported',true),
      jsonb_build_object('key','settle',   'label','첫 정산',       'count',(select count(distinct artist_user_id) from public.artist_settlements),'supported',true),
      jsonb_build_object('key','paid',     'label','정산 완료',     'count',(select count(distinct artist_user_id) from public.artist_settlements where status='paid' or paid_at is not null),'supported',true,'note','실지급(paid) — 현재 0')
    ),
    'generated_at', now()
  ) into v_result;

  return v_result;
end;
$$;

grant execute on function public.admin_artist_funnel() to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 3) admin_artist_growth(p_range) — 시계열 (신규/업로드/QC통과/유통/스트리밍/정산).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_artist_growth(p_range text default '30d')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'Asia/Seoul')::date;
  v_unit text; v_start date; v_end date; v_result jsonb;
begin
  perform public._admin_growth_guard();

  if p_range = '7d' then       v_unit:='day';   v_start:=v_today-6;  v_end:=v_today;
  elsif p_range = '30d' then   v_unit:='day';   v_start:=v_today-29; v_end:=v_today;
  elsif p_range = '90d' then   v_unit:='day';   v_start:=v_today-89; v_end:=v_today;
  elsif p_range = '12m' then   v_unit:='month';
    v_start := (date_trunc('month',v_today) - interval '11 months')::date;
    v_end   := date_trunc('month',v_today)::date;
  else raise exception 'invalid range: %, allowed: 7d|30d|90d|12m', p_range using errcode='22023';
  end if;

  with cal as (
    select case when v_unit='day' then gs::date else date_trunc('month',gs)::date end bucket
    from generate_series(v_start::timestamp, v_end::timestamp, case when v_unit='day' then interval '1 day' else interval '1 month' end) gs
  ),
  ap as (select user_id from public.artist_profiles),
  b(ts, kind) as (
    select ap2.created_at, 'artist' from public.artist_profiles ap2
    union all select t.created_at,  'upload'  from public.tracks t join ap on ap.user_id=t.owner_user_id
    union all select t.approved_at, 'qc'      from public.tracks t join ap on ap.user_id=t.owner_user_id where t.metadata_review_status='approved' and t.audio_review_status='approved' and t.approved_at is not null
    union all select t.released_at, 'release' from public.tracks t join ap on ap.user_id=t.owner_user_id where t.release_status='released' and t.released_at is not null
    union all select se.created_at, 'stream'  from public.stream_events se join ap on ap.user_id=se.artist_user_id
    union all select s.created_at,  'settle'  from public.artist_settlements s
  ),
  bk as (
    select case when v_unit='day' then (ts at time zone 'Asia/Seoul')::date
                else date_trunc('month',(ts at time zone 'Asia/Seoul')::date)::date end bucket, kind
    from b where ts is not null and (ts at time zone 'Asia/Seoul')::date >= v_start
  ),
  agg as (
    select bucket,
      count(*) filter (where kind='artist')  new_artists,
      count(*) filter (where kind='upload')   uploads,
      count(*) filter (where kind='qc')       qc_passed,
      count(*) filter (where kind='release')  distributed,
      count(*) filter (where kind='stream')   streams,
      count(*) filter (where kind='settle')   settlements
    from bk group by bucket
  )
  select jsonb_build_object(
    'range', p_range, 'unit', v_unit, 'start', v_start, 'end', v_end,
    'points', coalesce(jsonb_agg(jsonb_build_object(
      'bucket', c.bucket,
      'new_artists', coalesce(a.new_artists,0), 'uploads', coalesce(a.uploads,0),
      'qc_passed', coalesce(a.qc_passed,0), 'distributed', coalesce(a.distributed,0),
      'streams', coalesce(a.streams,0), 'settlements', coalesce(a.settlements,0)
    ) order by c.bucket), '[]'::jsonb),
    'generated_at', now()
  ) into v_result
  from cal c left join agg a on a.bucket=c.bucket;

  return v_result;
end;
$$;

grant execute on function public.admin_artist_growth(text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 4) admin_artist_breakdown() — QC / Track / Genre / Settlement / Streaming + 지원매트릭스.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_artist_breakdown()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'Asia/Seoul')::date;
  v_result jsonb;
begin
  perform public._admin_growth_guard();

  select jsonb_build_object(
    -- QC Intelligence
    'qc', jsonb_build_object(
      'approved', (select count(*) from public.tracks where metadata_review_status='approved' and audio_review_status='approved'),
      'pending',  (select count(*) from public.tracks where metadata_review_status='pending' or audio_review_status='pending'),
      'queue_open', (select count(*) from public.admin_qc_queue where status='open'),
      'queue_resolved', (select count(*) from public.admin_qc_queue where status='resolved'),
      'avg_score', (select coalesce(round(avg(qc_score),1),0) from public.audio_qc_reports),
      'avg_approval_hours', (select coalesce(round(avg(extract(epoch from (approved_at-created_at))/3600.0),1),0) from public.tracks where approved_at is not null),
      'proc_time_supported', false,   -- review_started↔approved 역전(음수) → 미지원
      'top_reasons', (select coalesce(jsonb_agg(jsonb_build_object('reason', reason, 'count', c) order by c desc),'[]'::jsonb)
                      from (select coalesce(reason,'(사유 없음)') reason, count(*) c from public.admin_qc_queue group by 1 order by c desc limit 5) q),
      'by_month', (select coalesce(jsonb_agg(jsonb_build_object('bucket', m, 'approved', ac) order by m),'[]'::jsonb)
                   from (select date_trunc('month',(approved_at at time zone 'Asia/Seoul')::date)::date m, count(*) ac
                         from public.tracks where approved_at is not null and approved_at >= now()-interval '6 months' group by 1) q)
    ),
    -- Track Intelligence
    'tracks', jsonb_build_object(
      'total', (select count(*) from public.tracks),
      'today', (select count(*) from public.tracks where (created_at at time zone 'Asia/Seoul')::date = v_today),
      'month', (select count(*) from public.tracks where (created_at at time zone 'Asia/Seoul')::date >= date_trunc('month',v_today)::date),
      'pending_dist', (select count(*) from public.tracks where release_status='submitted'),
      'released', (select count(*) from public.tracks where release_status='released'),
      'hidden', (select count(*) from public.tracks where visibility_status='hidden'),
      'removed', (select count(*) from public.tracks where release_status='removed'),
      'avg_duration', (select coalesce(round(avg(duration)),0) from public.tracks where duration>0),
      'genre_dist', (select coalesce(jsonb_agg(jsonb_build_object('key', g, 'count', c) order by c desc),'[]'::jsonb)
                     from (select coalesce(main_genre,genre,'(미지정)') g, count(*) c from public.tracks group by 1 order by c desc limit 8) q),
      'bpm_dist', (select coalesce(jsonb_agg(jsonb_build_object('key', bucket, 'count', c) order by bucket),'[]'::jsonb)
                   from (select (floor(bpm/20)*20)::int || '-' || (floor(bpm/20)*20+19)::int bucket, count(*) c
                         from public.track_audio_features where bpm is not null and bpm>0 group by floor(bpm/20)) q),
      'bpm_coverage', (select count(*) from public.track_audio_features where bpm is not null and bpm>0),
      'key_supported', false   -- track_audio_features.key 전부 null → 미지원
    ),
    -- Streaming Intelligence (아티스트 관점)
    'streaming', jsonb_build_object(
      'streamed_artists', (select count(distinct se.artist_user_id) from public.stream_events se join public.artist_profiles ap on ap.user_id=se.artist_user_id),
      'no_stream_artists', (select count(*) from public.artist_profiles ap where ap.approval_status='approved'
                            and not exists (select 1 from public.stream_events se where se.artist_user_id=ap.user_id))
    ),
    -- Settlement Intelligence
    'settlement', jsonb_build_object(
      'sum_net', (select coalesce(sum(artist_net_settlement),0) from public.artist_settlements),
      'sum_final_payout', (select coalesce(sum(final_payout_amount),0) from public.artist_settlements),
      'sum_carryover', (select coalesce(sum(carried_over_amount),0) from public.artist_settlements),
      'held', (select count(*) from public.artist_settlements where status='held'),
      'pending', (select count(*) from public.artist_settlements where status='pending'),
      'carried_over', (select count(*) from public.artist_settlements where status='carried_over'),
      'paid', (select count(*) from public.artist_settlements where status='paid' or paid_at is not null),
      'avg_net', (select coalesce(round(avg(artist_net_settlement)),0) from public.artist_settlements),
      'this_month', (select coalesce(sum(artist_net_settlement),0) from public.artist_settlements where (created_at at time zone 'Asia/Seoul')::date >= date_trunc('month',v_today)::date),
      'payout_supported', false   -- final_payout_amount 전부 0 · paid 0 → 실지급 미발생
    ),
    -- 지원 여부 매트릭스
    'support', jsonb_build_object(
      'ai_score', true, 'qc_history', true, 'playlist_exposure', true, 'recommendation_score', true,
      'distribution_history', false, 'genre_history', false, 'promotion', false, 'country', false
    ),
    'generated_at', now()
  ) into v_result;

  return v_result;
end;
$$;

grant execute on function public.admin_artist_breakdown() to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 5) admin_artist_rankings() — TOP 스트리밍/정산/업로드/장르/신규.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_artist_rankings()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_result jsonb;
begin
  perform public._admin_growth_guard();

  select jsonb_build_object(
    'top_streaming', (select coalesce(jsonb_agg(jsonb_build_object('artist', name, 'value', c) order by c desc),'[]'::jsonb)
      from (select coalesce(ap.artist_name, se.artist_user_id::text) name, count(*) c
            from public.stream_events se join public.artist_profiles ap on ap.user_id=se.artist_user_id
            group by 1 order by c desc limit 10) q),
    'top_settlement', (select coalesce(jsonb_agg(jsonb_build_object('artist', name, 'value', v) order by v desc),'[]'::jsonb)
      from (select coalesce(ap.artist_name, s.artist_user_id::text) name, sum(s.artist_net_settlement) v
            from public.artist_settlements s left join public.artist_profiles ap on ap.user_id=s.artist_user_id
            group by 1 order by v desc limit 10) q),
    'top_upload', (select coalesce(jsonb_agg(jsonb_build_object('artist', name, 'value', c) order by c desc),'[]'::jsonb)
      from (select coalesce(ap.artist_name, t.owner_user_id::text) name, count(*) c
            from public.tracks t join public.artist_profiles ap on ap.user_id=t.owner_user_id
            group by 1 order by c desc limit 10) q),
    'top_genre', (select coalesce(jsonb_agg(jsonb_build_object('genre', g, 'value', c) order by c desc),'[]'::jsonb)
      from (select coalesce(main_genre,genre,'(미지정)') g, count(*) c from public.tracks group by 1 order by c desc limit 10) q),
    'top_new', (select coalesce(jsonb_agg(jsonb_build_object('artist', coalesce(artist_name,'(이름 없음)'), 'created_at', created_at) order by created_at desc),'[]'::jsonb)
      from (select artist_name, created_at from public.artist_profiles order by created_at desc limit 10) q),
    'generated_at', now()
  ) into v_result;

  return v_result;
end;
$$;

grant execute on function public.admin_artist_rankings() to authenticated;
