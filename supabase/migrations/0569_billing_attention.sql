-- 0569 — 결제 확인 필요 목록 + 직원 계정 제외.
--
-- 왜: PayApp 정기결제 실패 통보(failurl → payapp_rebill_failures)가 한 번도 들어온 적이 없다
--   (2026-11-27 확인, 0건). 그래서 카드 한도초과 등으로 재결제가 실패한 회원이
--   "이용 중(active)" 상태로 이용 기간만 지난 채 남고, 운영자는 이를 알 수 없었다.
--   실패 통보에 기대지 않고 "이용 기간이 지났는데 아직 active" 인 구독을 직접 찾아 보여 준다.
--
-- 직원 계정(billing_staff_accounts)은 실제 청구 대상이 아니므로 목록과 알림에서 뺀다.
-- 알림은 하루 한 번, 새로 생긴 건만(구독+기간 단위로 한 번) 관리자 알림 종에 올린다.

-- ── 직원 계정 ──────────────────────────────────────────────────────
create table if not exists public.billing_staff_accounts (
  user_id uuid primary key references public.users(id) on delete cascade,
  note text check (note is null or char_length(note) <= 200),
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.billing_staff_accounts enable row level security;
revoke all on public.billing_staff_accounts from anon, authenticated;

-- ── 알림 중복 방지 기록 ─────────────────────────────────────────────
create table if not exists public.billing_attention_notified (
  subscription_id uuid not null references public.subscriptions(id) on delete cascade,
  period_end timestamptz not null,
  notified_at timestamptz not null default now(),
  primary key (subscription_id, period_end)
);
alter table public.billing_attention_notified enable row level security;
revoke all on public.billing_attention_notified from anon, authenticated;

-- ── 표시 이름: 실명(닉네임) ─────────────────────────────────────────
create or replace function public._billing_member_label(p_full_name text, p_nickname text)
returns text
language sql
immutable
as $function$
  select case
    when nullif(btrim(p_full_name), '') is not null and nullif(btrim(p_nickname), '') is not null
         and btrim(p_full_name) <> btrim(p_nickname)
      then btrim(p_full_name) || ' (' || btrim(p_nickname) || ')'
    else coalesce(nullif(btrim(p_full_name), ''), nullif(btrim(p_nickname), ''), '회원')
  end
$function$;

-- ── 대상 판정 (내부용) ──────────────────────────────────────────────
-- 하루 여유: 재결제 통보가 조금 늦게 오는 경우를 대상에서 뺀다.
create or replace function public._billing_attention_rows()
returns table (
  subscription_id uuid,
  user_id uuid,
  display_name text,
  plan_type text,
  price integer,
  current_period_end timestamptz,
  days_overdue integer,
  last_paid_at timestamptz,
  last_payapp_event_at timestamptz,
  is_staff boolean
)
language sql
stable
security definer
set search_path = public
as $function$
  select
    s.id,
    s.user_id,
    public._billing_member_label(u.full_name, u.nickname),
    s.plan_type,
    s.price,
    s.current_period_end,
    greatest(0, floor(extract(epoch from (now() - s.current_period_end)) / 86400))::integer,
    s.last_paid_at,
    (select max(e.created_at) from public.payapp_webhook_events e
      where s.payapp_rebill_no is not null and e.payapp_rebill_no = s.payapp_rebill_no),
    exists (select 1 from public.billing_staff_accounts b where b.user_id = s.user_id)
  from public.subscriptions s
  join public.users u on u.id = s.user_id
  where s.status = 'active'
    and s.enterprise_subscription_id is null
    and s.current_period_end is not null
    and s.current_period_end < now() - interval '1 day'
    and u.withdrawn_at is null
$function$;
revoke all on function public._billing_attention_rows() from public, anon, authenticated;

-- ── 관리자: 목록 ───────────────────────────────────────────────────
create or replace function public.admin_list_billing_attention(p_include_staff boolean default false)
returns table (
  subscription_id uuid,
  user_id uuid,
  display_name text,
  plan_type text,
  price integer,
  current_period_end timestamptz,
  days_overdue integer,
  last_paid_at timestamptz,
  last_payapp_event_at timestamptz,
  is_staff boolean
)
language plpgsql
stable
security definer
set search_path = public
as $function$
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  return query
    select r.* from public._billing_attention_rows() r
     where p_include_staff or not r.is_staff
     order by r.current_period_end desc;
end;
$function$;
revoke execute on function public.admin_list_billing_attention(boolean) from public, anon;
grant execute on function public.admin_list_billing_attention(boolean) to authenticated;

-- ── 관리자: 직원 표시 / 해제 / 목록 ─────────────────────────────────
create or replace function public.admin_set_billing_staff(p_user_id uuid, p_is_staff boolean, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $function$
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  if p_user_id is null or not exists (select 1 from public.users where id = p_user_id) then
    raise exception 'target_not_found';
  end if;
  if p_is_staff then
    insert into public.billing_staff_accounts (user_id, note, created_by)
    values (p_user_id, nullif(btrim(coalesce(p_note, '')), ''), auth.uid())
    on conflict (user_id) do update set note = coalesce(excluded.note, billing_staff_accounts.note);
  else
    delete from public.billing_staff_accounts where user_id = p_user_id;
  end if;
end;
$function$;
revoke execute on function public.admin_set_billing_staff(uuid, boolean, text) from public, anon;
grant execute on function public.admin_set_billing_staff(uuid, boolean, text) to authenticated;

create or replace function public.admin_list_billing_staff()
returns table (user_id uuid, display_name text, note text, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $function$
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  return query
    select b.user_id, public._billing_member_label(u.full_name, u.nickname), b.note, b.created_at
      from public.billing_staff_accounts b
      join public.users u on u.id = b.user_id
     order by b.created_at;
end;
$function$;
revoke execute on function public.admin_list_billing_staff() from public, anon;
grant execute on function public.admin_list_billing_staff() to authenticated;

-- ── 매일 알림 ──────────────────────────────────────────────────────
-- 새로 생긴 대상(구독+기간)만 모아 알림 한 건. 같은 건은 다시 알리지 않는다.
create or replace function public.cron_check_billing_attention()
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_new integer;
  v_names text;
begin
  with fresh as (
    select r.subscription_id, r.current_period_end, r.display_name
      from public._billing_attention_rows() r
     where not r.is_staff
       and not exists (
         select 1 from public.billing_attention_notified n
          where n.subscription_id = r.subscription_id and n.period_end = r.current_period_end)
  ), ins as (
    insert into public.billing_attention_notified (subscription_id, period_end)
    select subscription_id, current_period_end from fresh
    on conflict do nothing
    returning subscription_id
  )
  select count(*), string_agg(f.display_name, ', ' order by f.current_period_end desc)
    into v_new, v_names
    from fresh f join ins i on i.subscription_id = f.subscription_id;

  if coalesce(v_new, 0) > 0 then
    insert into public.admin_notifications (kind, severity, title, body, context)
    values (
      'billing_attention', 'warning',
      '결제 확인 필요 ' || v_new || '명',
      left(v_names, 500) || ' — 이용 기간이 지났는데 재결제 기록이 없습니다. PayApp에서 결제 여부를 확인해 주세요.',
      jsonb_build_object('count', v_new)
    );
  end if;

  return jsonb_build_object('new', coalesce(v_new, 0));
end;
$function$;
revoke all on function public.cron_check_billing_attention() from public, anon, authenticated;

-- 매일 10:37 KST (01:37 UTC).
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'srr-billing-attention';
    perform cron.schedule('srr-billing-attention', '37 1 * * *', 'select public.cron_check_billing_attention();');
  end if;
end;
$$;
