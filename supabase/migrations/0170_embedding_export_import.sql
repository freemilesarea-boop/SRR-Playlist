-- 0170 — embedding PoC export/import (Colab 수동 파이프라인). additive. 추천/차트/정산 미변경.

create or replace function public.admin_export_embedding_pending_tracks(p_model text default 'openl3', p_limit int default 500)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v jsonb;
begin
  if not exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin') then raise exception 'admin only'; end if;
  select coalesce(jsonb_agg(row_to_json(x)),'[]'::jsonb) into v from (
    select t.id as track_id, t.title, t.artist, t.audio_url, t.duration
    from public.tracks t
    where t.source_type in ('artist_upload','admin_upload') and t.removed_at is null
      and t.release_status in ('released','approved','scheduled') and t.audio_url is not null
      and not exists (select 1 from public.track_embeddings e where e.track_id=t.id and e.model_name=p_model and e.status='done')
    order by t.created_at desc limit greatest(1, p_limit)
  ) x;
  return v;
end; $$;
grant execute on function public.admin_export_embedding_pending_tracks(text, int) to authenticated;

-- 검증 후 upsert. dry_run=true 면 검증만. 관리자(JWT) 또는 service_role 허용.
create or replace function public.admin_import_track_embeddings(p_rows jsonb, p_dry_run boolean default true)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  r jsonb; v_tid uuid; v_model text; v_ver text; v_dim int; v_emb jsonb; v_len int;
  v_imported int := 0; v_skipped int := 0; v_errors jsonb := '[]'::jsonb;
begin
  if not (exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin')
          or coalesce(auth.role(),'') = 'service_role') then
    raise exception 'admin or service_role only';
  end if;
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'p_rows must be a JSON array'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    begin
      v_model := coalesce(nullif(btrim(r->>'model_name'),''), 'openl3');
      v_ver := coalesce(nullif(btrim(r->>'model_version'),''), 'v1');
      v_emb := r->'embedding';
      begin v_tid := (r->>'track_id')::uuid; exception when others then
        v_skipped := v_skipped + 1; v_errors := v_errors || jsonb_build_object('track_id', r->>'track_id', 'reason', 'invalid uuid'); continue;
      end;
      if not exists (select 1 from public.tracks t where t.id=v_tid) then
        v_skipped := v_skipped + 1; v_errors := v_errors || jsonb_build_object('track_id', v_tid, 'reason', 'track not found'); continue;
      end if;
      if v_emb is null or jsonb_typeof(v_emb) <> 'array' then
        v_skipped := v_skipped + 1; v_errors := v_errors || jsonb_build_object('track_id', v_tid, 'reason', 'embedding not array'); continue;
      end if;
      v_len := jsonb_array_length(v_emb);
      v_dim := coalesce((r->>'embedding_dim')::int, v_len);
      if v_len = 0 or v_len <> v_dim then
        v_skipped := v_skipped + 1; v_errors := v_errors || jsonb_build_object('track_id', v_tid, 'reason', format('dim mismatch (len=%s, dim=%s)', v_len, v_dim)); continue;
      end if;
      if p_dry_run then v_imported := v_imported + 1; continue; end if;
      insert into public.track_embeddings(track_id, model_name, model_version, embedding, embedding_dim, segment_type, status, updated_at)
      values (v_tid, v_model, v_ver, (v_emb::text)::public.vector, v_dim, coalesce(r->>'segment_type','full'), 'done', now())
      on conflict (track_id, model_name) do update set
        model_version=excluded.model_version, embedding=excluded.embedding, embedding_dim=excluded.embedding_dim,
        segment_type=excluded.segment_type, status='done', error_message=null, updated_at=now();
      v_imported := v_imported + 1;
    exception when others then
      v_skipped := v_skipped + 1; v_errors := v_errors || jsonb_build_object('track_id', coalesce(v_tid::text, r->>'track_id'), 'reason', sqlerrm);
    end;
  end loop;
  return jsonb_build_object('ok', true, 'dry_run', p_dry_run, 'imported', v_imported, 'skipped', v_skipped, 'errors', v_errors);
end; $$;
grant execute on function public.admin_import_track_embeddings(jsonb, boolean) to authenticated, service_role;
