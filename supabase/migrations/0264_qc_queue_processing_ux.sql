-- 0264 — AI QC 큐 처리 UX 강화
--
-- 목표:
--   1. admin_qc_queue_audit_logs — status 변경 자동 기록 trigger 기반
--   2. admin_bulk_review_qc_queue — 일괄 검토 시작 (status=reviewing + assigned_to)
--   3. admin_retry_fingerprint_for_queue — fingerprint_failed 항목 재분석 마킹
--      (audio_fingerprints 의 status='pending' + retry_count=0 옵션)
--   4. admin_get_fingerprint_failure_detail — audio_fingerprints 최신 상태 + 트랙 정보
--   5. admin_get_qc_queue_audit — 변경 이력 조회

-- ===== A. admin_qc_queue_audit_logs =====
create table if not exists public.admin_qc_queue_audit_logs (
  id              uuid primary key default gen_random_uuid(),
  queue_id        uuid not null references public.admin_qc_queue(id) on delete cascade,
  track_id        uuid,
  admin_user_id   uuid references public.users(id) on delete set null,
  action          text not null,
  before_status   text,
  after_status    text,
  before_assignee uuid,
  after_assignee  uuid,
  note            text,
  created_at      timestamptz not null default now()
);

create index if not exists ix_qcqa_queue on public.admin_qc_queue_audit_logs(queue_id, created_at desc);
create index if not exists ix_qcqa_admin on public.admin_qc_queue_audit_logs(admin_user_id, created_at desc);
create index if not exists ix_qcqa_action on public.admin_qc_queue_audit_logs(action, created_at desc);

