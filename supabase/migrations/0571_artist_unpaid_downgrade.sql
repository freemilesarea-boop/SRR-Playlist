-- 0571 — 결제가 끊긴 아티스트 회원은 이용권 등급을 무료로 내린다(전곡 감상 차단).
--
-- 왜: 아티스트 도구(업로드·수정·유통 신청 등)는 이용 기간이 끝나면 서버(artist_has_paid_access)가
--   이미 막는다. 그런데 감상 등급(users.membership_tier / subscription_type)은 해지·환불 통보 때만
--   내려가서, 재결제가 실패한 아티스트도 계속 전곡을 듣고 있었다(2026-11-28 확인 9명).
--   운영 결정(2026-11-28): 아티스트 회원은 결제가 끊기면 가차 없이 무료로 내린다. 발매 음원은 그대로 둔다.
--
-- 규칙
--   · 대상: 아티스트 플랜(artist_*) 구독이 active 인데 이용 기간이 하루 넘게 지났고, 직원 계정이 아닌 회원
--   · 처리: membership_tier / subscription_type 을 'free' 로. 처리 기록을 남기고 관리자 알림 한 건
--   · 복구: 같은 구독의 이용 기간이 다시 미래로 바뀌면(정기결제 성공·미납분 링크 결제 모두) 원래 등급으로 되돌린다
--   · 매시 정각 37분 실행

create table if not exists public.artist_unpaid_downgrades (
  id bigserial primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  subscription_id uuid not null references public.subscriptions(id) on delete cascade,
  period_end timestamptz not null,
  prev_membership_tier text,
  prev_subscription_type text,
  downgraded_at timestamptz not null default now(),
  restored_at timestamptz
);
create unique index if not exists uq_artist_unpaid_downgrades_open
  on public.artist_unpaid_downgrades (subscription_id) where restored_at is null;
alter table public.artist_unpaid_downgrades enable row level security;
revoke all on public.artist_unpaid_downgrades from anon, authenticated;

create or replace function public.cron_downgrade_unpaid_artists()
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  r record;
  v_n int := 0;
  v_names text := '';
begin
  for r in
    select s.id as subscription_id, s.user_id, s.current_period_end,
           u.membership_tier, u.subscription_type,
           public._billing_member_label(u.full_name, u.nickname) as label
      from public.subscriptions s
      join public.users u on u.id = s.user_id
     where s.status = 'active'
       and s.plan_type like 'artist%'
       and s.enterprise_subscription_id is null
       and s.current_period_end is not null
       and s.current_period_end < now() - interval '1 day'
       and u.withdrawn_at is null
       and coalesce(u.role, '') <> 'admin'
       and not exists (select 1 from public.billing_staff_accounts b where b.user_id = s.user_id)
       -- 같은 사람에게 이용 기간이 남은 다른 구독이 있으면 건드리지 않는다
       and not exists (
         select 1 from public.subscriptions s2
          where s2.user_id = s.user_id and s2.id <> s.id
            and s2.status in ('active', 'cancel_scheduled')
            and s2.current_period_end > now())
       and (coalesce(u.membership_tier, 'free') <> 'free' or coalesce(u.subscription_type, 'free') <> 'free')
     for update of u skip locked
  loop
    insert into public.artist_unpaid_downgrades
      (user_id, subscription_id, period_end, prev_membership_tier, prev_subscription_type)
    values (r.user_id, r.subscription_id, r.current_period_end, r.membership_tier, r.subscription_type)
    on conflict (subscription_id) where restored_at is null do nothing;

    update public.users
       set membership_tier = 'free', subscription_type = 'free'
     where id = r.user_id;

    v_n := v_n + 1;
    v_names := v_names || case when v_n > 1 then ', ' else '' end || r.label;
  end loop;

  if v_n > 0 then
    insert into public.admin_notifications (kind, severity, title, body, context)
    values ('artist_unpaid_downgrade', 'info',
      '미납 아티스트 ' || v_n || '명 무료 전환',
      left(v_names, 500) || ' — 결제가 끊겨 감상 등급을 무료로 내렸습니다. 결제되면 자동으로 되돌아갑니다.',
      jsonb_build_object('count', v_n, 'tab', 'billing-attention'));
  end if;

  return jsonb_build_object('downgraded', v_n);
end;
$function$;
revoke all on function public.cron_downgrade_unpaid_artists() from public, anon, authenticated;

-- 결제로 이용 기간이 다시 미래가 되면 원래 등급으로 되돌린다.
-- 정기결제 성공(payapp-feedback)·미납분 링크(apply_arrears_payment)·관리자 수동 연장 모두 이 경로를 지난다.
create or replace function public._restore_artist_after_payment()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  d record;
begin
  if new.current_period_end is null or new.current_period_end <= now() then return new; end if;
  if old.current_period_end is not distinct from new.current_period_end then return new; end if;
  if new.status not in ('active', 'cancel_scheduled') then return new; end if;

  for d in
    select id, user_id, prev_membership_tier, prev_subscription_type
      from public.artist_unpaid_downgrades
     where user_id = new.user_id and restored_at is null
  loop
    update public.users
       set membership_tier = case when coalesce(membership_tier, 'free') = 'free'
                                  then coalesce(d.prev_membership_tier, 'individual') else membership_tier end,
           subscription_type = case when coalesce(subscription_type, 'free') = 'free'
                                    then coalesce(d.prev_subscription_type, 'individual') else subscription_type end
     where id = d.user_id;
    update public.artist_unpaid_downgrades set restored_at = now() where id = d.id;
  end loop;
  return new;
end;
$function$;
revoke all on function public._restore_artist_after_payment() from public, anon, authenticated;

drop trigger if exists trg_restore_artist_after_payment on public.subscriptions;
create trigger trg_restore_artist_after_payment
  after update of current_period_end, status on public.subscriptions
  for each row execute function public._restore_artist_after_payment();

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'srr-artist-unpaid-downgrade';
    perform cron.schedule('srr-artist-unpaid-downgrade', '37 * * * *', 'select public.cron_downgrade_unpaid_artists();');
  end if;
end;
$$;
