-- ============================================
-- 0061_payout_reveal_audit.sql
--
-- 정산 계좌 원본 노출을 audit log 와 함께 분리:
--   - list_pending_payout_accounts: account_number 를 마스킹된 값만 반환
--   - admin_reveal_payout_account: 원본 + audit log INSERT (단일 트랜잭션)
--   - payout_account_reveal_logs: append-only audit
--
-- 정책:
--   - admin 만 reveal 가능
--   - verification_status='verified' 인 계좌만 reveal 가능 (pending/rejected 는 평문 노출 X)
--   - 모든 reveal 호출은 audit log INSERT (transaction 내 atomic)
--   - audit log 는 UPDATE/DELETE 차단 (append-only)
-- ============================================

-- ----------------------
-- 1) payout_account_reveal_logs — 원본 조회 audit (append-only)
-- ----------------------
create table if not exists public.payout_account_reveal_logs (
  id uuid primary key default gen_random_uuid(),
  payout_account_id uuid not null references public.artist_payout_accounts(id) on delete restrict,
  artist_user_id uuid not null references public.users(id) on delete restrict,
  viewed_by uuid not null references public.users(id) on delete restrict,
  settlement_id uuid references public.artist_settlements(id) on delete set null,
  reason text,
  viewer_ip inet,
  viewer_user_agent text,
  viewed_at timestamptz not null default now()
);

create index if not exists idx_reveal_logs_account
  on public.payout_account_reveal_logs(payout_account_id, viewed_at desc);
create index if not exists idx_reveal_logs_viewer
  on public.payout_account_reveal_logs(viewed_by, viewed_at desc);
create index if not exists idx_reveal_logs_artist
  on public.payout_account_reveal_logs(artist_user_id, viewed_at desc);

-- append-only
create or replace function public._payout_reveal_logs_protect()
returns trigger language plpgsql as $$
begin
  if TG_OP in ('UPDATE','DELETE') then
    raise exception 'payout_account_reveal_logs is append-only' using errcode = '42501';
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_reveal_logs_protect on public.payout_account_reveal_logs;
create trigger trg_reveal_logs_protect
  before update or delete on public.payout_account_reveal_logs
  for each row execute function public._payout_reveal_logs_protect();

-- RLS: admin only
alter table public.payout_account_reveal_logs enable row level security;

drop policy if exists "reveal_logs_admin_all" on public.payout_account_reveal_logs;
create policy "reveal_logs_admin_all" on public.payout_account_reveal_logs
  for all using (
    exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin')
  ) with check (
    exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin')
  );

-- ----------------------
-- 2) list_pending_payout_accounts 갱신 — account_number 마스킹된 값만 반환
-- ----------------------
-- 0025 의 원본 시그니처 보존, account_number 컬럼 자체는 마스킹된 값으로 채움
drop function if exists public.list_pending_payout_accounts(int);

create or replace function public.list_pending_payout_accounts(p_limit int default 100)
returns table(
  account_id uuid,
  user_id uuid,
  artist_name text,
  email text,
  bank_name text,
  masked_account_number text,
  account_holder text,
  verification_status text,
  rejected_reason text,
  created_at timestamptz
)
language plpgsql security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin') then
    raise exception 'admin only';
  end if;

  return query
  select
    pa.id, pa.user_id,
    ap.artist_name,
    au.email::text,
    pa.bank_name,
    public._mask_account_number(pa.account_number),    -- 항상 마스킹
    pa.account_holder,
    pa.verification_status,
    pa.rejected_reason,
    pa.created_at
  from public.artist_payout_accounts pa
  left join public.artist_profiles ap on ap.user_id = pa.user_id
  left join auth.users au on au.id = pa.user_id
  order by
    case pa.verification_status when 'pending' then 0 when 'rejected' then 1 else 2 end,
    pa.created_at desc
  limit greatest(1, p_limit);
end;
$$;

grant execute on function public.list_pending_payout_accounts(int) to authenticated;

