-- 0111 — 음원 일괄 삭제 (관리자) — 테스트/오류 데이터 정리
--   정책:
--     - settlement_items / streaming_revenues 연결 곡 → 삭제 차단(skip). (DB도 RESTRICT)
--     - release_status in (released, scheduled, approved) → 삭제 차단(skip). 공개 곡은 숨김(admin_hide) 사용.
--     - 그 외(draft/submitted/review_pending/changes_requested/rejected/removed) 만 삭제 허용.
--     - mode='soft'(기본): release_status='removed' + removed_*. 복구 가능.
--     - mode='hard': row 삭제(cascade: playlist_tracks/stream_events/liked 등). storage 파일은 cleanup 큐에 적재.
--   storage: 인라인 삭제 안 함(서비스 권한 필요) → storage_cleanup_queue 에 표시, 추후 job 이 purge.
--   정산/스트리밍/계약 기록 보존. 프론트+RPC 이중 가드.

create table if not exists public.storage_cleanup_queue (
  id uuid primary key default gen_random_uuid(),
  bucket text not null,
  path text not null,
  track_id uuid,
  reason text,
  enqueued_at timestamptz not null default now(),
  purged_at timestamptz
);
alter table public.storage_cleanup_queue enable row level security;
drop policy if exists storage_cleanup_admin_all on public.storage_cleanup_queue;
create policy storage_cleanup_admin_all on public.storage_cleanup_queue for all to authenticated
  using (exists (select 1 from public.users u where u.id = auth.uid() and u.role='admin'))
  with check (exists (select 1 from public.users u where u.id = auth.uid() and u.role='admin'));

create or replace function public.admin_bulk_delete_tracks(
  p_track_ids uuid[],
  p_mode text default 'soft',
  p_reason text default null)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_id uuid; v_t record;
  v_deleted int := 0; v_skipped jsonb := '[]'::jsonb; v_failed jsonb := '[]'::jsonb;
  v_has_money boolean; v_apath text; v_cpath text;
  v_mode text := case when lower(coalesce(p_mode,'soft')) = 'hard' then 'hard' else 'soft' end;
begin
  if not exists (select 1 from public.users u where u.id = v_uid and u.role='admin') then
    raise exception 'admin only';
  end if;
  if p_track_ids is null or array_length(p_track_ids,1) is null then
    return jsonb_build_object('deleted_count',0,'skipped_count',0,'skipped','[]'::jsonb,'failed','[]'::jsonb,'mode',v_mode);
  end if;
  if array_length(p_track_ids,1) > 1000 then raise exception 'too many ids (max 1000 per call)'; end if;

  foreach v_id in array p_track_ids loop
    begin
      select id, release_status, audio_url, cover_url into v_t from public.tracks where id = v_id;
      if v_t.id is null then
        v_failed := v_failed || jsonb_build_object('track_id', v_id, 'error', 'not_found');
        continue;
      end if;
      select exists(select 1 from public.settlement_items s where s.track_id = v_id)
          or exists(select 1 from public.streaming_revenues r where r.track_id = v_id)
        into v_has_money;
      if v_has_money then
        v_skipped := v_skipped || jsonb_build_object('track_id', v_id, 'reason', 'has_settlement_or_revenue');
        continue;
      end if;
      if v_t.release_status in ('released','scheduled','approved') then
        v_skipped := v_skipped || jsonb_build_object('track_id', v_id, 'reason', 'protected_status:'||v_t.release_status);
        continue;
      end if;

      if v_mode = 'hard' then
        v_apath := nullif(split_part(coalesce(v_t.audio_url,''), '/object/public/audio/', 2), '');
        v_cpath := nullif(split_part(coalesce(v_t.cover_url,''), '/object/public/covers/', 2), '');
        if v_apath is not null then
          insert into public.storage_cleanup_queue (bucket, path, track_id, reason) values ('audio', v_apath, v_id, 'bulk_delete');
        end if;
        if v_cpath is not null then
          insert into public.storage_cleanup_queue (bucket, path, track_id, reason) values ('covers', v_cpath, v_id, 'bulk_delete');
        end if;
        delete from public.tracks where id = v_id;
        v_deleted := v_deleted + 1;
      else
        update public.tracks set
          release_status = 'removed',
          removed_at = now(), removed_by = v_uid,
          removed_reason = nullif(btrim(coalesce(p_reason,'')), '')
        where id = v_id;
        v_deleted := v_deleted + 1;
      end if;
    exception when others then
      v_failed := v_failed || jsonb_build_object('track_id', v_id, 'error', SQLERRM);
    end;
  end loop;

  begin
    perform admin_log_operation('track','content','warn','completed',
      format('bulk delete tracks (%s) deleted=%s', v_mode, v_deleted),
      jsonb_build_object('mode',v_mode,'deleted',v_deleted,'skipped',v_skipped,'failed',v_failed),
      v_uid, null, null, null, null);
  exception when others then null; end;

  return jsonb_build_object(
    'deleted_count', v_deleted,
    'skipped_count', jsonb_array_length(v_skipped),
    'skipped', v_skipped,
    'failed', v_failed,
    'mode', v_mode
  );
end; $function$;
grant execute on function public.admin_bulk_delete_tracks(uuid[], text, text) to authenticated;