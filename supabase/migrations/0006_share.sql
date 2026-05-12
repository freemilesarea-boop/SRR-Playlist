-- ============================================
-- 0006_share.sql
-- 공유 이벤트 로그
-- ============================================

create table if not exists public.share_events (
  id bigserial primary key,
  user_id uuid references public.users(id) on delete set null,
  session_id text,
  target_type text not null check (target_type in ('playlist','track','business_qr')),
  target_id uuid,
  method text not null check (method in ('web_share','clipboard','qr_download','qr_view')),
  created_at timestamptz not null default now()
);

create index if not exists idx_share_events_created_at on public.share_events(created_at desc);
create index if not exists idx_share_events_target on public.share_events(target_type, target_id);

alter table public.share_events enable row level security;

drop policy if exists "share_events_insert_any" on public.share_events;
create policy "share_events_insert_any" on public.share_events
  for insert with check (user_id is null or auth.uid() = user_id);

drop policy if exists "share_events_admin_select" on public.share_events;
create policy "share_events_admin_select" on public.share_events
  for select using (
    exists (select 1 from public.users where id = auth.uid() and role = 'admin')
  );
