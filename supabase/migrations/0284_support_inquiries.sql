-- 0284 — 문의하기 (Support Inquiry) + 관리자 알림 (X6.1)
--
-- 사업자/아티스트/일반회원 문의 채널 + 관리자 알림.
-- 기존 admin_notifications 시스템 (Resend) 재사용.

-- ===== A. support_inquiries =====
create table if not exists public.support_inquiries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete set null,
  user_email text,
  user_role text,
  business_id uuid references public.business_profiles(id) on delete set null,
  artist_id uuid references public.artist_profiles(id) on delete set null,
  inquiry_type text not null check (inquiry_type in (
    '재생 오류','플레이리스트 문의','결제/구독 문의','정산 문의',
    '음원 등록 문의','계정/로그인 문의','기타'
  )),
  title text not null check (length(btrim(title)) > 0),
  body text not null check (length(btrim(body)) > 0),
  contact_email text,
  contact_phone text,
  wants_kakao_contact boolean not null default false,
  status text not null default 'open' check (status in ('open','in_progress','resolved','closed')),
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  current_page_url text,
  browser_user_agent text,
  context jsonb not null default '{}'::jsonb,
  admin_note text,
  assigned_admin_id uuid references public.users(id) on delete set null,
  -- 2차 카카오 연동 준비 컬럼
  kakao_channel_status text,
  kakao_notification_sent_at timestamptz,
  kakao_notification_error text,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_support_inquiries_status_created
  on public.support_inquiries(status, created_at desc);
create index if not exists idx_support_inquiries_user
  on public.support_inquiries(user_id, created_at desc)
  where user_id is not null;
create index if not exists idx_support_inquiries_priority_status
  on public.support_inquiries(priority, status, created_at desc);
create index if not exists idx_support_inquiries_assigned
  on public.support_inquiries(assigned_admin_id, status)
  where assigned_admin_id is not null;

-- updated_at 자동 갱신
create or replace function public._support_inquiries_touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end; $$;

drop trigger if exists trg_support_inquiries_touch on public.support_inquiries;
create trigger trg_support_inquiries_touch
  before update on public.support_inquiries
  for each row execute function public._support_inquiries_touch_updated_at();

-- resolved_at 자동 set
create or replace function public._support_inquiries_set_resolved_at()
returns trigger language plpgsql as $$
begin
  if new.status in ('resolved','closed') and old.status not in ('resolved','closed') then
    new.resolved_at := coalesce(new.resolved_at, now());
  end if;
  return new;
end; $$;

drop trigger if exists trg_support_inquiries_resolved on public.support_inquiries;
create trigger trg_support_inquiries_resolved
  before update on public.support_inquiries
  for each row execute function public._support_inquiries_set_resolved_at();

-- ===== B. support_inquiry_attachments =====
create table if not exists public.support_inquiry_attachments (
  id uuid primary key default gen_random_uuid(),
  inquiry_id uuid not null references public.support_inquiries(id) on delete cascade,
  file_url text not null,
  file_name text,
  file_type text,
  file_size bigint,
  created_at timestamptz not null default now()
);

create index if not exists idx_support_attachments_inquiry
  on public.support_inquiry_attachments(inquiry_id);

-- ===== C. RLS =====
alter table public.support_inquiries enable row level security;
alter table public.support_inquiry_attachments enable row level security;

drop policy if exists "si select self or admin" on public.support_inquiries;
create policy "si select self or admin" on public.support_inquiries
  for select to authenticated
  using (
    user_id = auth.uid()
    or exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin')
  );

drop policy if exists "si admin update" on public.support_inquiries;
create policy "si admin update" on public.support_inquiries
  for update to authenticated
  using (exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin'))
  with check (exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin'));

-- INSERT 는 RPC (create_support_inquiry) 로만 — 직접 INSERT 차단 (security definer)

drop policy if exists "sia select self or admin" on public.support_inquiry_attachments;
create policy "sia select self or admin" on public.support_inquiry_attachments
  for select to authenticated
  using (
    exists (
      select 1 from public.support_inquiries si
      where si.id = inquiry_id
        and (si.user_id = auth.uid()
             or exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin'))
    )
  );

-- attachments INSERT 도 RPC 로만.

-- ===== D. 우선순위 자동 설정 (재생 오류 or 매장 컨텍스트 → urgent) =====
create or replace function public._support_inquiries_auto_priority()
returns trigger language plpgsql as $$
begin
  if new.priority = 'normal' then
    if new.inquiry_type = '재생 오류' then
      new.priority := 'urgent';
    elsif (new.context ? 'current_playlist_id'
           or new.context ? 'current_schedule_slot'
           or new.context ? 'queue_length'
           or new.context ? 'last_playback_error') then
      new.priority := 'urgent';
    end if;
  end if;
  return new;
end; $$;

drop trigger if exists trg_support_inquiries_auto_priority on public.support_inquiries;
create trigger trg_support_inquiries_auto_priority
  before insert on public.support_inquiries
  for each row execute function public._support_inquiries_auto_priority();
