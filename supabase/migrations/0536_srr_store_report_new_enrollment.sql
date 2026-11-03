-- 0536 — 이용매장 점검 보고: 신규 편입을 "읽히게" 만든다
--
-- 배경 (2026-11-03)
--   이루밍 스터디카페 김포장기역점이 20:54 에 개설됐고, 21:00 보고에 실제로 실렸다.
--   그런데 찍힌 문구는 `eroomingkpjg@gmail.com (business) 11-03 20:54` 한 줄이었다.
--   명부 자동 편입은 동작했지만, 사람이 그 줄을 보고 "이루밍 신규 가맹"이라고
--   읽을 수가 없었다. 그래서 형님이 먼저 눈치채고 물어봤다.
--   편입이 자동인 것과, 편입이 보고에서 읽히는 것은 다른 문제다.
--
-- 구멍 2 — 계정 나이로만 신규를 판정했다
--   기존 `v_new` 는 `users.created_at > now() - 24h` 하나만 봤다.
--   가맹점은 계정 개설과 가맹 등록이 분리돼 있다. 기존 계정에 가맹점만
--   새로 붙으면 신규로 전혀 잡히지 않는다.
--   실례: 이루밍 분리송출 테스트점 — 계정 2026-05-17, 가맹 등록 2026-10-30.
--   "앞으로 생기는 모든 가맹"을 자동으로 보려면 가맹 등록 시각도 봐야 한다.
--
-- 이 마이그레이션이 하는 일
--   `srr_store_report()` 의 신규 구간만 교체한다.
--   1) 신규 판정 근거를 두 개로 늘린다 — 계정 개설 24시간 OR 가맹 등록 24시간
--   2) 한 줄에 매장명·구분(가맹/본사/개별 사업자)·본사명·근거 시각·이메일을 모두 싣는다
--   3) 같은 계정에서 두 사건이 모두 일어나면 한 줄로 합친다
--
-- 바꾸지 않는 것 (의도적)
--   · 명부 정의(`srr_store_states`) — 손대지 않는다. 편입은 이미 자동이다.
--   · 감지 함수(`detect_brand_player_incidents`) — 손대지 않는다.
--   · 제외 기준은 계정 신원으로만 한다. 라벨로 거르지 않는다.
--     (2026-10-30 에 라벨 기준 제외가 실제로 뚫린 전례가 있다)
--   · franchise_stores · users · subscriptions · incidents 에 쓰지 않는다. 읽기만 한다.

create or replace function public.srr_store_report(p_dry_run boolean default true)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_t text := ''; v_stores text := ''; v_idle_paid text := '';
  v_billing text := ''; v_infra text := ''; v_stack text := ''; v_new text := '';
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

  -- ── 신규 편입 24시간 ────────────────────────────────────────────────
  -- 근거를 두 개로 본다: 계정 개설 OR 가맹 등록.
  -- 가맹점은 계정과 가맹 등록이 분리돼 있어서, 계정 나이만 보면
  -- 기존 계정에 새로 붙은 가맹점을 영구히 놓친다.
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
         -- 제외는 계정 신원으로만 한다 (명부와 같은 기준)
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
    -- 매장 이름을 추측하지 않는다. 없으면 이메일을 그대로 쓴다.
    v_name  := coalesce(r.store_name, r.hq_name, r.email);
    v_events := concat_ws(' + ',
      case when r.acct_at is not null
           then '계정개설 ' || to_char(r.acct_at at time zone 'Asia/Seoul','MM-DD HH24:MI') end,
      case when r.fs_at is not null
           then '가맹등록 ' || to_char(r.fs_at   at time zone 'Asia/Seoul','MM-DD HH24:MI') end);
    v_new := v_new || format(E'%s — %s\n  └ %s · %s\n', v_name, v_kind, v_events, r.email);
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
  if v_new <> ''       then v_t := v_t || E'\n■ 신규 편입 24시간 (명부에 자동 포함됨)\n' || v_new; end if;
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
