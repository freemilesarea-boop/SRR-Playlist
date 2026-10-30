-- 0535 09/21시 보고까지 DB 로 이관 + 판정 로직을 공용 함수로 통합 (2026-10-30)
--
-- 왜: 보고마저 Claude 예약 작업이면 발사 때 승인창에서 멈춘다. 형님이 자는 동안
--     점검도 보고도 안 되는 것이 문제의 본질이었다. 보고도 SQL 로 옮긴다.
--
-- 그리고 0534 의 tick 은 판정 로직을 함수 안에 직접 갖고 있었다. 보고 함수에 그걸
-- 복사하면 반드시 어긋난다(이 작업 중에 실제로 세 번 어긋났다). 그래서 판정을
-- srr_store_states() 하나로 빼고 tick·report 가 **같은 함수**를 쓰게 했다.
-- 이 파일의 srr_store_check_tick 정의가 0534 의 것을 대체한다.
--
-- 판정 독트린 전문: docs/brand-player/MONITORING_ROUTINES.md

-- ───────────────────────────────────────────────────────────────────
-- 1) 공용 판정: 명부 + 축 + 상태 + 책임
-- ───────────────────────────────────────────────────────────────────
create or replace function public.srr_store_states()
returns table (
  uid uuid, email text, label text, owner text,
  cl_age int, stream_age int, hb_age int, progress_age int, shell_age int,
  fresh int, status text, side text, cause text, since_kst text,
  subs text, paid boolean, incident boolean
)
language sql stable security definer
set search_path to 'public'
as $function$
  with roster as (
    -- 명부 = 아티스트가 아닌 모든 live 계정. 신규 가입은 자동 포함.
    -- 제외는 반드시 계정 신원으로 — 라벨로 걸면 가맹 매장명이 붙는 순간 뚫린다.
    select u.id as uid, au.email
      from public.users u
      join auth.users au on au.id = u.id
     where coalesce(u.account_type,'') <> 'artist'
       and not exists (select 1 from public.artist_profiles ap where ap.user_id = u.id)
       and u.withdrawn_at is null and u.disabled_at is null
       and au.email not ilike '%@swk.today'
       and au.email not ilike '%@deudda.local'
       and au.email not ilike '%@deudda.com'
       and au.email not ilike '%@deudda.test'
       and not exists (select 1 from public.brand_player_monitoring_exempt e
                        where e.store_user_id = u.id)
  ), base as (
    select ro.uid, ro.email,
           coalesce((select fs.store_name from public.franchise_stores fs
                      where fs.store_id = ro.uid limit 1), ro.email) as label,
           coalesce((select f.name from public.franchise_stores fs
                       join public.franchises f on f.id = fs.franchise_id
                      where fs.store_id = ro.uid limit 1),
                    (select ba.name from public.brand_player_sessions s
                       join public.brand_accounts ba on ba.id = s.brand_id
                      where s.user_id = ro.uid order by s.last_seen_at desc limit 1),
                    '개별 사업자') as owner,
           (select extract(epoch from (now()-cl.updated_at))::int
              from public.continue_listening cl where cl.user_id = ro.uid) as cl_age,
           (select extract(epoch from (now()-max(ss.last_heartbeat_at)))::int
              from public.stream_sessions_v2 ss where ss.user_id = ro.uid) as stream_age,
           (select extract(epoch from (now()-max(b.last_seen_at)))::int
              from public.brand_player_sessions b
             where b.user_id = ro.uid and b.revoked_at is null) as hb_age,
           (select extract(epoch from (now()-max(b.last_audio_progress_at)))::int
              from public.brand_player_sessions b
             where b.user_id = ro.uid and b.revoked_at is null) as progress_age,
           (select extract(epoch from (now()-max(b.shell_last_seen_at)))::int
              from public.brand_player_sessions b
             where b.user_id = ro.uid and b.revoked_at is null) as shell_age,
           (select string_agg(distinct sb.plan_type||':'||sb.status, ',')
              from public.subscriptions sb where sb.user_id = ro.uid) as subs,
           exists (select 1 from public.subscriptions sb
                    where sb.user_id = ro.uid and sb.status = 'active') as paid,
           exists (select 1 from public.brand_player_incidents i
                    where i.store_user_id = ro.uid and i.resolved_at is null) as incident
      from roster ro
  ), f as (
    -- 판정 창은 가장 싱싱한 축으로 정한다. cl_age 단독으로 정하면
    -- continue_listening 을 거의 쓰지 않는 계정의 실제 끊김을 "미사용"으로 삼킨다.
    select b.*, least(coalesce(b.cl_age, 2147483647),
                      coalesce(b.stream_age, 2147483647),
                      coalesce(b.hb_age, 2147483647)) as fresh
      from base b
  )
  select f.uid, f.email, f.label, f.owner,
         f.cl_age, f.stream_age, f.hb_age, f.progress_age, f.shell_age, f.fresh,
         case when f.fresh >= 2147483647 then 'unstarted'
              when f.fresh < 300        then 'playing'
              when f.fresh >= 86400     then 'idle'
              else 'outage' end,
         -- ★ 매장 쪽이라고 쓰려면 서로 **독립인** 두 축이 함께 멈춰야 한다.
         --   heartbeat(메인 스레드 타이머)과 오디오 진행(미디어 타임라인)은 독립이다.
         --   hb_age 와 stream_age 는 같은 페이지의 타이머 둘이라 독립이 아니다 —
         --   둘이 같이 멈춘 것은 탭 닫힘과 우리 쪽 크래시를 구분하지 못한다.
         case when not (f.fresh < 2147483647 and f.fresh >= 300 and f.fresh < 86400) then null
              when f.hb_age is not null and f.progress_age is not null
                   and f.hb_age >= 300 and f.progress_age >= 300
                   and abs(f.hb_age - f.progress_age) <= 60 then 'store'
              when f.hb_age is not null and f.hb_age < 300
                   and f.progress_age is not null and f.progress_age >= 300 then 'ours'
              when f.shell_age is not null and f.shell_age < 300
                   and f.hb_age is not null and f.hb_age >= 300 then 'ours'
              else 'unknown' end,
         case when not (f.fresh < 2147483647 and f.fresh >= 300 and f.fresh < 86400) then null
              when f.hb_age is not null and f.progress_age is not null
                   and f.hb_age >= 300 and f.progress_age >= 300
                   and abs(f.hb_age - f.progress_age) <= 60
                then format('heartbeat %s초 · 오디오진행 %s초 — 독립된 두 축이 %s초 차이로 동시 정지. 오디오만 막히면 heartbeat 은 살아 있어야 하므로 탭 닫힘 또는 기기 절전/전원 차단이다',
                            f.hb_age, f.progress_age, abs(f.hb_age - f.progress_age))
              when f.hb_age is not null and f.hb_age < 300
                   and f.progress_age is not null and f.progress_age >= 300
                then format('heartbeat %s초(정상)인데 오디오진행 %s초 — 플레이어는 살아 있고 소리만 안 난다. 오디오 파이프라인',
                            f.hb_age, f.progress_age)
              when f.shell_age is not null and f.shell_age < 300
                   and f.hb_age is not null and f.hb_age >= 300
                then format('shell %s초(정상)인데 heartbeat %s초 — 껍데기는 살고 플레이어만 죽었다',
                            f.shell_age, f.hb_age)
              when f.hb_age is null
                then format('brand 세션이 없어 오디오 진행 축이 아예 없다. stream heartbeat %s초 한 축만 남아 탭 닫힘인지 우리 쪽 버그인지 가릴 수 없다. 계측 공백 자체가 우리 쪽 문제다',
                            coalesce(f.stream_age::text,'관측 불가'))
              when f.progress_age is null
                then format('heartbeat %s초로 멈췄지만 오디오 진행이 기록되지 않는 구 계측 클라이언트다. stream %s초도 같은 페이지의 타이머이므로 독립 증거가 아니다 — 탭 닫힘인지 우리 쪽 크래시인지 가릴 수 없다. 계측 공백 자체가 우리 쪽 문제다',
                            f.hb_age, coalesce(f.stream_age::text,'관측 불가'))
              else format('관측값이 어느 규칙에도 확정되지 않는다 (cl %s · stream %s · hb %s · progress %s)',
                          coalesce(f.cl_age::text,'없음'), coalesce(f.stream_age::text,'없음'),
                          coalesce(f.hb_age::text,'없음'), coalesce(f.progress_age::text,'없음'))
         end,
         case when f.fresh >= 2147483647 then null
              else to_char((now() - make_interval(secs => f.fresh)) at time zone 'Asia/Seoul','MM-DD HH24:MI')
         end,
         f.subs, f.paid, f.incident
    from f
