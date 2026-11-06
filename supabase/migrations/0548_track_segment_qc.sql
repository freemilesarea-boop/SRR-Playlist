-- 0548_track_segment_qc.sql
--
-- 구간별 음질 분석 결과 저장 + 일괄 분석 대기열 + 직원 판정 대비 정확도 측정.
--
-- 왜
--   기존 품질 검사(곡 전체 평균 LUFS·피크)는 직원이 거절한 곡도 A등급을 준다. 직원이 잡는 건
--   '중간부터 깨지는 소리' 라서 구간마다 재야 한다. 엣지함수 analyze-track-segments 가 곡마다
--   8개 구간(각 3초)을 디코딩해 특징을 뽑아 여기에 저장한다(_shared/segmentQcCore.ts).
--
-- 바뀌는 것
--   · track_segment_qc — 곡별 구간 특징(windows)·곡 요약(features)
--   · cron_next_segment_qc_batch(limit, mode) — 아직 분석 안 된 곡 목록(service_role 전용)
--       mode 'pending' = 검수 대기 곡 먼저, 'labeled' = 이미 판정된 곡(정확도 측정용, 통과·거절 반반)
--   · service_save_segment_qc(rows) — 결과 저장(service_role 전용)
--   · admin_segment_qc_accuracy() — 판정된 곡에서 특징별로 '거절 곡을 얼마나 가려내는지'(AUC)
--   · admin_get_segment_qc(track_ids) — 검수 화면 표시용
--   · cron_run_segment_qc() + pg_cron — 10분마다 검수 대기 곡 분석(호출 6번 × 2곡, 엣지 CPU 한도)
--
-- 첫 측정(2026-11-06, 판정된 1,054곡 = 통과 628 · 음질 거절 426)
--   16kHz 이상 고역 비율 AUC 0.68 이 가장 높았고, 클리핑·음량·후반 잡음 평탄도는 거의 못 갈랐다.
--   그래서 자동 거절이 아니라 검수 화면의 '먼저 들어 볼 곡·구간' 참고 표시로만 쓴다(src/lib/segmentQc.ts).

create table if not exists public.track_segment_qc (
  track_id uuid primary key references public.tracks(id) on delete cascade,
  version text not null,
  status text not null check (status in ('ok', 'error')),
  features jsonb,
  windows jsonb,
  error text,
  analyzed_at timestamptz not null default now()
);
alter table public.track_segment_qc enable row level security;
revoke all on public.track_segment_qc from anon, authenticated;

create or replace function public.cron_next_segment_qc_batch(p_limit int default 2, p_mode text default 'pending', p_offset int default 0)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  -- labeled: 통과곡·음질 거절곡을 1:1 로 번갈아(md5 순서) — 정확도 측정용 균형 표본.
  -- pending: 검수 대기곡을 올라온 순서대로.
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', c.id, 'audio_url', c.audio_url, 'duration', c.duration, 'content_length', c.audio_content_length)), '[]'::jsonb)
    from (
      select t.id, t.audio_url, t.duration, t.audio_content_length
        from public.tracks t
       where t.audio_url is not null and t.duration > 20
         and coalesce(t.audio_content_type, 'audio/mpeg') = 'audio/mpeg'
         and not exists (select 1 from public.track_segment_qc q where q.track_id = t.id)
         and case when p_mode = 'labeled'
                  then t.release_status = 'released'
                       or (t.release_status = 'removed' and t.rejected_reason ~ '(음질|저격|부적격|노이즈|음압|마스터링)')
                  else t.release_status = 'submitted' end
       order by case when p_mode = 'labeled' then null else t.submitted_at end,
                case when p_mode = 'labeled' then row_number() over (partition by t.release_status order by md5(t.id::text)) end,
                t.release_status
       limit greatest(1, least(coalesce(p_limit, 2), 20))
      offset greatest(0, least(coalesce(p_offset, 0), 400))
    ) c;
$$;
revoke all on function public.cron_next_segment_qc_batch(int, text, int) from public, anon, authenticated;
grant execute on function public.cron_next_segment_qc_batch(int, text, int) to service_role;

create or replace function public.service_save_segment_qc(p_rows jsonb)
returns int
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_n int;
begin
  insert into public.track_segment_qc (track_id, version, status, features, windows, error, analyzed_at)
  select (r->>'track_id')::uuid, coalesce(r->>'version', 'segqc-v1'),
         case when r->>'error' is null then 'ok' else 'error' end,
         r->'features', r->'windows', left(r->>'error', 300), now()
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r
   where exists (select 1 from public.tracks t where t.id = (r->>'track_id')::uuid)
  on conflict (track_id) do update set
    version = excluded.version, status = excluded.status, features = excluded.features,
    windows = excluded.windows, error = excluded.error, analyzed_at = now();
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function public.service_save_segment_qc(jsonb) from public, anon, authenticated;
grant execute on function public.service_save_segment_qc(jsonb) to service_role;

