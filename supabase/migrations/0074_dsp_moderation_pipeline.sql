-- 0074 — DSP 형 음원 검수 파이프라인 (release_status 재사용 + 'removed' 추가)
--
-- 정책 (사용자 결정):
-- - 기존 release_status 재사용. UI 레이블만 사용자 명칭 (pending_review/reviewing/needs_revision)
-- - 'removed' 신규 추가 (takedown 용)
--
-- 추가:
-- 1) tracks: 'removed' enum + removed_at/by/reason
-- 2) track_moderation_events 테이블 + auto-trigger
-- 3) admin_takedown_track / admin_restore_track / hide / unhide RPC
-- 4) admin_approve_artist_release 게이트 강화 (승인 시점 contract/payout/approval 재검증)
-- 5) release_status → visibility_status sync trigger 보강 ('removed' → 'hidden')
-- 6) track_moderation_email_jobs + auto-enqueue trigger
-- 7) Edge Function 헬퍼 RPC + 관리자 조회 RPC

alter table public.tracks drop constraint if exists tracks_release_status_check;
alter table public.tracks add constraint tracks_release_status_check
  check (release_status = any (array[
    'draft'::text,'submitted'::text,'changes_requested'::text,
    'approved'::text,'scheduled'::text,'released'::text,
    'rejected'::text,'removed'::text
  ]));

alter table public.tracks
  add column if not exists removed_at timestamptz,
  add column if not exists removed_by uuid references public.users(id) on delete set null,
  add column if not exists removed_reason text;

