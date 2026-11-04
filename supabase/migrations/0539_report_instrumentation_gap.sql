-- 0539 — 보고에 "계측 공백" 구간을 넣는다 · 블라인드 매장의 진행 증거를 싣는다
--
-- 0538 이 2분마다 쌓는 continue_listening 위치 표본을, 09/21시 보고에서 읽는다.
-- 대상은 "지금 heartbeat 는 오는데 오디오 진행을 보고하지 않는 매장".
-- 그 매장은 frozen(곡은 넘어가는데 소리만 안 남) 을 감지할 수 없다 —
-- silence(heartbeat 끊김) · stalled(곡이 안 넘어감) 은 그대로 작동한다.
--
-- 적용 직후 실측 (2026-11-04 18:24 KST, 표본 2회분)
--
--   카공시대 분당미금역점   heartbeat 26초    오디오진행 미보고   SM-F926N   전진 증거 아직 없음(표본 1개)
--   카공시대 화정점        heartbeat 38초    오디오진행 미보고   SM-X205N   전진 증거 5초 전
--   이루밍 김포장기역점     heartbeat 74022초 오디오진행 미보고   LM-V500N   전진 증거 5초 전
--
-- 표본 두 개만으로 두 매장의 "판정 불가" 가 해소됐다. 특히 김포장기역점은
-- 브랜드 플레이어 heartbeat 가 20.5시간 죽은 채 장애가 열려 있는데,
-- **같은 곡 안에서 position 이 전진하고 있다** — 기기 하나가 죽은 것이고
-- 매장은 음악이 나온다. DEVICE HEALTH ≠ STORE SERVICE HEALTH 를
-- 처음으로 증거로 가릴 수 있게 됐다.
--
-- 알림은 걸지 않는다. 관측값으로만 싣는다(0538 주석 참고).

create or replace function public.srr_instrumentation_gap_text()
returns text
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v text := ''; r record;
begin
  -- 지금 살아 있는(24시간 내 heartbeat) 세션이 오디오 진행을 보고하지 않는 매장.
  -- 이 매장들은 frozen(곡은 넘어가는데 소리만 안 남) 을 감지할 수 없다.
  -- silence(heartbeat 끊김) · stalled(곡이 안 넘어감) 은 그대로 작동한다.
  for r in
    with live as (
      select distinct on (b.user_id) b.user_id, b.last_seen_at,
             b.last_audio_progress_at, b.user_agent
        from public.brand_player_sessions b
       where b.revoked_at is null
         and b.last_seen_at > now() - interval '24 hours'
       order by b.user_id, b.last_seen_at desc nulls last
    )
    select coalesce(fs.store_name, au.email) as who,
           extract(epoch from (now() - l.last_seen_at))::int as hb_age,
           (l.user_agent like '%Build/%') as is_app,
           coalesce(substring(l.user_agent from 'Android [0-9.]+; ([A-Za-z0-9_+-]+)'),
                    '기기 미상') as model,
           -- 같은 곡 안에서 position 이 늘어난 가장 최근 증거. 곡 교체는 세지 않는다.
           (select extract(epoch from (now() - max(s2.sampled_at)))::int
              from public.store_position_samples s1
              join public.store_position_samples s2
                on s2.user_id    = s1.user_id
               and s2.track_id   = s1.track_id
               and s2.sampled_at > s1.sampled_at
               and s2.position_sec > s1.position_sec
             where s1.user_id = l.user_id) as advance_age,
           (select count(*) from public.store_position_samples s
             where s.user_id = l.user_id) as samples
      from live l
      join auth.users au on au.id = l.user_id
      left join public.franchise_stores fs on fs.store_id = l.user_id
     where l.last_audio_progress_at is null
       and not public._is_monitoring_exempt(l.user_id)
     order by hb_age
  loop
    v := v || format(E'%s — heartbeat %s초 · 오디오진행 미보고 (%s · %s)\n  └ position 전진 증거: %s · 표본 %s개\n',
      r.who, r.hb_age,
      case when r.is_app then '안드로이드 앱' else '브라우저' end, r.model,
      case when r.advance_age is null then '아직 없음'
           else format('%s초 전', r.advance_age) end,
      r.samples);
  end loop;
  return v;
end;
$function$;

comment on function public.srr_instrumentation_gap_text() is
  '오디오 진행(last_audio_progress_at)을 보고하지 않는 매장 목록. 안드로이드 앱은 '
  'APK 에 구워진 구 번들을 돌리므로 계측이 없다 — frozen 감지가 구조적으로 불가능하다. '
  '관측 전용, 알림 없음.';