-- 판정된 곡에서 특징별 AUC: 0.5 = 구분 못 함, 1에 가까울수록 '값이 클수록 거절', 0에 가까울수록 '작을수록 거절'.
create or replace function public.admin_segment_qc_accuracy()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare v jsonb;
begin
  if not public._is_super_admin() then
    raise exception 'forbidden: admin only' using errcode = '42501';
  end if;
  with lab as (
    select q.features, t.release_status = 'removed' as rej
      from public.track_segment_qc q join public.tracks t on t.id = q.track_id
     where q.status = 'ok'
       and (t.release_status = 'released'
            or (t.release_status = 'removed' and t.rejected_reason ~ '(음질|저격|부적격|노이즈|음압|마스터링)'))),
  kv as (
    select f.key, (f.value)::text::numeric as val, lab.rej
      from lab, jsonb_each(lab.features) f where jsonb_typeof(f.value) = 'number'),
  ranked as (
    -- 동점은 평균 순위(0 값이 많은 특징에서 AUC 가 틀어지지 않게).
    select key, rej, rank() over (partition by key order by val) + (count(*) over (partition by key, val) - 1) / 2.0 as rk from kv),
  auc as (
    select key,
           count(*) filter (where rej) as n_rej, count(*) filter (where not rej) as n_ok,
           (sum(rk) filter (where rej) - (count(*) filter (where rej)) * ((count(*) filter (where rej)) + 1) / 2.0)
             / nullif((count(*) filter (where rej)) * (count(*) filter (where not rej)), 0) as auc
      from ranked group by key)
  select jsonb_build_object(
    'labeled', (select count(*) from lab),
    'rejected', (select count(*) from lab where rej),
    'approved', (select count(*) from lab where not rej),
    'features', coalesce((select jsonb_agg(jsonb_build_object('key', key, 'auc', round(auc, 3), 'strength', round(abs(auc - 0.5) * 2, 3))
                                           order by abs(auc - 0.5) desc) from auc where auc is not null), '[]'::jsonb))
    into v;
  return v;
end;
$$;
revoke all on function public.admin_segment_qc_accuracy() from public, anon;
grant execute on function public.admin_segment_qc_accuracy() to authenticated;

create or replace function public.admin_get_segment_qc(p_track_ids uuid[])
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  if not exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin') then
    raise exception 'admin only';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('track_id', q.track_id, 'status', q.status,
                    'features', q.features, 'windows', q.windows, 'analyzed_at', q.analyzed_at))
                     from public.track_segment_qc q where q.track_id = any(p_track_ids)), '[]'::jsonb);
end;
$$;
revoke all on function public.admin_get_segment_qc(uuid[]) from public, anon;
grant execute on function public.admin_get_segment_qc(uuid[]) to authenticated;

-- 엣지함수 주소 — 정리 엣지함수(0545)와 같은 방식으로 만든다.
insert into public.admin_settings (key, value)
select 'segment_qc_url',
       to_jsonb(regexp_replace(trim(both '"' from s.value::text), '/functions/v1/.*$', '/functions/v1/analyze-track-segments'))
  from public.admin_settings s
 where s.key = 'brand_alert_push_url'
   and trim(both '"' from s.value::text) like '%/functions/v1/%'
   and not exists (select 1 from public.admin_settings where key = 'segment_qc_url');

create or replace function public.cron_run_segment_qc(p_mode text default 'pending', p_calls int default 6, p_limit int default 2)
returns int
language plpgsql
security definer
set search_path to 'public', 'extensions', 'net', 'vault'
as $$
declare
  v_url text;
  v_secret text;
  i int;
begin
  select trim(both '"' from value::text) into v_url from public.admin_settings where key = 'segment_qc_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'brand_alert_secret' limit 1;
  if coalesce(v_url, '') = '' or coalesce(v_secret, '') = '' then
    return 0;
  end if;
  -- 여러 호출을 나눠 보낸다(엣지함수 한 번의 CPU 한도 안에서 곡 4개씩).
  for i in 1 .. greatest(1, least(coalesce(p_calls, 3), 20)) loop
    perform net.http_post(
      url := v_url,
      headers := jsonb_build_object('content-type', 'application/json', 'x-cron-secret', v_secret),
      body := jsonb_build_object('mode', p_mode, 'limit', p_limit, 'shard', i),
      timeout_milliseconds := 120000);
  end loop;
  return greatest(1, least(coalesce(p_calls, 3), 20));
end;
$$;
revoke all on function public.cron_run_segment_qc(text, int, int) from public, anon, authenticated;

do $$
begin
  if to_regclass('cron.job') is null then
    return;
  end if;
  if exists (select 1 from cron.job where jobname = 'srr-segment-qc-pending') then
    perform cron.unschedule('srr-segment-qc-pending');
  end if;
  perform cron.schedule('srr-segment-qc-pending', '*/10 * * * *', $c$select public.cron_run_segment_qc('pending', 6, 2);$c$);
end;
$$;