create table if not exists public.track_moderation_events (
  id bigserial primary key,
  track_id uuid not null references public.tracks(id) on delete cascade,
  actor_user_id uuid references public.users(id) on delete set null,
  action text not null check (action in (
    'upload_created','submitted','review_started',
    'approved','rejected','revision_requested',
    'hidden','unhidden','removed','restored',
    'released_now','scheduled'
  )),
  from_release_status text,
  to_release_status text,
  from_visibility_status text,
  to_visibility_status text,
  note text,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_track_mod_events_track on public.track_moderation_events(track_id);
create index if not exists idx_track_mod_events_created on public.track_moderation_events(created_at desc);
create index if not exists idx_track_mod_events_action on public.track_moderation_events(action);

alter table public.track_moderation_events enable row level security;

drop policy if exists track_mod_events_admin_read on public.track_moderation_events;
create policy track_mod_events_admin_read on public.track_moderation_events
  for select to authenticated
  using (exists (select 1 from public.users u where u.id = auth.uid() and u.role='admin'));

drop policy if exists track_mod_events_artist_read on public.track_moderation_events;
create policy track_mod_events_artist_read on public.track_moderation_events
  for select to authenticated
  using (exists (select 1 from public.tracks t where t.id = track_id and t.owner_user_id = auth.uid()));

drop policy if exists track_mod_events_block_mutate on public.track_moderation_events;
create policy track_mod_events_block_mutate on public.track_moderation_events
  for all to authenticated using (false) with check (false);

revoke insert, update, delete on public.track_moderation_events from public, authenticated, anon;
grant insert on public.track_moderation_events to service_role;
grant usage, select on sequence public.track_moderation_events_id_seq to service_role;

create or replace function public._log_track_moderation_event()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare v_action text; v_actor uuid := auth.uid();
begin
  if TG_OP = 'INSERT' then
    insert into public.track_moderation_events
      (track_id, actor_user_id, action, from_release_status, to_release_status, from_visibility_status, to_visibility_status, note)
    values
      (NEW.id, v_actor, 'upload_created', null, NEW.release_status, null, NEW.visibility_status,
       coalesce(NEW.admin_review_note, NEW.changes_requested_reason, null));
    return NEW;
  end if;
  if TG_OP = 'UPDATE' then
    if OLD.release_status is distinct from NEW.release_status then
      v_action := case NEW.release_status
        when 'submitted' then 'submitted'
        when 'changes_requested' then 'revision_requested'
        when 'approved' then 'approved'
        when 'scheduled' then 'scheduled'
        when 'released' then 'released_now'
        when 'rejected' then 'rejected'
        when 'removed' then 'removed'
        else NEW.release_status
      end;
      if OLD.release_status in ('removed','rejected') and NEW.release_status in ('draft','submitted','approved','scheduled','released') then
        v_action := 'restored';
      end if;
      insert into public.track_moderation_events
        (track_id, actor_user_id, action, from_release_status, to_release_status, from_visibility_status, to_visibility_status, note)
      values
        (NEW.id, v_actor, v_action, OLD.release_status, NEW.release_status, OLD.visibility_status, NEW.visibility_status,
         coalesce(NEW.changes_requested_reason, NEW.admin_review_note, NEW.rejected_reason, NEW.removed_reason));
    elsif OLD.visibility_status is distinct from NEW.visibility_status then
      v_action := case NEW.visibility_status when 'hidden' then 'hidden' when 'approved' then 'unhidden' else NEW.visibility_status end;
      insert into public.track_moderation_events
        (track_id, actor_user_id, action, from_release_status, to_release_status, from_visibility_status, to_visibility_status, note)
      values
        (NEW.id, v_actor, v_action, OLD.release_status, NEW.release_status, OLD.visibility_status, NEW.visibility_status,
         coalesce(NEW.admin_review_note, NEW.rejected_reason));
    elsif OLD.review_started_at is null and NEW.review_started_at is not null then
      insert into public.track_moderation_events
        (track_id, actor_user_id, action, from_release_status, to_release_status, from_visibility_status, to_visibility_status, note)
      values
        (NEW.id, v_actor, 'review_started', OLD.release_status, NEW.release_status, OLD.visibility_status, NEW.visibility_status, null);
    end if;
  end if;
  return NEW;
end; $function$;

drop trigger if exists trg_log_track_moderation_event on public.tracks;
create trigger trg_log_track_moderation_event
  after insert or update on public.tracks
  for each row execute function public._log_track_moderation_event();

create or replace function public._sync_track_release_visibility()
returns trigger language plpgsql set search_path to 'public' as $function$
begin
  if NEW.release_status is distinct from coalesce(OLD.release_status, '') then
    NEW.visibility_status := case NEW.release_status
      when 'draft' then 'pending_review' when 'submitted' then 'pending_review'
      when 'changes_requested' then 'pending_review' when 'approved' then 'pending_review'
      when 'scheduled' then 'pending_review' when 'released' then 'approved'
      when 'rejected' then 'rejected' when 'removed' then 'hidden'
      else NEW.visibility_status end;
  end if;
  return NEW;
end; $function$;

drop trigger if exists trg_tracks_release_visibility_sync on public.tracks;
create trigger trg_tracks_release_visibility_sync
  before update of release_status on public.tracks
  for each row execute function public._sync_track_release_visibility();

create or replace function public.admin_approve_artist_release(p_track_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v_uid uuid := auth.uid(); v_track record; v_new_status text;
        v_artist record; v_contract_signed boolean; v_payout_verified boolean;
begin
  if not exists (select 1 from public.users u where u.id = v_uid and u.role='admin') then raise exception 'admin only'; end if;
  select t.id, t.release_status, t.release_date, t.source_type, t.owner_user_id into v_track from public.tracks t where t.id = p_track_id;
  if v_track.id is null then raise exception 'track not found'; end if;
  if v_track.source_type <> 'artist_upload' then raise exception 'not an artist upload'; end if;
  if v_track.release_status not in ('submitted','changes_requested') then raise exception 'cannot approve in release_status=%', v_track.release_status; end if;
  if v_track.release_date is null then raise exception 'release_date missing'; end if;
  if v_track.release_date < current_date then raise exception 'release_date % already passed', v_track.release_date; end if;
  select u.artist_approval_status, u.contract_status, u.membership_tier into v_artist from public.users u where u.id = v_track.owner_user_id;
  if coalesce(v_artist.artist_approval_status,'pending') <> 'approved' then raise exception 'artist not approved at approval time (status=%)', v_artist.artist_approval_status; end if;
  select exists (select 1 from public.artist_contracts c where c.artist_user_id = v_track.owner_user_id and c.status='signed') into v_contract_signed;
  if not v_contract_signed then raise exception 'no signed contract at approval time'; end if;
  select exists (select 1 from public.artist_payout_accounts pa where pa.user_id = v_track.owner_user_id and pa.verification_status='verified') into v_payout_verified;
  if not v_payout_verified then raise exception 'payout account not verified at approval time'; end if;
  v_new_status := case when v_track.release_date <= current_date then 'released' else 'scheduled' end;
  update public.tracks set
    release_status = v_new_status,
    audio_review_status = 'approved', cover_review_status = 'approved', metadata_review_status = 'approved',
    approved_at = now(),
    scheduled_at = case when v_new_status='scheduled' then now() else null end,
    released_at = case when v_new_status='released' then now() else null end,
    reviewed_at = now(), reviewed_by = v_uid,
    admin_review_note = null, rejected_reason = null
  where id = p_track_id;
  return jsonb_build_object('ok', true, 'track_id', p_track_id, 'status', v_new_status);
end; $function$;

grant execute on function public.admin_approve_artist_release(uuid) to authenticated;

create or replace function public.admin_takedown_track(p_track_id uuid, p_reason text)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare v_uid uuid := auth.uid();
begin
  if not exists (select 1 from public.users u where u.id = v_uid and u.role='admin') then raise exception 'admin only'; end if;
  if length(btrim(coalesce(p_reason,''))) < 5 then raise exception 'removed_reason required (min 5 chars)'; end if;
  update public.tracks set
    release_status = 'removed', removed_at = now(), removed_by = v_uid,
    removed_reason = btrim(p_reason), admin_review_note = btrim(p_reason)
  where id = p_track_id;
end; $function$;
grant execute on function public.admin_takedown_track(uuid, text) to authenticated;

create or replace function public.admin_restore_track(p_track_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare v_uid uuid := auth.uid();
begin
  if not exists (select 1 from public.users u where u.id = v_uid and u.role='admin') then raise exception 'admin only'; end if;
  update public.tracks set
    release_status = 'draft', removed_at = null, removed_by = null, removed_reason = null,
    rejected_reason = null, admin_review_note = null,
    audio_review_status='pending', cover_review_status='pending', metadata_review_status='pending'
  where id = p_track_id and release_status in ('removed','rejected');
end; $function$;
grant execute on function public.admin_restore_track(uuid) to authenticated;

create or replace function public.admin_hide_released_track(p_track_id uuid, p_reason text default null)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare v_uid uuid := auth.uid();
begin
  if not exists (select 1 from public.users u where u.id = v_uid and u.role='admin') then raise exception 'admin only'; end if;
  update public.tracks set visibility_status='hidden',
    admin_review_note = coalesce(nullif(btrim(p_reason),''), admin_review_note)
  where id = p_track_id and release_status='released';
end; $function$;
grant execute on function public.admin_hide_released_track(uuid, text) to authenticated;

create or replace function public.admin_unhide_released_track(p_track_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare v_uid uuid := auth.uid();
begin
  if not exists (select 1 from public.users u where u.id = v_uid and u.role='admin') then raise exception 'admin only'; end if;
  update public.tracks set visibility_status='approved'
  where id = p_track_id and release_status='released' and visibility_status='hidden';
end; $function$;
grant execute on function public.admin_unhide_released_track(uuid) to authenticated;

create table if not exists public.track_moderation_email_jobs (
  id uuid primary key default gen_random_uuid(),
  track_id uuid not null references public.tracks(id) on delete cascade,
  recipient_email text not null,
  recipient_user_id uuid references public.users(id) on delete set null,
  kind text not null check (kind in ('approved','rejected','revision_requested','removed','released')),
  subject text not null,
  status text not null default 'pending' check (status in ('pending','sending','sent','failed','cancelled')),
  attempts int not null default 0,
  last_attempt_at timestamptz, last_error text, sent_at timestamptz,
  provider_message_id text,
  created_at timestamptz not null default now()
);

create index if not exists idx_track_mod_email_jobs_status on public.track_moderation_email_jobs (status, created_at);
create index if not exists idx_track_mod_email_jobs_track on public.track_moderation_email_jobs (track_id);

alter table public.track_moderation_email_jobs enable row level security;
drop policy if exists track_mod_email_jobs_admin_all on public.track_moderation_email_jobs;
create policy track_mod_email_jobs_admin_all on public.track_moderation_email_jobs
  for all to authenticated
  using (exists (select 1 from public.users u where u.id = auth.uid() and u.role='admin'))
  with check (exists (select 1 from public.users u where u.id = auth.uid() and u.role='admin'));
drop policy if exists track_mod_email_jobs_self_read on public.track_moderation_email_jobs;
create policy track_mod_email_jobs_self_read on public.track_moderation_email_jobs
  for select to authenticated using (recipient_user_id = auth.uid());

create or replace function public._enqueue_track_moderation_email()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare v_owner_email text; v_kind text; v_subject text;
begin
  if TG_OP <> 'UPDATE' then return NEW; end if;
  if OLD.release_status is not distinct from NEW.release_status then return NEW; end if;
  if NEW.source_type <> 'artist_upload' then return NEW; end if;
  if NEW.release_status in ('approved','scheduled','released') and OLD.release_status in ('submitted','changes_requested') then v_kind := 'approved';
  elsif NEW.release_status = 'rejected' then v_kind := 'rejected';
  elsif NEW.release_status = 'changes_requested' then v_kind := 'revision_requested';
  elsif NEW.release_status = 'removed' then v_kind := 'removed';
  else return NEW; end if;
  select au.email::text into v_owner_email from auth.users au where au.id = NEW.owner_user_id;
  if v_owner_email is null then return NEW; end if;
  v_subject := case v_kind
    when 'approved' then '[스르륵 플리] 음원 검수가 승인되었습니다 - ' || coalesce(NEW.title,'')
    when 'rejected' then '[스르륵 플리] 음원 업로드가 반려되었습니다 - ' || coalesce(NEW.title,'')
    when 'revision_requested' then '[스르륵 플리] 음원 수정 요청이 도착했습니다 - ' || coalesce(NEW.title,'')
    when 'removed' then '[스르륵 플리] 음원이 제거되었습니다 - ' || coalesce(NEW.title,'')
    else '[스르륵 플리] 음원 상태 안내 - ' || coalesce(NEW.title,'')
  end;
  insert into public.track_moderation_email_jobs (track_id, recipient_email, recipient_user_id, kind, subject)
  values (NEW.id, v_owner_email, NEW.owner_user_id, v_kind, v_subject);
  return NEW;
end; $function$;

drop trigger if exists trg_enqueue_track_moderation_email on public.tracks;
create trigger trg_enqueue_track_moderation_email
  after update of release_status on public.tracks
  for each row execute function public._enqueue_track_moderation_email();

create or replace function public.get_pending_track_moderation_email_jobs(p_track_id uuid default null, p_limit int default 50)
returns table (job_id uuid, track_id uuid, recipient_email text, recipient_user_id uuid, kind text, subject text, attempts int,
  track_title text, track_artist text, track_code text, release_status text, release_date date,
  admin_review_note text, rejected_reason text, changes_requested_reason text, removed_reason text, artist_name text)
language plpgsql security definer set search_path to 'public' as $function$
begin
  if current_setting('request.jwt.claim.role', true) <> 'service_role' and auth.role() <> 'service_role' then raise exception 'service_role only'; end if;
  return query
  select j.id, j.track_id, j.recipient_email, j.recipient_user_id, j.kind, j.subject, j.attempts,
         t.title, t.artist, t.track_code, t.release_status, t.release_date,
         t.admin_review_note, t.rejected_reason, t.changes_requested_reason, t.removed_reason,
         coalesce(ap.artist_name, u.full_name, '')
  from public.track_moderation_email_jobs j
  join public.tracks t on t.id = j.track_id
  left join public.users u on u.id = t.owner_user_id
  left join public.artist_profiles ap on ap.user_id = t.owner_user_id
  where j.status = 'pending' and (p_track_id is null or j.track_id = p_track_id)
  order by j.created_at asc limit greatest(1, p_limit);
end; $function$;
revoke all on function public.get_pending_track_moderation_email_jobs(uuid, int) from public;
grant execute on function public.get_pending_track_moderation_email_jobs(uuid, int) to service_role;

create or replace function public.lock_track_moderation_email_job(p_job_id uuid)
returns boolean language plpgsql security definer set search_path to 'public' as $function$
declare v_updated int;
begin
  if current_setting('request.jwt.claim.role', true) <> 'service_role' and auth.role() <> 'service_role' then raise exception 'service_role only'; end if;
  update public.track_moderation_email_jobs set status='sending', last_attempt_at=now(), attempts=attempts+1
  where id = p_job_id and status in ('pending','failed');
  get diagnostics v_updated = row_count;
  return v_updated > 0;
end; $function$;
revoke all on function public.lock_track_moderation_email_job(uuid) from public;
grant execute on function public.lock_track_moderation_email_job(uuid) to service_role;

create or replace function public.mark_track_moderation_email_sent(p_job_id uuid, p_provider_message_id text default null)
returns void language plpgsql security definer set search_path to 'public' as $function$
begin
  if current_setting('request.jwt.claim.role', true) <> 'service_role' and auth.role() <> 'service_role' then raise exception 'service_role only'; end if;
  update public.track_moderation_email_jobs set status='sent', sent_at=now(), provider_message_id=p_provider_message_id, last_error=null
  where id = p_job_id;
end; $function$;
revoke all on function public.mark_track_moderation_email_sent(uuid, text) from public;
grant execute on function public.mark_track_moderation_email_sent(uuid, text) to service_role;

create or replace function public.mark_track_moderation_email_failed(p_job_id uuid, p_error text)
returns void language plpgsql security definer set search_path to 'public' as $function$
begin
  if current_setting('request.jwt.claim.role', true) <> 'service_role' and auth.role() <> 'service_role' then raise exception 'service_role only'; end if;
  update public.track_moderation_email_jobs set status='failed', last_error=left(coalesce(p_error,''), 2000)
  where id = p_job_id;
end; $function$;
revoke all on function public.mark_track_moderation_email_failed(uuid, text) from public;
grant execute on function public.mark_track_moderation_email_failed(uuid, text) to service_role;

create or replace function public.admin_list_track_moderation_events(p_track_id uuid)
returns table (event_id bigint, actor_user_id uuid, action text, from_release_status text, to_release_status text,
  from_visibility_status text, to_visibility_status text, note text, metadata jsonb, created_at timestamptz)
language plpgsql security definer set search_path to 'public' as $function$
begin
  if not exists (select 1 from public.users u where u.id = auth.uid() and u.role='admin') then raise exception 'admin only'; end if;
  return query
  select e.id, e.actor_user_id, e.action, e.from_release_status, e.to_release_status,
         e.from_visibility_status, e.to_visibility_status, e.note, e.metadata, e.created_at
  from public.track_moderation_events e
  where e.track_id = p_track_id
  order by e.created_at asc, e.id asc;
end; $function$;
grant execute on function public.admin_list_track_moderation_events(uuid) to authenticated;

create or replace function public.admin_list_track_moderation_email_jobs(p_track_id uuid)
returns table (job_id uuid, recipient_email text, kind text, status text, attempts int,
  sent_at timestamptz, last_attempt_at timestamptz, last_error text, provider_message_id text, created_at timestamptz)
language plpgsql security definer set search_path to 'public' as $function$
begin
  if not exists (select 1 from public.users u where u.id = auth.uid() and u.role='admin') then raise exception 'admin only'; end if;
  return query
  select j.id, j.recipient_email, j.kind, j.status, j.attempts,
         j.sent_at, j.last_attempt_at, j.last_error, j.provider_message_id, j.created_at
  from public.track_moderation_email_jobs j
  where j.track_id = p_track_id order by j.created_at asc;
end; $function$;
grant execute on function public.admin_list_track_moderation_email_jobs(uuid) to authenticated;

create or replace function public.admin_requeue_track_moderation_emails(p_track_id uuid, p_only_failed boolean default false)
returns int language plpgsql security definer set search_path to 'public' as $function$
declare v_count int;
begin
  if not exists (select 1 from public.users u where u.id = auth.uid() and u.role='admin') then raise exception 'admin only'; end if;
  update public.track_moderation_email_jobs set status='pending', sent_at=null
  where track_id = p_track_id and (not p_only_failed or status='failed');
  get diagnostics v_count = row_count;
  return v_count;
end; $function$;
grant execute on function public.admin_requeue_track_moderation_emails(uuid, boolean) to authenticated;

NOTIFY pgrst, 'reload schema';
