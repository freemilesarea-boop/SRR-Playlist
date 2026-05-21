-- 0109 — 검수 일괄 승인/거절 + 업로드 묶음 단위 메일 1통
--   문제: 곡별 승인 → 곡별 메일(10곡=10통). Resend 비용/메일 폭탄.
--   해결: (1) 묶음키(batch_key=owner|앨범|발매일) 기준 메일 job 1개만 enqueue(부분 unique),
--         (2) 메일 본문에 묶음 곡 목록/곡수 포함,
--         (3) 일괄 승인/거절 + 전체(필터) 승인 RPC.
--   정산/스트리밍 로직 변경 없음. 승인 상태 변경은 기존 admin_approve_artist_release 재사용(트랙별 atomic).

create or replace function public.moderation_batch_key(p_owner uuid, p_album text, p_release_title text, p_release_date date)
returns text language sql immutable as $function$
  select coalesce(p_owner::text,'-')
      || '|' || coalesce(nullif(btrim(p_album),''), nullif(btrim(p_release_title),''), 'single')
      || '|' || coalesce(p_release_date::text,'-');
$function$;

alter table public.track_moderation_email_jobs add column if not exists batch_key text;

update public.track_moderation_email_jobs j
set batch_key = public.moderation_batch_key(t.owner_user_id, t.album_name, t.release_title, t.release_date)
from public.tracks t
where t.id = j.track_id and j.batch_key is null;

create unique index if not exists uq_track_mod_email_jobs_batch
  on public.track_moderation_email_jobs (batch_key, kind)
  where status in ('pending','sending') and batch_key is not null;

create or replace function public._enqueue_track_moderation_email()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare v_owner_email text; v_kind text; v_subject text; v_batch text;
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
  v_batch := public.moderation_batch_key(NEW.owner_user_id, NEW.album_name, NEW.release_title, NEW.release_date);
  v_subject := case v_kind
    when 'released' then '[듣다] 음원이 공개되었습니다'
    when 'scheduled' then '[듣다] 음원 발매가 예약되었습니다'
    when 'approved' then '[듣다] 음원 검수가 승인되었습니다'
    when 'rejected' then '[듣다] 음원 업로드가 반려되었습니다'
    when 'revision_requested' then '[듣다] 음원 수정 요청이 도착했습니다'
    when 'removed' then '[듣다] 음원이 제거되었습니다'
    else '[듣다] 음원 상태 안내'
  end;
  insert into public.track_moderation_email_jobs (track_id, recipient_email, recipient_user_id, kind, subject, batch_key)
  values (NEW.id, v_owner_email, NEW.owner_user_id, v_kind, v_subject, v_batch)
  on conflict (batch_key, kind) where (status in ('pending','sending') and batch_key is not null) do nothing;
  return NEW;
end; $function$;

drop function if exists public.get_pending_track_moderation_email_jobs(uuid, int);
create or replace function public.get_pending_track_moderation_email_jobs(p_track_id uuid default null, p_limit int default 50)
returns table (job_id uuid, track_id uuid, recipient_email text, recipient_user_id uuid, kind text, subject text, attempts int,
  track_title text, track_artist text, track_code text, release_status text, release_date date,
  admin_review_note text, rejected_reason text, changes_requested_reason text, removed_reason text, artist_name text,
  batch_key text, batch_count int, batch_titles text[])
language plpgsql security definer set search_path to 'public' as $function$
begin
  if current_setting('request.jwt.claim.role', true) <> 'service_role' and auth.role() <> 'service_role' then raise exception 'service_role only'; end if;
  return query
  select j.id, j.track_id, j.recipient_email, j.recipient_user_id, j.kind, j.subject, j.attempts,
         t.title, t.artist, t.track_code, t.release_status, t.release_date,
         t.admin_review_note, t.rejected_reason, t.changes_requested_reason, t.removed_reason,
         coalesce(ap.artist_name, u.full_name, ''),
         j.batch_key,
         coalesce(b.cnt, 1)::int,
         coalesce(b.titles, array[t.title])
  from public.track_moderation_email_jobs j
  join public.tracks t on t.id = j.track_id
  left join public.users u on u.id = t.owner_user_id
  left join public.artist_profiles ap on ap.user_id = t.owner_user_id
  left join lateral (
    select count(*)::int as cnt, array_agg(bt.title order by bt.created_at) as titles
    from public.tracks bt
    where j.batch_key is not null
      and public.moderation_batch_key(bt.owner_user_id, bt.album_name, bt.release_title, bt.release_date) = j.batch_key
      and bt.source_type = 'artist_upload'
      and (
        (j.kind in ('approved','released','scheduled') and bt.release_status in ('approved','scheduled','released'))
        or (j.kind = 'rejected' and bt.release_status = 'rejected')
        or (j.kind = 'revision_requested' and bt.release_status = 'changes_requested')
        or (j.kind = 'removed' and bt.release_status = 'removed')
      )
  ) b on true
  where j.status = 'pending' and (p_track_id is null or j.track_id = p_track_id)
  order by j.created_at asc limit greatest(1, p_limit);