$function$;

-- ───────────────────────────────────────────────────────────────────
-- 2) 매시간 적재 — 0534 의 정의를 대체한다 (판정은 공용 함수가 한다)
-- ───────────────────────────────────────────────────────────────────
create or replace function public.srr_store_check_tick(p_dry_run boolean default true)
returns jsonb
language plpgsql security definer
set search_path to 'public'
as $function$
declare
  r record; v_rows jsonb := '[]'::jsonb; v_inserted int := 0; v_hit int;
  v_kind text; v_sev text; v_title text; v_body text;
begin
  for r in select * from public.srr_store_states() where status = 'outage' loop
    if r.side = 'store' then
      v_kind := 'store_check_defense_sms'; v_sev := 'warning';
      v_title := format('[방어문자 대기] %s (%s) — 매장 쪽', r.label, r.owner);
      v_body := format(E'[듣다] %s 매장 음악 재생이 %s(KST)부터 중단된 것으로 확인됩니다.\n'
                    || E'서버·음원 전송은 정상이며, 매장 기기에서 재생이 멈춘 상태입니다.\n'
                    || E'매장 태블릿/PC 화면을 한 번 터치하거나 새로고침해 주시면 복구됩니다.\n'
                    || E'계속 재생되지 않으면 이 메시지에 회신해 주세요.\n\n'
                    || E'--- 판정 근거 (내부용 · srr_store_check_tick) ---\n%s',
                       r.label, r.since_kst, r.cause);
    elsif r.side = 'ours' then
      v_kind := 'store_check_ours'; v_sev := 'error';
      v_title := format('[점검·우리 쪽] %s (%s)', r.label, r.owner);
      v_body := format(E'%s 재생이 %s(KST)부터 멈췄습니다.\n\n판정: 우리 쪽\n%s\n\n점주 조작으로 해결되지 않습니다. 코드·인프라 확인이 필요합니다.',
                       r.label, r.since_kst, r.cause);
    else
      v_kind := 'store_check_ours'; v_sev := 'warning';
      v_title := format('[점검·판정 불가] %s (%s)', r.label, r.owner);
      v_body := format(E'%s 재생이 %s(KST)부터 멈췄습니다.\n\n판정: 불가 — 방어 문자를 만들지 않았다\n%s\n\n증거 없이 매장 쪽으로 넘기지 않는다.',
                       r.label, r.since_kst, r.cause);
    end if;

    v_rows := v_rows || jsonb_build_object('label', r.label, 'side', r.side, 'fresh', r.fresh,
      'cooldown_blocks', exists (select 1 from public.admin_notifications an
                                  where an.kind = v_kind and an.context->>'store_uid' = r.uid::text
                                    and an.created_at > now() - interval '6 hours'));

    if not p_dry_run then
      -- 같은 매장 같은 kind 는 6시간에 1회. 이 조건을 빼면 하루 24건이 쌓인다.
      insert into public.admin_notifications (kind, severity, title, body, context, dispatch_attempts, created_at)
      select v_kind, v_sev, v_title, v_body,
             jsonb_build_object('store_uid', r.uid, 'side', r.side, 'source', 'srr_store_check_tick',
                                'cl_age', r.cl_age, 'stream_age', r.stream_age,
                                'hb_age', r.hb_age, 'progress_age', r.progress_age), 0, now()
       where not exists (select 1 from public.admin_notifications an
                          where an.kind = v_kind and an.context->>'store_uid' = r.uid::text
                            and an.created_at > now() - interval '6 hours');
      get diagnostics v_hit = row_count;
      v_inserted := v_inserted + v_hit;
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'dry_run', p_dry_run, 'checked_at', now(),
                            'outages', jsonb_array_length(v_rows), 'inserted', v_inserted, 'rows', v_rows);
