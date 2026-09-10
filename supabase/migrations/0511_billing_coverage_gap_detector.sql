-- 0511 — 결제 사각지대 감지기 (숙대점 사례 재발 방지)
--
-- 배경:
--   르하임스터디카페s 숙대점(김가희)은 페이앱에 정기결제가 등록돼 있었지만
--   우리 DB 에는 subscriptions / payment_orders / payapp_webhook_events 가 전부 0건이었고,
--   subscription_type='free' 인 채로 매장 재생이 돌았다. 아무도 몰랐다.
--
-- 기존 감지기(alert_billing_recording_drift)가 왜 못 잡았나:
--   그 함수는 "웹훅은 왔는데 payment_orders 가 없는 건"만 본다.
--   즉 **웹훅을 기준선으로 삼는다.** 웹훅 자체가 없으면 드리프트 0으로 보인다.
--   숙대점은 정확히 그 사각지대에 있었다.
--
-- 이 감지기는 기준선을 뒤집는다 — **재생 실적**을 기준으로 본다.
--   "음악은 틀고 있는데 결제 흔적이 없는 매장" 은 웹훅 유무와 무관하게 걸린다.
--
-- 두 가지를 잡는다:
--   A) 결제기록 없이 재생 중인 매장 (숙대점 유형)
--   B) subscription_type ↔ membership_tier 불일치 (숙대점의 실제 저장 상태)
--      한쪽만 보고 판단하는 코드가 있어 조용한 등급 강등/승격이 생긴다.

-- ----------------------------------------------------------------------------
-- 1) 뷰 — 결제 사각지대 매장
-- ----------------------------------------------------------------------------
create or replace view public.v_billing_coverage_gap as
with recent_play as (
  -- 최근 3일 안에 실제 재생 실적이 있는 계정 (검증된 재생 시간 기준)
  select s.user_id,
         sum(s.verified_seconds) as verified_seconds_3d,
         max(s.created_at) as last_played_at
  from public.stream_sessions_v2 s
  where s.user_id is not null
    and s.created_at > now() - interval '3 days'
  group by s.user_id
  having sum(s.verified_seconds) > 600      -- 10분 이상 = 실사용 매장
),
store_user as (
  -- 매장으로 볼 근거: 가맹점 등록 또는 매장 등급
  select u.id as user_id,
         u.nickname,
         u.subscription_type,
         u.membership_tier,
         (select fs.store_name from public.franchise_stores fs
           where fs.store_id = u.id limit 1) as store_name,
         exists (select 1 from public.franchise_stores fs where fs.store_id = u.id) as is_franchise
  from public.users u
)
select su.user_id,
       su.nickname,
       su.store_name,
       su.subscription_type,
       su.membership_tier,
       rp.verified_seconds_3d,
       rp.last_played_at,
       -- A) 결제 흔적이 전혀 없음
       not exists (select 1 from public.payment_orders o where o.user_id = su.user_id)
         and not exists (select 1 from public.subscriptions sb where sb.user_id = su.user_id)
         as no_payment_record,
       -- B) 두 등급 컬럼이 서로 다름
       coalesce(su.subscription_type,'') is distinct from coalesce(su.membership_tier,'')
         as tier_mismatch
from store_user su
join recent_play rp on rp.user_id = su.user_id
where su.is_franchise                                   -- 가맹점이거나
   or su.membership_tier in ('business')                -- 매장 등급인 계정만 대상
;

comment on view public.v_billing_coverage_gap is
  '재생 실적은 있는데 결제 기록이 없거나 등급 컬럼이 불일치하는 매장. 웹훅 유무와 무관하게 잡는다(0511).';

-- ----------------------------------------------------------------------------
-- 2) 점검 함수 — 문제 건수 요약
-- ----------------------------------------------------------------------------
create or replace function public.check_billing_coverage_gap()
returns table (
  gap_count int,
  no_payment_count int,
  mismatch_count int
)
language sql
security definer
set search_path = public
as $$
  select
    count(*) filter (where no_payment_record or tier_mismatch)::int,
    count(*) filter (where no_payment_record)::int,
    count(*) filter (where tier_mismatch)::int
  from public.v_billing_coverage_gap;
$$;

revoke all on function public.check_billing_coverage_gap() from public, anon;
grant execute on function public.check_billing_coverage_gap() to service_role;

-- ----------------------------------------------------------------------------
-- 3) 알림 — 기존 admin_notifications 경로 재사용 (Slack/이메일 설정 그대로 탄다)
--
--    dedup: 동일 매장 집합이면 7일간 침묵 (alert_billing_recording_drift 와 같은 방식)
-- ----------------------------------------------------------------------------
create or replace function public.alert_billing_coverage_gap()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gap int;
  v_no_pay int;
  v_mismatch int;
  v_fingerprint text;
  v_last_fingerprint text;
  v_last_at timestamptz;
  v_names text;
begin
  select gap_count, no_payment_count, mismatch_count
    into v_gap, v_no_pay, v_mismatch
  from public.check_billing_coverage_gap();

  if coalesce(v_gap, 0) <= 0 then
    return 0;
  end if;

  select md5(coalesce(string_agg(g.user_id::text, ',' order by g.user_id), '')),
         string_agg(coalesce(g.store_name, g.nickname, '(이름없음)'), ', ' order by g.user_id)
    into v_fingerprint, v_names
  from public.v_billing_coverage_gap g
  where g.no_payment_record or g.tier_mismatch;

  select n.context->>'fingerprint', n.created_at
    into v_last_fingerprint, v_last_at
  from public.admin_notifications n
  where n.kind = 'billing_coverage_gap'
  order by n.created_at desc
  limit 1;

  if v_last_fingerprint is not null
     and v_last_fingerprint = v_fingerprint
     and v_last_at > now() - interval '7 days' then
    return v_gap;
  end if;

  insert into public.admin_notifications
    (kind, severity, title, body, context, dispatch_attempts, created_at)
  values
    ('billing_coverage_gap', 'error',
     '결제 사각지대 매장 감지 (' || v_gap || '곳)',
     '음악은 재생 중인데 결제 기록이 없거나 등급이 불일치하는 매장이 있습니다: ' || v_names ||
     ' — 결제기록 없음 ' || v_no_pay || '곳 / 등급 불일치 ' || v_mismatch || '곳. ' ||
     'public.v_billing_coverage_gap 뷰에서 상세 확인 후 페이앱 대조가 필요합니다.' ||
     case when v_last_fingerprint = v_fingerprint
          then ' [7일 경과 미해소 리마인드]' else '' end,
     jsonb_build_object('fingerprint', v_fingerprint, 'gap_count', v_gap,
                        'no_payment_count', v_no_pay, 'mismatch_count', v_mismatch,
                        'source', 'alert_billing_coverage_gap'),
     0, now());

  return v_gap;
end;
$$;

revoke all on function public.alert_billing_coverage_gap() from public, anon;
grant execute on function public.alert_billing_coverage_gap() to service_role;

-- ----------------------------------------------------------------------------
-- 4) 스케줄 — 매일 06:10 KST (기존 billing drift check 06:00 바로 뒤)
-- ----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('srr-billing-coverage-gap')
      where exists (select 1 from cron.job where jobname = 'srr-billing-coverage-gap');
    perform cron.schedule('srr-billing-coverage-gap', '10 21 * * *',
                          'select public.alert_billing_coverage_gap();');
  end if;
end;
$$;
