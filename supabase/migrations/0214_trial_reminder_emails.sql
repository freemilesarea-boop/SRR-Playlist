-- 0214 — 무료 체험 D-day 자동 알림 메일 인프라
--
-- 매일 cron 이 호출하는 dispatch-trial-reminders edge function 에서 사용.
-- D-3 / D-1 / 만료-당일 시점에 사용자에게 알림 메일 발송 (멱등 — 이미 보낸 건 다시 안 감).
--
-- 추가 컬럼: public.users 에 3개 timestamp (D-3 / D-1 / expired)
-- email 은 auth.users 에 있으므로 JOIN, store_name 은 business_profiles, business_name 은 business_verification_profiles 에서 가져옴.

alter table public.users
  add column if not exists trial_email_d3_sent_at timestamptz,
  add column if not exists trial_email_d1_sent_at timestamptz,
  add column if not exists trial_email_expired_sent_at timestamptz;

comment on column public.users.trial_email_d3_sent_at is
  '무료 체험 D-3 알림 메일 발송 시각. NULL이면 미발송.';
comment on column public.users.trial_email_d1_sent_at is
  '무료 체험 D-1 알림 메일 발송 시각. NULL이면 미발송.';
comment on column public.users.trial_email_expired_sent_at is
  '무료 체험 만료 후 결제 유도 메일 발송 시각. NULL이면 미발송.';

create or replace function public.trial_reminder_candidates()
returns table (
  user_id uuid,
  email text,
  store_name text,
  business_name text,
  free_trial_ends_at timestamptz,
  kind text
)
language sql
security definer
set search_path = public
as $$
  select
    u.id,
    au.email::text as email,
    bp.store_name,
    bv.business_name,
    u.free_trial_ends_at,
    'd-3'::text as kind
  from public.users u
  join auth.users au on au.id = u.id
  left join public.business_profiles bp on bp.user_id = u.id
  left join public.business_verification_profiles bv on bv.user_id = u.id
  where u.is_trial_active = true
    and u.free_trial_ends_at is not null
    and u.free_trial_ends_at >= now() + interval '2 days 12 hours'
    and u.free_trial_ends_at <  now() + interval '3 days 12 hours'
    and u.trial_email_d3_sent_at is null
    and au.email is not null
    and length(au.email::text) > 3
  union all
  select
    u.id,
    au.email::text as email,
    bp.store_name,
    bv.business_name,
    u.free_trial_ends_at,
    'd-1'::text as kind
  from public.users u
  join auth.users au on au.id = u.id
  left join public.business_profiles bp on bp.user_id = u.id
  left join public.business_verification_profiles bv on bv.user_id = u.id
  where u.is_trial_active = true
    and u.free_trial_ends_at is not null
    and u.free_trial_ends_at >= now() + interval '12 hours'
    and u.free_trial_ends_at <  now() + interval '1 day 12 hours'
    and u.trial_email_d1_sent_at is null
    and au.email is not null
    and length(au.email::text) > 3
  union all
  select
    u.id,
    au.email::text as email,
    bp.store_name,
    bv.business_name,
    u.free_trial_ends_at,
    'expired'::text as kind
  from public.users u
  join auth.users au on au.id = u.id
  left join public.business_profiles bp on bp.user_id = u.id
  left join public.business_verification_profiles bv on bv.user_id = u.id
  where u.is_trial_active = false
    and u.free_trial_ends_at is not null
    and u.free_trial_ends_at >= now() - interval '1 day'
    and u.free_trial_ends_at <  now()
    and u.trial_email_expired_sent_at is null
    and coalesce(u.subscription_type, 'free') in ('free', 'expired')
    and au.email is not null
    and length(au.email::text) > 3;
$$;

revoke all on function public.trial_reminder_candidates() from public, anon, authenticated;
grant execute on function public.trial_reminder_candidates() to service_role;

create or replace function public.mark_trial_email_sent(p_user_id uuid, p_kind text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_kind = 'd-3' then
    update public.users set trial_email_d3_sent_at = now() where id = p_user_id;
  elsif p_kind = 'd-1' then
    update public.users set trial_email_d1_sent_at = now() where id = p_user_id;
  elsif p_kind = 'expired' then
    update public.users set trial_email_expired_sent_at = now() where id = p_user_id;
  else
    raise exception 'unknown trial email kind: %', p_kind;
  end if;
end;
$$;

revoke all on function public.mark_trial_email_sent(uuid, text) from public, anon, authenticated;
grant execute on function public.mark_trial_email_sent(uuid, text) to service_role;