end;
$function$;

-- ───────────────────────────────────────────────────────────────────
-- 3) 09/21시 보고 — 슬랙으로. 사람·Claude 불필요
-- ───────────────────────────────────────────────────────────────────
create or replace function public.srr_store_report(p_dry_run boolean default true)
returns jsonb
language plpgsql security definer
set search_path to 'public'
as $function$
declare
  v_t text := ''; v_stores text := ''; v_idle_paid text := '';
  v_billing text := ''; v_infra text := ''; v_stack text := ''; v_new text := '';
  v_n_play int; v_n_out int; v_n_idle int; v_n_unstart int; v_n_total int;
  v_ours int; v_store int; v_unk int;
  v_title text; v_sev text; v_id bigint; r record;
begin
  select count(*) filter (where status='playing'), count(*) filter (where status='outage'),
         count(*) filter (where status='idle'), count(*) filter (where status='unstarted'),
         count(*),
         count(*) filter (where status='outage' and side='ours'),
         count(*) filter (where status='outage' and side='store'),
         count(*) filter (where status='outage' and side='unknown')
    into v_n_play, v_n_out, v_n_idle, v_n_unstart, v_n_total, v_ours, v_store, v_unk
    from public.srr_store_states();

  -- 형님 지정 형식: 정상 먼저, 그다음 끊김 + 원인 한 줄.
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

  -- 유료인데 미사용 = 이탈 신호. 장애가 아니므로 끊김으로 올리지 않는다.
  for r in select * from public.srr_store_states() where status='idle' and paid order by fresh loop
    v_idle_paid := v_idle_paid || format(E'%s %s일 (%s)\n',
      r.label, round(r.fresh/86400.0,1), coalesce(r.subs,'구독 없음'));
  end loop;

  for r in select store_label, enterprise_name, amount, days_overdue
             from public.enterprise_billing_gaps(2) loop
    v_billing := v_billing || format(E'%s (%s) %s원 · %s일 연체\n',
      r.store_label, r.enterprise_name, r.amount, round(r.days_overdue));
  end loop;

  for r in select au.email, u.account_type, to_char(u.created_at at time zone 'Asia/Seoul','MM-DD HH24:MI') as kst
             from public.users u join auth.users au on au.id=u.id
            where coalesce(u.account_type,'') <> 'artist'
              and not exists (select 1 from public.artist_profiles ap where ap.user_id=u.id)
              and u.withdrawn_at is null and u.disabled_at is null
              and au.email not ilike '%@swk.today' and au.email not ilike '%@deudda%'
              and u.created_at > now() - interval '24 hours'
            order by u.created_at desc loop
    v_new := v_new || format(E'%s (%s) %s\n', r.email, coalesce(r.account_type,'미분류'), r.kst);
  end loop;

  select string_agg(format('%s %s %s회', jobname, status, n), ' · ') into v_infra
    from (select j.jobname, d.status, count(*) as n
            from cron.job_run_details d join cron.job j on j.jobid=d.jobid
           where j.jobname in ('srr-brand-player-health','srr-dispatch-notifications','srr-store-check')
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
  if v_new <> ''       then v_t := v_t || E'\n■ 신규 가입 24시간 (명부에 자동 포함됨)\n' || v_new; end if;
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

-- 09:00 / 21:00 KST = 00:00 / 12:00 UTC (pg_cron 은 UTC)
do $$ begin
  if exists (select 1 from cron.job where jobname='srr-store-report') then
    perform cron.unschedule('srr-store-report');
  end if;
end $$;
select cron.schedule('srr-store-report', '0 0,12 * * *',
                     $cmd$select public.srr_store_report(false);$cmd$);
