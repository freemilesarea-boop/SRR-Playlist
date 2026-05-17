-- 0076 — 자동 발매 시스템 (즉시 공개 / 예약 발매 분기 + scheduled worker)
--
-- 정책:
-- - 관리자 승인 시 기본 = 즉시 공개 (admin_settings.default_immediate_release=true)
-- - p_immediate_release=false 명시 시 예약 발매 (scheduled)
-- - release_date < today 면 무조건 즉시 공개 (override)
-- - scheduled → released 자동 전환: process_due_scheduled_releases RPC (외부 cron 또는
--   Edge Function 이 1시간 주기 호출). 실패는 release_failures 에 기록
--
-- 산출물:
-- - admin_settings 테이블 + admin_get_setting / admin_set_setting
-- - release_failures 테이블 + admin_list_release_failures RPC
-- - admin_approve_artist_release(p_track_id, p_immediate_release boolean default null) 확장
-- - process_due_scheduled_releases RPC (cron 대용)
-- - track_moderation_events.action 확장: approved_and_released / approved_and_scheduled /
--   auto_released
-- - track_moderation_email_jobs.kind 확장: 'scheduled'
-- - _log_track_moderation_event / _enqueue_track_moderation_email 트리거 보강

create table if not exists public.admin_settings (
  key text primary key,
  value jsonb not null,
  description text,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.users(id) on delete set null
);

alter table public.admin_settings enable row level security;
drop policy if exists admin_settings_admin_all on public.admin_settings;
create policy admin_settings_admin_all on public.admin_settings
  for all to authenticated
  using (exists (select 1 from public.users u where u.id = auth.uid() and u.role='admin'))
  with check (exists (select 1 from public.users u where u.id = auth.uid() and u.role='admin'));
drop policy if exists admin_settings_authed_read_safe on public.admin_settings;
create policy admin_settings_authed_read_safe on public.admin_settings
  for select to authenticated using (key in ('default_immediate_release'));

insert into public.admin_settings (key, value, description) values
  ('default_immediate_release', 'true'::jsonb,
   '관리자 검수 승인 시 기본 = 즉시 공개 (true) / 예약 발매 (false)')
on conflict (key) do nothing;

create or replace function public.admin_get_setting(p_key text)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v_val jsonb;
begin select value into v_val from public.admin_settings where key=p_key; return v_val; end;
$function$;
grant execute on function public.admin_get_setting(text) to authenticated;

create or replace function public.admin_set_setting(p_key text, p_value jsonb)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare v_uid uuid := auth.uid();
begin
  if not exists (select 1 from public.users u where u.id = v_uid and u.role='admin') then
    raise exception 'admin only';
  end if;
  insert into public.admin_settings (key, value, updated_at, updated_by)
  values (p_key, p_value, now(), v_uid)
  on conflict (key) do update set value=excluded.value, updated_at=now(), updated_by=v_uid;
end; $function$;
grant execute on function public.admin_set_setting(text, jsonb) to authenticated;

