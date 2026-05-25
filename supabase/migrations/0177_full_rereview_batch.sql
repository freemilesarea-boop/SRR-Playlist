-- 0177 — 기존 업로드 전체 재검수 배치 (진단/플래그/검수대기까지만; 자동 삭제·비공개 금지). additive·idempotent.
-- 오디오 품질/DSP feature 분석(1~2)은 브라우저(분석 대기 탭). 본 RPC는 AI메타/guardrail/trust/플래그(3~8) 담당.
create table if not exists public.track_rereview_flags (
  id uuid primary key default gen_random_uuid(),
  track_id uuid not null references public.tracks(id) on delete cascade,
  flag_type text not null check (flag_type in ('needs_re_review','high_risk','quality_review_required','guardrail_hard')),
  status text not null default 'open' check (status in ('open','resolved','dismissed')),
  reason text, created_at timestamptz not null default now(),
  resolved_by uuid references public.users(id) on delete set null, resolved_at timestamptz,
  unique (track_id, flag_type)
);
create index if not exists idx_trf_type_status on public.track_rereview_flags(flag_type, status);
alter table public.track_rereview_flags enable row level security;
drop policy if exists trf_admin_read on public.track_rereview_flags;
create policy trf_admin_read on public.track_rereview_flags for select using (exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin'));

create or replace function public.admin_rereview_batch(p_offset int default 0, p_limit int default 15)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare r record; v_total int; v_done int := 0; v_failed int := 0;
begin
  if not exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin') then raise exception 'admin only'; end if;
  select count(*) into v_total from public.tracks t where t.source_type='artist_upload' and t.removed_at is null
    and t.release_status in ('released','approved','submitted','review_pending','scheduled');
  for r in select t.id from public.tracks t where t.source_type='artist_upload' and t.removed_at is null
      and t.release_status in ('released','approved','submitted','review_pending','scheduled')
    order by t.created_at, t.id offset greatest(0,p_offset) limit greatest(1,p_limit)
  loop
    begin perform public.recompute_track_ai_metadata(r.id); v_done := v_done + 1;
    exception when others then v_failed := v_failed + 1; end;
  end loop;
  return jsonb_build_object('ok', true, 'total', v_total, 'processed', v_done, 'failed', v_failed,
    'next_offset', p_offset + p_limit, 'has_more', (p_offset + p_limit) < v_total);
end; $$;
grant execute on function public.admin_rereview_batch(int, int) to authenticated;

create or replace function public.admin_rereview_summary()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin') then raise exception 'admin only'; end if;
  return jsonb_build_object(
    'total_target', (select count(*) from public.tracks t where t.source_type='artist_upload' and t.removed_at is null and t.release_status in ('released','approved','submitted','review_pending','scheduled')),
    'features_done', (select count(*) from public.track_audio_features f join public.tracks t on t.id=f.track_id where f.status='done' and t.removed_at is null),
    'features_missing', (select count(*) from public.tracks t where t.source_type='artist_upload' and t.removed_at is null and t.release_status in ('released','approved','submitted','review_pending','scheduled') and not exists (select 1 from public.track_audio_features f where f.track_id=t.id and f.status='done')),
    'features_failed', (select count(*) from public.track_audio_features where status='failed'),
    'quality_review_required', (select count(*) from public.track_rereview_flags where flag_type='quality_review_required' and status='open'),
    'guardrail_hard_tracks', (select count(distinct track_id) from public.track_guardrail_flags where severity='hard_block'),
    'mismatch_high', (select count(*) from public.track_ai_metadata where coalesce(mismatch_score,0) >= 0.5),
    'high_risk_flags', (select count(*) from public.track_rereview_flags where flag_type='high_risk' and status='open'),
    'needs_re_review', (select count(*) from public.track_rereview_flags where flag_type='needs_re_review' and status='open'),
    'low_trust_uploaders', (select count(*) from public.artist_profiles where coalesce(metadata_trust_score,100) < 50));
end; $$;
grant execute on function public.admin_rereview_summary() to authenticated;

create or replace function public.admin_list_rereview_flags(p_flag_type text default 'needs_re_review', p_limit int default 200)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v jsonb;
begin
  if not exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin') then raise exception 'admin only'; end if;
  select coalesce(jsonb_agg(row_to_json(x) order by x.created_at desc),'[]'::jsonb) into v from (
    select f.track_id, f.flag_type, f.status, f.reason, f.created_at, t.title, t.artist, t.release_status
    from public.track_rereview_flags f join public.tracks t on t.id=f.track_id
    where (p_flag_type='all' or f.flag_type=p_flag_type) and f.status='open' limit greatest(1,p_limit)) x;
  return v;
end; $$;
grant execute on function public.admin_list_rereview_flags(text, int) to authenticated;

create or replace function public.admin_resolve_rereview_flag(p_track_id uuid, p_flag_type text, p_status text default 'resolved', p_note text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid();
begin
  if not exists (select 1 from public.users u where u.id=v_uid and u.role='admin') then raise exception 'admin only'; end if;
  update public.track_rereview_flags set status=p_status, resolved_by=v_uid, resolved_at=now(), reason=coalesce(nullif(btrim(p_note),''), reason)
  where track_id=p_track_id and (p_flag_type='all' or flag_type=p_flag_type);
  return jsonb_build_object('ok', true);
end; $$;
grant execute on function public.admin_resolve_rereview_flag(uuid, text, text, text) to authenticated;
