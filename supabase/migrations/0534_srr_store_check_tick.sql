-- 0534 이용매장 매시간 점검을 DB 안으로 옮긴다 (2026-10-30)
--
-- 왜: 매시간 점검을 Claude 예약 작업으로 돌렸더니 발사 때마다 승인창에서 멈췄다.
--     형님이 자는 동안 점검이 아예 안 됐다. 승인창에 의존하는 설계가 틀렸다.
--     판정은 전부 SQL 로 가능하므로 pg_cron 으로 옮겨 사람 없이 돌게 한다.
--
-- 적재 경로: admin_notifications 에 INSERT → srr-dispatch-notifications(매분)이 슬랙 발송.
-- 쿨다운: 같은 매장 같은 kind 는 6시간에 1회. 빼면 하루 24건이 쌓인다.
--
-- 판정 독트린 전문: docs/brand-player/MONITORING_ROUTINES.md
--
-- 주의: 이 함수는 incident 행·세션 행·스키마를 건드리지 않는다.
--       쓰기는 admin_notifications INSERT 뿐이다.

create or replace function public.srr_store_check_tick(p_dry_run boolean default true)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r record;
  v_rows jsonb := '[]'::jsonb;
  v_inserted int := 0;
  v_side text; v_cause text; v_title text; v_body text;
  v_kind text; v_sev text; v_since text; v_hit int;
  v_fresh int;
  c_outage_min constant int := 300;
  c_outage_max constant int := 86400;
  c_big constant int := 2147483647;