create table if not exists public.release_failures (
  id bigserial primary key,
  track_id uuid not null references public.tracks(id) on delete cascade,
  kind text not null check (kind in ('approve','schedule','auto_release','manual_release','requeue')),
  error_code text, error_message text, context jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_release_failures_track on public.release_failures(track_id);
create index if not exists idx_release_failures_created on public.release_failures(created_at desc);

alter table public.release_failures enable row level security;
drop policy if exists release_failures_admin_read on public.release_failures;
create policy release_failures_admin_read on public.release_failures
  for select to authenticated
  using (exists (select 1 from public.users u where u.id = auth.uid() and u.role='admin'));
drop policy if exists release_failures_block_mutate on public.release_failures;
create policy release_failures_block_mutate on public.release_failures
  for all to authenticated using (false) with check (false);
revoke insert, update, delete on public.release_failures from public, authenticated, anon;
grant insert on public.release_failures to service_role;
grant usage, select on sequence public.release_failures_id_seq to service_role;

alter table public.track_moderation_events drop constraint if exists track_moderation_events_action_check;
alter table public.track_moderation_events add constraint track_moderation_events_action_check
  check (action in (
    'upload_created','submitted','review_started',
    'approved','rejected','revision_requested',
    'hidden','unhidden','removed','restored',
    'released_now','scheduled',
    'approved_and_released','approved_and_scheduled','auto_released'
  ));

alter table public.track_moderation_email_jobs drop constraint if exists track_moderation_email_jobs_kind_check;
alter table public.track_moderation_email_jobs add constraint track_moderation_email_jobs_kind_check
  check (kind in ('approved','rejected','revision_requested','removed','released','scheduled'));

create or replace function public._log_track_moderation_event()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare v_action text; v_actor uuid := auth.uid();
begin
  if TG_OP = 'INSERT' then
    insert into public.track_moderation_events
      (track_id, actor_user_id, action, from_release_status, to_release_status, from_visibility_status, to_visibility_status, note)
    values (NEW.id, v_actor, 'upload_created', null, NEW.release_status, null, NEW.visibility_status,
            coalesce(NEW.admin_review_note, NEW.changes_requested_reason, null));
    return NEW;
  end if;
  if TG_OP = 'UPDATE' then
    if OLD.release_status is distinct from NEW.release_status then
      if OLD.release_status in ('submitted','changes_requested') and NEW.release_status = 'released' then
        v_action := 'approved_and_released';
      elsif OLD.release_status in ('submitted','changes_requested') and NEW.release_status = 'scheduled' then
        v_action := 'approved_and_scheduled';
      elsif OLD.release_status = 'scheduled' and NEW.release_status = 'released' then
        v_action := 'auto_released';
      elsif OLD.release_status in ('removed','rejected') and NEW.release_status in ('draft','submitted','approved','scheduled','released') then
        v_action := 'restored';
      else
        v_action := case NEW.release_status
          when 'submitted' then 'submitted' when 'changes_requested' then 'revision_requested'
          when 'approved' then 'approved' when 'scheduled' then 'scheduled'
          when 'released' then 'released_now' when 'rejected' then 'rejected'
          when 'removed' then 'removed' else null end;
      end if;
      if v_action is null then return NEW; end if;
      insert into public.track_moderation_events
        (track_id, actor_user_id, action, from_release_status, to_release_status, from_visibility_status, to_visibility_status, note)
      values (NEW.id, v_actor, v_action, OLD.release_status, NEW.release_status, OLD.visibility_status, NEW.visibility_status,
              coalesce(NEW.changes_requested_reason, NEW.admin_review_note, NEW.rejected_reason, NEW.removed_reason));
    elsif OLD.visibility_status is distinct from NEW.visibility_status then
      v_action := case NEW.visibility_status
        when 'hidden' then 'hidden' when 'approved' then 'unhidden'
        when 'pending_review' then 'review_started' when 'rejected' then 'rejected'
        else null end;
      if v_action is null then return NEW; end if;
      insert into public.track_moderation_events
        (track_id, actor_user_id, action, from_release_status, to_release_status, from_visibility_status, to_visibility_status, note)
      values (NEW.id, v_actor, v_action, OLD.release_status, NEW.release_status, OLD.visibility_status, NEW.visibility_status,
              coalesce(NEW.admin_review_note, NEW.rejected_reason));
    elsif OLD.review_started_at is null and NEW.review_started_at is not null then
      insert into public.track_moderation_events
        (track_id, actor_user_id, action, from_release_status, to_release_status, from_visibility_status, to_visibility_status, note)
      values (NEW.id, v_actor, 'review_started', OLD.release_status, NEW.release_status, OLD.visibility_status, NEW.visibility_status, null);
    end if;
  end if;
  return NEW;
end; $function$;

create or replace function public._enqueue_track_moderation_email()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare v_owner_email text; v_kind text; v_subject text;
begin
  if TG_OP <> 'UPDATE' then return NEW; end if;
  if OLD.release_status is not distinct from NEW.release_status then return NEW; end if;
  if NEW.source_type <> 'artist_upload' then return NEW; end if;
  if OLD.release_status in ('submitted','changes_requested') and NEW.release_status = 'released' then v_kind := 'released';
  elsif OLD.release_status in ('submitted','changes_requested') and NEW.release_status = 'scheduled' then v_kind := 'scheduled';
  elsif OLD.release_status in ('submitted','changes_requested') and NEW.release_status = 'approved' then v_kind := 'approved';
  elsif OLD.release_status = 'scheduled' and NEW.release_status = 'released' then v_kind := 'released';
  elsif NEW.release_status = 'rejected' then v_kind := 'rejected';
  elsif NEW.release_status = 'changes_requested' then v_kind := 'revision_requested';
  elsif NEW.release_status = 'removed' then v_kind := 'removed';
  else return NEW; end if;
  select au.email::text into v_owner_email from auth.users au where au.id = NEW.owner_user_id;
  if v_owner_email is null then return NEW; end if;
  v_subject := case v_kind
    when 'released' then '[스르륵 플리] 음원이 공개되었습니다 - ' || coalesce(NEW.title,'')
    when 'scheduled' then '[스르륵 플리] 음원 발매가 예약되었습니다 - ' || coalesce(NEW.title,'')
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

drop function if exists public.admin_approve_artist_release(uuid);
create or replace function public.admin_approve_artist_release(
  p_track_id uuid, p_immediate_release boolean default null
)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_uid uuid := auth.uid(); v_track record;
  v_artist record; v_contract_signed boolean; v_payout_verified boolean;
  v_immediate boolean; v_default jsonb; v_new_status text;
begin
  if not exists (select 1 from public.users u where u.id = v_uid and u.role='admin') then
    raise exception 'admin only';
  end if;
  select t.id, t.release_status, t.release_date, t.source_type, t.owner_user_id
    into v_track from public.tracks t where t.id = p_track_id;
  if v_track.id is null then raise exception 'track not found'; end if;
  if v_track.source_type <> 'artist_upload' then raise exception 'not an artist upload'; end if;
  if v_track.release_status not in ('submitted','changes_requested') then
    raise exception 'cannot approve in release_status=%', v_track.release_status;
  end if;
  if v_track.release_date is null then raise exception 'release_date missing'; end if;

  select u.artist_approval_status, u.contract_status, u.membership_tier
    into v_artist from public.users u where u.id = v_track.owner_user_id;
  if coalesce(v_artist.artist_approval_status,'pending') <> 'approved' then
    raise exception 'artist not approved at approval time (status=%)', v_artist.artist_approval_status;
  end if;
  select exists (select 1 from public.artist_contracts c
    where c.artist_user_id = v_track.owner_user_id and c.status='signed') into v_contract_signed;
  if not v_contract_signed then raise exception 'no signed contract at approval time'; end if;
  select exists (select 1 from public.artist_payout_accounts pa
    where pa.user_id = v_track.owner_user_id and pa.verification_status='verified') into v_payout_verified;
  if not v_payout_verified then raise exception 'payout account not verified at approval time'; end if;

  if p_immediate_release is not null then v_immediate := p_immediate_release;
  else
    select value into v_default from public.admin_settings where key='default_immediate_release';
    v_immediate := coalesce((v_default)::text::boolean, true);
  end if;
  if v_track.release_date <= current_date then v_immediate := true; end if;
  v_new_status := case when v_immediate then 'released' else 'scheduled' end;

  update public.tracks set
    release_status = v_new_status,
    audio_review_status = 'approved', cover_review_status = 'approved', metadata_review_status = 'approved',
    approved_at = now(),
    scheduled_at = case when v_new_status='scheduled' then now() else null end,
    released_at = case when v_new_status='released' then now() else null end,
    reviewed_at = now(), reviewed_by = v_uid,
    admin_review_note = null, rejected_reason = null
  where id = p_track_id;

  return jsonb_build_object(
    'ok', true, 'track_id', p_track_id, 'status', v_new_status,
    'immediate_release', v_immediate, 'release_date', v_track.release_date
  );
exception when others then
  insert into public.release_failures (track_id, kind, error_code, error_message, context)
  values (p_track_id, 'approve', SQLSTATE, SQLERRM,
          jsonb_build_object('immediate_request', p_immediate_release, 'actor', v_uid));
  raise;
end; $function$;
grant execute on function public.admin_approve_artist_release(uuid, boolean) to authenticated;

create or replace function public.process_due_scheduled_releases()
returns table(track_id uuid, track_code text, status text, error text)
language plpgsql security definer set search_path to 'public' as $function$
declare r record;
begin
  if current_setting('request.jwt.claim.role', true) <> 'service_role'
     and auth.role() <> 'service_role'
     and not exists (select 1 from public.users u where u.id = auth.uid() and u.role='admin') then
    raise exception 'service_role or admin only';
  end if;
  for r in
    select id, track_code, release_date from public.tracks
    where release_status = 'scheduled' and release_date is not null
      and release_date <= current_date and source_type = 'artist_upload'
    order by release_date asc limit 200
  loop
    begin
      update public.tracks set release_status='released', released_at=now() where id = r.id;
      track_id := r.id; track_code := r.track_code; status := 'released'; error := null;
      return next;
    exception when others then
      insert into public.release_failures (track_id, kind, error_code, error_message, context)
      values (r.id, 'auto_release', SQLSTATE, SQLERRM, jsonb_build_object('release_date', r.release_date));
      track_id := r.id; track_code := r.track_code; status := 'failed'; error := SQLERRM;
      return next;
    end;
  end loop;
end; $function$;
grant execute on function public.process_due_scheduled_releases() to service_role, authenticated;

create or replace function public.admin_list_release_failures(p_track_id uuid default null, p_limit int default 50)
returns table (
  id bigint, track_id uuid, track_code text, title text,
  kind text, error_code text, error_message text, context jsonb, created_at timestamptz
)
language plpgsql security definer set search_path to 'public' as $function$
begin
  if not exists (select 1 from public.users u where u.id = auth.uid() and u.role='admin') then
    raise exception 'admin only';
  end if;
  return query
  select rf.id, rf.track_id, t.track_code, t.title,
         rf.kind, rf.error_code, rf.error_message, rf.context, rf.created_at
  from public.release_failures rf
  left join public.tracks t on t.id = rf.track_id
  where (p_track_id is null or rf.track_id = p_track_id)
  order by rf.created_at desc limit greatest(1, p_limit);
end; $function$;
grant execute on function public.admin_list_release_failures(uuid, int) to authenticated;

NOTIFY pgrst, 'reload schema';