-- ── srr_store_report: 계측 공백 구간 추가 ─────────────────────────────────
create or replace function public.srr_store_report(p_dry_run boolean default true)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_t text := ''; v_stores text := ''; v_idle_paid text := '';
  v_billing text := ''; v_infra text := ''; v_stack text := ''; v_new text := '';
  v_blind text := '';
  v_n_play int; v_n_out int; v_n_idle int; v_n_unstart int; v_n_total int;
  v_ours int; v_store int; v_unk int;
  v_title text; v_sev text; v_id bigint; r record;
  v_kind text; v_name text; v_events text;
begin
  select count(*) filter (where status='playing'), count(*) filter (where status='outage'),
         count(*) filter (where status='idle'), count(*) filter (where status='unstarted'),
         count(*),
         count(*) filter (where status='outage' and side='ours'),
         count(*) filter (where status='outage' and side='store'),
         count(*) filter (where status='outage' and side='unknown')
    into v_n_play, v_n_out, v_n_idle, v_n_unstart, v_n_total, v_ours, v_store, v_unk
    from public.srr_store_states();

  for r in select * from public.srr_store_states()
            where status in ('playing','outage')
            order by case status when 'playing' then 0 else 1 end, label loop
    if r.status = 'playing' then
      v_stores := v_stores || format(E'%s 정상\n', r.label);
    else
      v_stores := v_stores || format(E'%s 비정상 끊김 (%s부터)\n  └ 원인: %s — %s\n',
        r.label, r.since_kst,
        case r.side when 'store' then '매장 쪽' when 'ours' then '우리 쪽' else '판정 불가' end,
        r.cause);
    end if;
  end loop;

  for r in select * from public.srr_store_states() where status='idle' and paid order by fresh loop
    v_idle_paid := v_idle_paid || format(E'%s %s일 (%s)\n',
      r.label, round(r.fresh/86400.0,1), coalesce(r.subs,'구독 없음'));
  end loop;

  for r in select store_label, enterprise_name, amount, days_overdue
             from public.enterprise_billing_gaps(2) loop
    v_billing := v_billing || format(E'%s (%s) %s원 · %s일 연체\n',
      r.store_label, r.enterprise_name, r.amount, round(r.days_overdue));
  end loop;

  -- 신규 편입 24시간 — 근거를 두 개로 본다: 계정 개설 OR 가맹 등록.
  for r in
    with ev as (
      select u.id as uid,
             case when u.created_at > now() - interval '24 hours' then u.created_at end as acct_at,
             (select max(fs.created_at) from public.franchise_stores fs
               where fs.store_id = u.id
                 and fs.created_at > now() - interval '24 hours') as fs_at
        from public.users u
       where u.withdrawn_at is null and u.disabled_at is null
         and coalesce(u.account_type,'') <> 'artist'
         and not exists (select 1 from public.artist_profiles ap where ap.user_id = u.id)
         and not exists (select 1 from public.brand_player_monitoring_exempt e
                          where e.store_user_id = u.id)
    )
    select au.email,
           u.account_type,
           ev.acct_at,
           ev.fs_at,
           (select fs.store_name from public.franchise_stores fs
             where fs.store_id = ev.uid order by fs.created_at desc limit 1) as store_name,
           (select f.name from public.franchise_stores fs
              join public.franchises f on f.id = fs.franchise_id
             where fs.store_id = ev.uid order by fs.created_at desc limit 1) as fr_name,
           coalesce(
             (select f2.name from public.franchises f2
               where f2.created_by = ev.uid and f2.status = 'active' limit 1),
             (select ba.name from public.brand_accounts ba
               where ba.created_by = ev.uid and ba.deleted_at is null limit 1)
           ) as hq_name
      from ev
      join public.users u  on u.id  = ev.uid
      join auth.users  au on au.id = ev.uid
     where (ev.acct_at is not null or ev.fs_at is not null)
       and au.email not ilike '%@swk.today'
       and au.email not ilike '%@deudda%'
     order by greatest(coalesce(ev.acct_at, '-infinity'::timestamptz),
                       coalesce(ev.fs_at,   '-infinity'::timestamptz)) desc
  loop
    v_kind := case
                when r.store_name is not null
                  then format('가맹 · %s', coalesce(r.fr_name, '본사 미상'))
                when r.hq_name is not null
                  then format('본사 · %s', r.hq_name)
                else format('개별 사업자 · %s', coalesce(r.account_type, '미분류'))
              end;
    v_name  := coalesce(r.store_name, r.hq_name, r.email);
    v_events := concat_ws(' + ',
      case when r.acct_at is not null
           then '계정개설 ' || to_char(r.acct_at at time zone 'Asia/Seoul','MM-DD HH24:MI') end,
      case when r.fs_at is not null
           then '가맹등록 ' || to_char(r.fs_at   at time zone 'Asia/Seoul','MM-DD HH24:MI') end);
    v_new := v_new || format(E'%s — %s\n  └ %s · %s\n', v_name, v_kind, v_events, r.email);
  end loop;

  v_blind := public.srr_instrumentation_gap_text();

  select string_agg(format('%s %s %s회', jobname, status, n), ' · ') into v_infra
    from (select j.jobname, d.status, count(*) as n
            from cron.job_run_details d join cron.job j on j.jobid=d.jobid
           where j.jobname in ('srr-brand-player-health','srr-dispatch-notifications',
                               'srr-store-check','srr-position-sample')
             and d.start_time > now()-interval '70 minutes' group by 1,2) q;

  select string_agg(format('%s %s', kind, n), ' · ') into v_stack
    from (select kind, count(*) as n from public.admin_notifications
           where context->>'source' in ('srr_store_check_tick','store_check')
             and created_at > now() - interval '12 hours' group by kind) q;

  v_t := format(E'■ 이용매장 점검 — %s KST\n\n', to_char(now() at time zone 'Asia/Seoul','MM-DD HH24:MI'))
      || coalesce(nullif(v_stores,''), E'(재생 중·끊김 매장 없음)\n')
      || format(E'\n■ 요약\n재생 중 %s · 끊김 %s(우리 쪽 %s · 매장 쪽 %s · 판정 불가 %s) · 미사용 %s · 미개시 %s = 명부 %s곳\n',
                v_n_play, v_n_out, v_ours, v_store, v_unk, v_n_idle, v_n_unstart, v_n_total);
  if v_idle_paid <> '' then v_t := v_t || E'\n■ 유료인데 미사용 (이탈 신호 · 장애 아님)\n' || v_idle_paid; end if;
  if v_billing <> ''   then v_t := v_t || E'\n■ 미청구·연체\n' || v_billing; end if;
  if v_new <> ''       then v_t := v_t || E'\n■ 신규 편입 24시간 (명부에 자동 포함됨)\n' || v_new; end if;
  if v_blind <> ''     then v_t := v_t || E'\n■ 계측 공백 — frozen 감지 불가 (관측 전용 · 알림 없음)\n' || v_blind
                                       || E'  ※ 앱 안의 웹 코드는 APK 출시 시점에 고정된다(webDir: dist).\n'
                                       || E'    웹은 이미 올바르다 — 진짜 해결은 APK 재출시 + 점주 앱 업데이트다.\n'; end if;
  v_t := v_t || format(E'\n■ 인프라\n크론 70분: %s\n미발송 알림: %s건\n슬랙 적재 12시간: %s\n플레이리스트 최신: %s\n',
                       coalesce(v_infra,'(실행 기록 없음 — 확인 필요)'),
                       (select count(*) from public.admin_notifications where dispatched_at is null),
                       coalesce(v_stack,'없음'),
                       coalesce((select max(service_date)::text from public.brand_daily_playlists),'(없음)'));

  if v_n_out > 0 then
    v_title := format('[점검 %s] 끊김 %s곳 — 우리 쪽 %s · 매장 쪽 %s · 판정 불가 %s',
                      to_char(now() at time zone 'Asia/Seoul','HH24시'), v_n_out, v_ours, v_store, v_unk);
    v_sev := 'error';
  else
    v_title := format('[점검 %s] 매장 %s곳 재생 중 · 끊김 없음',
                      to_char(now() at time zone 'Asia/Seoul','HH24시'), v_n_play);
    v_sev := 'info';
  end if;

  if not p_dry_run then
    insert into public.admin_notifications (kind, severity, title, body, context, dispatch_attempts, created_at)
    values ('store_check_report', v_sev, v_title, v_t,
            jsonb_build_object('source','srr_store_report','playing',v_n_play,'outage',v_n_out,
                               'idle',v_n_idle,'unstarted',v_n_unstart,'total',v_n_total), 0, now())
    returning id into v_id;
  end if;

  return jsonb_build_object('ok', true, 'dry_run', p_dry_run, 'notification_id', v_id, 'title', v_title);
end;
$function$;