begin
  for r in
    with roster as (
      -- 명부 = 아티스트가 아닌 모든 live 계정. 신규 가입은 자동으로 들어온다.
      -- 제외는 반드시 **계정 신원**으로 한다 — 라벨로 걸면 가맹 매장명이 붙는 순간 뚫린다.
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
    )
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
             where b.user_id = ro.uid and b.revoked_at is null) as shell_age
      from roster ro
  loop
    -- 판정 창은 **가장 싱싱한 축**으로 정한다. cl_age 단독으로 정하면
    -- continue_listening 을 거의 쓰지 않는 계정의 실제 끊김을 "미사용"으로 삼킨다
    -- (2026-10-30 minnnnng27 사례: cl 14일인데 brand heartbeat 은 4.3시간 전 정지).
    v_fresh := least(coalesce(r.cl_age, c_big),
                     coalesce(r.stream_age, c_big),
                     coalesce(r.hb_age, c_big));

    if v_fresh < c_outage_min then continue; end if;   -- 정상
    if v_fresh >= c_outage_max then continue; end if;  -- 미사용·미개시 (장애 아님)

    -- 매장 쪽이라고 쓰려면 **서로 독립인 두 축**이 함께 멈춰야 한다.
    -- heartbeat(메인 스레드 타이머)과 오디오 진행(미디어 타임라인)은 독립이다:
    -- 오디오만 막히면 heartbeat 은 살아 있어야 하므로 인과가 한쪽으로만 성립한다.
    -- hb_age 와 stream_age 는 같은 페이지의 메인 스레드 타이머 둘이라 독립이 아니다 —
    -- 둘이 같이 멈춘 것은 탭 닫힘과 우리 쪽 페이지 크래시를 구분하지 못한다.
    if r.hb_age is not null and r.progress_age is not null
       and r.hb_age >= c_outage_min and r.progress_age >= c_outage_min
       and abs(r.hb_age - r.progress_age) <= 60 then
      v_side := 'store';
      v_cause := format('heartbeat %s초 · 오디오진행 %s초 — 독립된 두 축이 %s초 차이로 동시 정지. 오디오만 막히면 heartbeat 은 살아 있어야 하므로 탭 닫힘 또는 기기 절전/전원 차단이다',
                        r.hb_age, r.progress_age, abs(r.hb_age - r.progress_age));
    elsif r.hb_age is not null and r.hb_age < c_outage_min
          and r.progress_age is not null and r.progress_age >= c_outage_min then
      v_side := 'ours';
      v_cause := format('heartbeat %s초(정상)인데 오디오진행 %s초 — 플레이어는 살아 있고 소리만 안 난다. 오디오 파이프라인',
                        r.hb_age, r.progress_age);
    elsif r.shell_age is not null and r.shell_age < c_outage_min
          and r.hb_age is not null and r.hb_age >= c_outage_min then
      v_side := 'ours';
      v_cause := format('shell %s초(정상)인데 heartbeat %s초 — 껍데기는 살고 플레이어만 죽었다',
                        r.shell_age, r.hb_age);
    elsif r.hb_age is null then
      v_side := 'unknown';
      v_cause := format('brand 세션이 없어 오디오 진행 축이 아예 없다. stream heartbeat %s초 한 축만 남아 탭 닫힘인지 우리 쪽 버그인지 가릴 수 없다. **계측 공백 자체가 우리 쪽 문제**다',
                        coalesce(r.stream_age::text,'관측 불가'));
    elsif r.progress_age is null then
      v_side := 'unknown';
      v_cause := format('heartbeat %s초로 멈췄지만 오디오 진행이 기록되지 않는 구 계측 클라이언트다(progress 없음). stream %s초도 같은 페이지의 타이머이므로 독립 증거가 아니다 — 탭 닫힘인지 우리 쪽 크래시인지 가릴 수 없다. **계측 공백 자체가 우리 쪽 문제**다',
                        r.hb_age, coalesce(r.stream_age::text,'관측 불가'));
    else
      v_side := 'unknown';
      v_cause := format('관측값이 어느 규칙에도 확정되지 않는다 (cl %s · stream %s · hb %s · progress %s)',
                        coalesce(r.cl_age::text,'없음'), coalesce(r.stream_age::text,'없음'),
                        coalesce(r.hb_age::text,'없음'), coalesce(r.progress_age::text,'없음'));
    end if;

    v_since := to_char((now() - make_interval(secs => v_fresh)) at time zone 'Asia/Seoul', 'HH24:MI');

    if v_side = 'store' then
      v_kind := 'store_check_defense_sms'; v_sev := 'warning';
      v_title := format('[방어문자 대기] %s (%s) — 매장 쪽', r.label, r.owner);
      v_body := format(E'[듣다] %s 매장 음악 재생이 %s(KST)부터 중단된 것으로 확인됩니다.\n'
                    || E'서버·음원 전송은 정상이며, 매장 기기에서 재생이 멈춘 상태입니다.\n'
                    || E'매장 태블릿/PC 화면을 한 번 터치하거나 새로고침해 주시면 복구됩니다.\n'
                    || E'계속 재생되지 않으면 이 메시지에 회신해 주세요.\n\n'
                    || E'--- 판정 근거 (내부용 · srr_store_check_tick) ---\n%s',
                      r.label, v_since, v_cause);
    elsif v_side = 'ours' then
      v_kind := 'store_check_ours'; v_sev := 'error';
      v_title := format('[점검·우리 쪽] %s (%s)', r.label, r.owner);
      v_body := format(E'%s 재생이 %s(KST)부터 멈췄습니다.\n\n판정: 우리 쪽\n%s\n\n점주 조작으로 해결되지 않습니다. 코드·인프라 확인이 필요합니다.',
                      r.label, v_since, v_cause);
    else
      v_kind := 'store_check_ours'; v_sev := 'warning';
      v_title := format('[점검·판정 불가] %s (%s)', r.label, r.owner);
      v_body := format(E'%s 재생이 %s(KST)부터 멈췄습니다.\n\n판정: 불가 — 방어 문자를 만들지 않았다\n%s\n\n증거 없이 매장 쪽으로 넘기지 않는다.',
                      r.label, v_since, v_cause);
    end if;

    v_rows := v_rows || jsonb_build_object(
      'label', r.label, 'owner', r.owner, 'side', v_side, 'fresh', v_fresh,
      'cl_age', r.cl_age, 'stream_age', r.stream_age,
      'hb_age', r.hb_age, 'progress_age', r.progress_age,
      'since_kst', v_since, 'cause', v_cause,
      'cooldown_blocks', exists (select 1 from public.admin_notifications an
                                  where an.kind = v_kind
                                    and an.context->>'store_uid' = r.uid::text
                                    and an.created_at > now() - interval '6 hours'));

    if not p_dry_run then
      insert into public.admin_notifications (kind, severity, title, body, context, dispatch_attempts, created_at)
      select v_kind, v_sev, v_title, v_body,
             jsonb_build_object('store_uid', r.uid, 'side', v_side,
                                'source', 'srr_store_check_tick',
                                'cl_age', r.cl_age, 'stream_age', r.stream_age,
                                'hb_age', r.hb_age, 'progress_age', r.progress_age), 0, now()
       where not exists (select 1 from public.admin_notifications an
                          where an.kind = v_kind
                            and an.context->>'store_uid' = r.uid::text
                            and an.created_at > now() - interval '6 hours');
      get diagnostics v_hit = row_count;
      v_inserted := v_inserted + v_hit;
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'dry_run', p_dry_run, 'checked_at', now(),
                            'outages', jsonb_array_length(v_rows),
                            'inserted', v_inserted, 'rows', v_rows);
end;
$function$;

-- 매시간 :30 — Claude 예약 작업(매시간)은 이 크론으로 대체했으므로 비활성화했다.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'srr-store-check') then
    perform cron.unschedule('srr-store-check');
  end if;
end $$;

select cron.schedule('srr-store-check', '30 * * * *',
                     $cmd$select public.srr_store_check_tick(false);$cmd$);
