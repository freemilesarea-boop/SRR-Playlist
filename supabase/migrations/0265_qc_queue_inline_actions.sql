-- 0265 — QC 큐 inline 운영 조치
--
-- 목표:
--   1. admin_get_qc_track_context(queue_id) — 큐 row 한 곳에서 보여줄
--      모든 정보 (track + audio_features + 속한 playlists + fit) 통합 RPC
--   2. admin_qc_act_and_resolve(queue_id, action, ..., resolve_after) — 큐에서
--      직접 운영 조치 + 옵션으로 큐 자동 resolved
--   3. admin_track_audit_logs 에 queue_id 컬럼 추가 (조치-큐 연결 추적)

-- ===== A. admin_track_audit_logs.queue_id 추가 =====
alter table public.admin_track_audit_logs
  add column if not exists queue_id uuid references public.admin_qc_queue(id) on delete set null;

create index if not exists ix_atal_queue
  on public.admin_track_audit_logs(queue_id, created_at desc) where queue_id is not null;

-- ===== B. admin_get_qc_track_context =====
create or replace function public.admin_get_qc_track_context(p_queue_id uuid)
returns jsonb
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
    'track', jsonb_build_object(
      'id', t.id, 'title', t.title, 'artist', t.artist, 'cover_url', t.cover_url,
      'audio_url', t.audio_url, 'duration', t.duration,
      'main_genre', t.main_genre, 'sub_genre', t.sub_genre,
      'mood', t.mood, 'mood_tags', t.mood_tags, 'genre_tags', t.genre_tags,
      'suitable_store', t.suitable_store, 'business_tags', t.business_tags,
      'bpm', t.bpm, 'energy_level', t.energy_level,
      'instrumental', t.instrumental, 'explicit_content', t.explicit_content,
      'language', t.language, 'vocal_type', t.vocal_type, 'admin_note', t.admin_note,
      'audio_health_status', t.audio_health_status
    ),
    'audio_features', to_jsonb(af),
    'playlists', coalesce((
      select jsonb_agg(jsonb_build_object(
        'pt_id', pt.id, 'order_index', pt.order_index,
        'placement_reason', pt.placement_reason, 'placed_by', pt.placed_by,
        'removed_at', pt.removed_at, 'removed_reason', pt.removed_reason,
        'playlist_id', pl.id, 'playlist_name', pl.title,
        'business_category', pl.business_category,
        'normalized_slug', public.normalize_store_label(pl.business_category),
        'fit_score', f.fit_score, 'fit_status', f.status, 'fit_source', f.source,
        'reason', f.reason, 'reason_codes', f.reason_codes,
        'audio_score', f.audio_score, 'metadata_score', f.metadata_score,
        'behavior_score', f.behavior_score, 'penalty_score', f.penalty_score
      ) order by case when pt.removed_at is null then 0 else 1 end, pl.title)
      from public.playlist_tracks pt
      join public.playlists pl on pl.id = pt.playlist_id
      left join public.playlist_track_fit_scores f
        on f.playlist_id = pt.playlist_id and f.track_id = pt.track_id
      where pt.track_id = q.track_id
    ), '[]'::jsonb)
  ) into v_result
  from public.admin_qc_queue q
  join public.tracks t on t.id = q.track_id
  left join public.track_audio_features af on af.track_id = q.track_id
  where q.id = p_queue_id;

  if v_result is null then raise exception 'queue_not_found'; end if;
  return v_result;
end; $$;

-- ===== C. admin_qc_act_and_resolve (wrapper) =====
-- 액션 + 옵션으로 큐 resolved 처리. 모든 admin_track_audit_logs 에 queue_id 자동 연결.
create or replace function public.admin_qc_act_and_resolve(
  p_queue_id uuid,
  p_action text,                 -- 'remove' | 'change_status' | 'update_metadata' | 'recompute'
  p_playlist_id uuid default null,
  p_payload jsonb default null,
  p_status text default null,
  p_reason text default null,
  p_admin_note text default null,
  p_resolve_after boolean default false
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_admin uuid := auth.uid();
  v_queue record;
  v_action_result jsonb;
  v_resolved boolean := false;
  v_latest_audit_id uuid;
begin
  if not exists (select 1 from public.users u where u.id=v_admin and u.role='admin') then
    raise exception 'unauthorized';
  end if;
  select * into v_queue from public.admin_qc_queue where id = p_queue_id;
  if v_queue.id is null then raise exception 'queue_not_found'; end if;

  -- action 분기
  if p_action = 'remove' then
    if p_playlist_id is null then raise exception 'playlist_id required for remove'; end if;
    v_action_result := public.admin_remove_track_from_playlist(p_playlist_id, v_queue.track_id, p_reason);
  elsif p_action = 'change_status' then
    if p_playlist_id is null or p_status is null then
      raise exception 'playlist_id and status required for change_status';
    end if;
    v_action_result := public.admin_change_track_fit_status(
      p_playlist_id, v_queue.track_id, p_status, p_reason, p_admin_note);
  elsif p_action = 'update_metadata' then
    if p_payload is null then raise exception 'payload required for update_metadata'; end if;
    v_action_result := public.admin_update_track_metadata(v_queue.track_id, p_payload, p_reason);
  elsif p_action = 'recompute' then
    if p_playlist_id is null then raise exception 'playlist_id required for recompute'; end if;
    v_action_result := public.admin_recompute_track_fit(p_playlist_id, v_queue.track_id, false);
  else
    raise exception 'invalid_action: %', p_action;
  end if;

  -- 방금 생성된 admin_track_audit_logs row 에 queue_id 연결
  update public.admin_track_audit_logs
    set queue_id = p_queue_id
    where id = (
      select id from public.admin_track_audit_logs
      where track_id = v_queue.track_id and queue_id is null
      order by created_at desc limit 1
    );

  -- p_resolve_after=true 면 큐 resolved
  if p_resolve_after and v_queue.status in ('open','reviewing') then
    update public.admin_qc_queue
      set status='resolved', resolved_at=now(), updated_at=now()
      where id = p_queue_id;
    v_resolved := true;
    -- trigger tg_admin_qc_queue_audit 가 자동으로 'resolve' 기록
    -- 추가 컨텍스트 (action + summary) 를 별도 audit row 로 기록
    insert into public.admin_qc_queue_audit_logs
      (queue_id, track_id, admin_user_id, action, note)
    values (p_queue_id, v_queue.track_id, v_admin,
            'qc_inline_action',
            format('action=%s · playlist=%s · result=%s',
                   p_action, coalesce(p_playlist_id::text,'—'),
                   substring(v_action_result::text from 1 for 200)));
  end if;

  return jsonb_build_object(
    'ok', true, 'action', p_action, 'queue_id', p_queue_id,
    'action_result', v_action_result, 'resolved', v_resolved);
end; $$;

-- ===== D. 권한 =====
revoke all on function public.admin_get_qc_track_context(uuid) from public, anon;
revoke all on function public.admin_qc_act_and_resolve(uuid, text, uuid, jsonb, text, text, text, boolean) from public, anon;
grant execute on function public.admin_get_qc_track_context(uuid) to authenticated, service_role;
grant execute on function public.admin_qc_act_and_resolve(uuid, text, uuid, jsonb, text, text, text, boolean) to authenticated, service_role;