-- ----------------------
-- 3) admin_reveal_payout_account — 원본 + audit log
-- ----------------------
create or replace function public.admin_reveal_payout_account(
  p_account_id uuid,
  p_reason text default null,
  p_settlement_id uuid default null,
  p_user_agent text default null
)
returns table(
  account_id uuid,
  account_number text,            -- 원본
  bank_name text,
  account_holder text,
  artist_user_id uuid,
  log_id uuid,
  viewed_at timestamptz
)
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_account record;
  v_log_id uuid;
  v_viewed_at timestamptz := now();
  v_ip inet;
begin
  if not exists (select 1 from public.users u where u.id = v_uid and u.role = 'admin') then
    raise exception 'admin only';
  end if;

  select pa.id, pa.user_id, pa.account_number, pa.bank_name, pa.account_holder, pa.verification_status
    into v_account
  from public.artist_payout_accounts pa
  where pa.id = p_account_id;

  if v_account.id is null then
    raise exception 'payout account not found';
  end if;
  if v_account.verification_status <> 'verified' then
    raise exception 'cannot reveal unverified account (status=%)', v_account.verification_status;
  end if;

  -- settlement_id 가 제공된 경우, 해당 정산이 이 아티스트 것인지 검증 (잘못된 매핑 방지)
  if p_settlement_id is not null then
    if not exists (
      select 1 from public.artist_settlements s
      where s.id = p_settlement_id and s.artist_user_id = v_account.user_id
    ) then
      raise exception 'settlement does not belong to this artist';
    end if;
  end if;

  -- viewer_ip 캡처 시도 (Supabase pooler 환경에서는 NULL 일 수 있음)
  begin
    v_ip := inet_client_addr();
  exception when others then
    v_ip := null;
  end;

  insert into public.payout_account_reveal_logs (
    payout_account_id, artist_user_id, viewed_by, settlement_id,
    reason, viewer_ip, viewer_user_agent, viewed_at
  ) values (
    p_account_id, v_account.user_id, v_uid, p_settlement_id,
    nullif(btrim(coalesce(p_reason, '')), ''),
    v_ip,
    nullif(btrim(coalesce(p_user_agent, '')), ''),
    v_viewed_at
  ) returning id into v_log_id;

  return query
  select v_account.id, v_account.account_number, v_account.bank_name,
    v_account.account_holder, v_account.user_id, v_log_id, v_viewed_at;
end;
$$;

grant execute on function public.admin_reveal_payout_account(uuid, text, uuid, text) to authenticated;

-- ----------------------
-- 4) admin_list_payout_reveal_logs — 조회 이력 조회 (감사용)
-- ----------------------
create or replace function public.admin_list_payout_reveal_logs(
  p_account_id uuid default null,
  p_viewer_id uuid default null,
  p_limit int default 100
)
returns table(
  id uuid,
  payout_account_id uuid,
  artist_user_id uuid,
  artist_nickname text,
  viewed_by uuid,
  viewer_nickname text,
  viewer_email text,
  settlement_id uuid,
  reason text,
  viewer_ip inet,
  viewed_at timestamptz
)
language plpgsql security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin') then
    raise exception 'admin only';
  end if;

  return query
  select
    l.id, l.payout_account_id, l.artist_user_id,
    coalesce(au_artist.email::text, artist_u.nickname, '')::text as artist_nickname,
    l.viewed_by,
    coalesce(viewer_u.nickname, '')::text as viewer_nickname,
    coalesce(au_viewer.email::text, '')::text as viewer_email,
    l.settlement_id, l.reason, l.viewer_ip, l.viewed_at
  from public.payout_account_reveal_logs l
  left join public.users artist_u on artist_u.id = l.artist_user_id
  left join auth.users au_artist on au_artist.id = l.artist_user_id
  left join public.users viewer_u on viewer_u.id = l.viewed_by
  left join auth.users au_viewer on au_viewer.id = l.viewed_by
  where (p_account_id is null or l.payout_account_id = p_account_id)
    and (p_viewer_id is null or l.viewed_by = p_viewer_id)
  order by l.viewed_at desc
  limit greatest(1, p_limit);
end;
$$;

grant execute on function public.admin_list_payout_reveal_logs(uuid, uuid, int) to authenticated;