alter table public.admin_qc_queue_audit_logs enable row level security;
drop policy if exists "qcqa admin read" on public.admin_qc_queue_audit_logs;
create policy "qcqa admin read" on public.admin_qc_queue_audit_logs for select to authenticated
  using (exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin'));

-- ===== B. Trigger: admin_qc_queue 변경 자동 기록 =====
create or replace function public.tg_admin_qc_queue_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := auth.uid();
  v_action text;
begin
  if TG_OP = 'INSERT' then
    -- INSERT 는 룰 자동 생성 또는 admin 직접 추가
    v_action := 'created';
    insert into public.admin_qc_queue_audit_logs
      (queue_id, track_id, admin_user_id, action, before_status, after_status, after_assignee)
    values (NEW.id, NEW.track_id, v_admin, v_action, null, NEW.status, NEW.assigned_to);
    return NEW;
  end if;

  if TG_OP = 'UPDATE' then
    if OLD.status is distinct from NEW.status then
      v_action := case NEW.status
        when 'open' then 'reopen'
        when 'reviewing' then 'review_start'
        when 'resolved' then 'resolve'
        when 'dismissed' then 'dismiss'
        else 'status_change' end;
      insert into public.admin_qc_queue_audit_logs
        (queue_id, track_id, admin_user_id, action,
         before_status, after_status, before_assignee, after_assignee)
      values (NEW.id, NEW.track_id, v_admin, v_action,
              OLD.status, NEW.status, OLD.assigned_to, NEW.assigned_to);
    elsif OLD.assigned_to is distinct from NEW.assigned_to then
      insert into public.admin_qc_queue_audit_logs
        (queue_id, track_id, admin_user_id, action,
         before_status, after_status, before_assignee, after_assignee)
      values (NEW.id, NEW.track_id, v_admin, 'assign',
              OLD.status, NEW.status, OLD.assigned_to, NEW.assigned_to);
    end if;
    return NEW;
  end if;
  return NEW;
end; $$;

drop trigger if exists tg_admin_qc_queue_audit on public.admin_qc_queue;
create trigger tg_admin_qc_queue_audit
  after insert or update on public.admin_qc_queue
  for each row execute function public.tg_admin_qc_queue_audit();

-- ===== C. admin_bulk_review_qc_queue (일괄 검토 시작) =====
create or replace function public.admin_bulk_review_qc_queue(
  p_ids uuid[],
  p_assignee uuid default null,
  p_note text default null
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_admin uuid := auth.uid();
  v_assignee uuid;
  v_count int := 0;
begin
  if not exists (select 1 from public.users u where u.id=v_admin and u.role='admin') then
    raise exception 'unauthorized';
  end if;
  if p_ids is null or array_length(p_ids, 1) is null then
    return jsonb_build_object('ok', true, 'count', 0);
  end if;
  v_assignee := coalesce(p_assignee, v_admin);

  with updated as (
    update public.admin_qc_queue
      set status='reviewing', assigned_to=v_assignee, updated_at=now()
      where id = any(p_ids) and status in ('open','reviewing')
      returning id
  )
  select count(*) into v_count from updated;

  -- note 가 있으면 별도 audit row 추가
  if p_note is not null then
    insert into public.admin_qc_queue_audit_logs
      (queue_id, track_id, admin_user_id, action, note)
    select q.id, q.track_id, v_admin, 'review_note', p_note
    from public.admin_qc_queue q where q.id = any(p_ids);
  end if;

  return jsonb_build_object('ok', true, 'count', v_count);
end; $$;

-- ===== D. admin_retry_fingerprint_for_queue (재분석 + retry reset) =====
create or replace function public.admin_retry_fingerprint_for_queue(
  p_queue_id uuid,
  p_reset_retry boolean default false,
  p_note text default null
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_admin uuid := auth.uid();
  v_queue record;
  v_before_retry int;
  v_before_status text;
begin
  if not exists (select 1 from public.users u where u.id=v_admin and u.role='admin') then
    raise exception 'unauthorized';
  end if;
  select * into v_queue from public.admin_qc_queue where id = p_queue_id;
  if v_queue.id is null then raise exception 'queue_not_found'; end if;
  if v_queue.issue_type <> 'fingerprint_failed' then
    raise exception 'only_fingerprint_failed_supported (got: %)', v_queue.issue_type;
  end if;

  select retry_count, fingerprint_status into v_before_retry, v_before_status
  from public.audio_fingerprints where track_id = v_queue.track_id;

  update public.audio_fingerprints set
    fingerprint_status = 'pending',
    fingerprint_error = null,
    retry_count = case when p_reset_retry then 0 else retry_count end,
    fingerprint_attempted_at = now(),
    updated_at = now()
  where track_id = v_queue.track_id;

  -- queue 도 'reviewing' 으로 마킹 (재분석 진행 중)
  update public.admin_qc_queue
    set status='reviewing', assigned_to = v_admin, updated_at=now()
    where id = p_queue_id and status='open';

  insert into public.admin_qc_queue_audit_logs
    (queue_id, track_id, admin_user_id, action, note)
  values (p_queue_id, v_queue.track_id, v_admin,
          case when p_reset_retry then 'fingerprint_retry_with_reset' else 'fingerprint_retry' end,
          coalesce(p_note,
            format('before: status=%s retry=%s · after: pending retry=%s',
                   v_before_status, v_before_retry,
                   case when p_reset_retry then 0 else v_before_retry end)));

  return jsonb_build_object('ok', true,
    'before_status', v_before_status, 'before_retry', v_before_retry,
    'reset', p_reset_retry);
end; $$;

-- ===== E. admin_get_fingerprint_failure_detail =====
create or replace function public.admin_get_fingerprint_failure_detail(
  p_queue_id uuid
) returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_admin uuid := auth.uid();
  v_result jsonb;
begin
  if not exists (select 1 from public.users u where u.id=v_admin and u.role='admin') then
    raise exception 'unauthorized';
  end if;
  select jsonb_build_object(
    'queue', to_jsonb(q),
    'track', jsonb_build_object('id', t.id, 'title', t.title, 'artist', t.artist,
                                'audio_url', t.audio_url, 'audio_health_status', t.audio_health_status,
                                'audio_content_type', t.audio_content_type,
                                'audio_content_length', t.audio_content_length),
    'fingerprint', to_jsonb(f)
  ) into v_result
  from public.admin_qc_queue q
  left join public.tracks t on t.id = q.track_id
  left join public.audio_fingerprints f on f.track_id = q.track_id
  where q.id = p_queue_id;
  return v_result;
end; $$;

-- ===== F. admin_get_qc_queue_audit =====
create or replace function public.admin_get_qc_queue_audit(
  p_queue_id uuid default null,
  p_limit int default 50
) returns table (
  id uuid, queue_id uuid, track_id uuid,
  admin_user_id uuid, admin_name text,
  action text, before_status text, after_status text,
  before_assignee uuid, after_assignee uuid, note text, created_at timestamptz
)
language sql stable security definer set search_path = public
as $$
  select a.id, a.queue_id, a.track_id,
         a.admin_user_id, (select u.full_name from public.users u where u.id=a.admin_user_id),
         a.action, a.before_status, a.after_status,
         a.before_assignee, a.after_assignee, a.note, a.created_at
  from public.admin_qc_queue_audit_logs a
  where (p_queue_id is null or a.queue_id = p_queue_id)
  order by a.created_at desc
  limit coalesce(p_limit, 50);
$$;

-- ===== G. 권한 =====
revoke all on function public.admin_bulk_review_qc_queue(uuid[], uuid, text) from public, anon;
revoke all on function public.admin_retry_fingerprint_for_queue(uuid, boolean, text) from public, anon;
revoke all on function public.admin_get_fingerprint_failure_detail(uuid) from public, anon;
revoke all on function public.admin_get_qc_queue_audit(uuid, int) from public, anon;

grant execute on function public.admin_bulk_review_qc_queue(uuid[], uuid, text) to authenticated, service_role;
grant execute on function public.admin_retry_fingerprint_for_queue(uuid, boolean, text) to authenticated, service_role;
grant execute on function public.admin_get_fingerprint_failure_detail(uuid) to authenticated, service_role;
grant execute on function public.admin_get_qc_queue_audit(uuid, int) to authenticated, service_role;