end; $function$;
revoke all on function public.get_pending_track_moderation_email_jobs(uuid, int) from public;
grant execute on function public.get_pending_track_moderation_email_jobs(uuid, int) to service_role;

-- ===== 일괄 승인/거절 =====
create or replace function public.admin_bulk_approve_tracks(p_track_ids uuid[], p_immediate boolean default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v_id uuid; v_ok int := 0; v_failed jsonb := '[]'::jsonb;
begin
  if not exists (select 1 from public.users u where u.id = auth.uid() and u.role='admin') then raise exception 'admin only'; end if;
  if p_track_ids is null or array_length(p_track_ids,1) is null then return jsonb_build_object('ok',true,'approved',0,'failed','[]'::jsonb); end if;
  if array_length(p_track_ids,1) > 1000 then raise exception 'too many ids (max 1000 per call)'; end if;
  foreach v_id in array p_track_ids loop
    begin
      perform public.admin_approve_artist_release(v_id, p_immediate);
      v_ok := v_ok + 1;
    exception when others then
      v_failed := v_failed || jsonb_build_object('track_id', v_id, 'error', SQLERRM);
    end;
  end loop;
  return jsonb_build_object('ok', jsonb_array_length(v_failed)=0, 'approved', v_ok, 'failed', v_failed);
end; $function$;
grant execute on function public.admin_bulk_approve_tracks(uuid[], boolean) to authenticated;

create or replace function public.admin_bulk_reject_tracks(p_track_ids uuid[], p_reason text)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v_id uuid; v_ok int := 0; v_failed jsonb := '[]'::jsonb;
begin
  if not exists (select 1 from public.users u where u.id = auth.uid() and u.role='admin') then raise exception 'admin only'; end if;
  if p_reason is null or length(btrim(p_reason))=0 then raise exception 'reason required'; end if;
  if p_track_ids is null or array_length(p_track_ids,1) is null then return jsonb_build_object('ok',true,'rejected',0,'failed','[]'::jsonb); end if;
  if array_length(p_track_ids,1) > 1000 then raise exception 'too many ids (max 1000 per call)'; end if;
  foreach v_id in array p_track_ids loop
    begin
      perform public.admin_reject_artist_release(v_id, p_reason);
      v_ok := v_ok + 1;
    exception when others then
      v_failed := v_failed || jsonb_build_object('track_id', v_id, 'error', SQLERRM);
    end;
  end loop;
  return jsonb_build_object('ok', jsonb_array_length(v_failed)=0, 'rejected', v_ok, 'failed', v_failed);
end; $function$;
grant execute on function public.admin_bulk_reject_tracks(uuid[], text) to authenticated;

-- 전체(필터) 승인 — 서버가 pending 을 chunk 로 선택해 승인. remaining 반환 → 프론트 반복(progress).
create or replace function public.admin_approve_all_pending(p_artist_id uuid default null, p_immediate boolean default null, p_limit int default 200)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v_id uuid; v_ok int := 0; v_failed jsonb := '[]'::jsonb; v_remaining int;
begin
  if not exists (select 1 from public.users u where u.id = auth.uid() and u.role='admin') then raise exception 'admin only'; end if;
  for v_id in
    select t.id from public.tracks t
    where t.source_type='artist_upload'
      and t.release_status in ('submitted','review_pending','changes_requested')
      and (p_artist_id is null or t.owner_user_id = p_artist_id)
    order by t.created_at asc
    limit greatest(1, least(coalesce(p_limit,200), 500))
  loop
    begin
      perform public.admin_approve_artist_release(v_id, p_immediate);
      v_ok := v_ok + 1;
    exception when others then
      v_failed := v_failed || jsonb_build_object('track_id', v_id, 'error', SQLERRM);
    end;
  end loop;
  select count(*) into v_remaining from public.tracks t
    where t.source_type='artist_upload'
      and t.release_status in ('submitted','review_pending','changes_requested')
      and (p_artist_id is null or t.owner_user_id = p_artist_id);
  return jsonb_build_object('ok', jsonb_array_length(v_failed)=0, 'approved', v_ok, 'failed', v_failed, 'remaining', v_remaining);
end; $function$;
grant execute on function public.admin_approve_all_pending(uuid, boolean, int) to authenticated;
