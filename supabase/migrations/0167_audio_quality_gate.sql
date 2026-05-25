-- 0167 — 업로드 Loudness 품질 게이트 (등록 이전 차단). additive. stream_events/정산/승인 머신 미변경.
create table if not exists public.track_audio_quality (
  id uuid primary key default gen_random_uuid(),
  track_id uuid references public.tracks(id) on delete set null,
  upload_session_id text,
  user_id uuid references public.users(id) on delete set null,
  original_filename text,
  integrated_lufs numeric, true_peak numeric, loudness_range numeric,
  clipping_detected boolean default false,
  sample_rate int, channels int, bitrate_kbps int,
  passed_quality_check boolean not null default false,
  failure_reason text, analyzer_version text default 'ebur128-js-v1',
  analyzed_at timestamptz not null default now(), created_at timestamptz not null default now()
);
create index if not exists idx_taq_track on public.track_audio_quality(track_id, analyzed_at desc);
create index if not exists idx_taq_passed on public.track_audio_quality(passed_quality_check, analyzed_at desc);
create index if not exists idx_taq_session on public.track_audio_quality(upload_session_id);
alter table public.track_audio_quality enable row level security;
drop policy if exists taq_admin_read on public.track_audio_quality;
create policy taq_admin_read on public.track_audio_quality for select using (exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin'));
drop policy if exists taq_self_insert on public.track_audio_quality;
create policy taq_self_insert on public.track_audio_quality for insert with check (user_id is null or user_id = auth.uid());

create table if not exists public.audio_quality_config (
  id int primary key default 1 check (id=1),
  enabled boolean not null default true,
  lufs_min numeric not null default -14, lufs_max numeric not null default -10,
  true_peak_max numeric not null default -1.0, block_on_clipping boolean not null default true,
  updated_at timestamptz not null default now(), updated_by uuid references public.users(id) on delete set null
);
insert into public.audio_quality_config(id) values (1) on conflict (id) do nothing;
alter table public.audio_quality_config enable row level security;
drop policy if exists aqc_read on public.audio_quality_config;
create policy aqc_read on public.audio_quality_config for select using (true);

create or replace function public.get_audio_quality_config()
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select to_jsonb(c) from public.audio_quality_config c where id=1; $$;
grant execute on function public.get_audio_quality_config() to anon, authenticated;

create or replace function public.admin_update_audio_quality_config(p_patch jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid();
begin
  if not exists (select 1 from public.users u where u.id=v_uid and u.role='admin') then raise exception 'admin only'; end if;
  update public.audio_quality_config set
    enabled = coalesce((p_patch->>'enabled')::boolean, enabled),
    lufs_min = coalesce((p_patch->>'lufs_min')::numeric, lufs_min),
    lufs_max = coalesce((p_patch->>'lufs_max')::numeric, lufs_max),
    true_peak_max = coalesce((p_patch->>'true_peak_max')::numeric, true_peak_max),
    block_on_clipping = coalesce((p_patch->>'block_on_clipping')::boolean, block_on_clipping),
    updated_at=now(), updated_by=v_uid where id=1;
  return public.get_audio_quality_config();
end; $$;
grant execute on function public.admin_update_audio_quality_config(jsonb) to authenticated;

create or replace function public.record_audio_quality(
  p_track_id uuid, p_upload_session_id text, p_original_filename text,
  p_integrated_lufs numeric, p_true_peak numeric, p_loudness_range numeric, p_clipping boolean,
  p_sample_rate int, p_channels int, p_bitrate_kbps int,
  p_passed boolean, p_failure_reason text, p_analyzer_version text default 'ebur128-js-v1'
) returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid(); v_id uuid;
begin
  insert into public.track_audio_quality(track_id, upload_session_id, user_id, original_filename,
    integrated_lufs, true_peak, loudness_range, clipping_detected, sample_rate, channels, bitrate_kbps,
    passed_quality_check, failure_reason, analyzer_version)
  values (p_track_id, nullif(btrim(coalesce(p_upload_session_id,'')),''), v_uid, p_original_filename,
    p_integrated_lufs, p_true_peak, p_loudness_range, coalesce(p_clipping,false), p_sample_rate, p_channels, p_bitrate_kbps,
    coalesce(p_passed,false), p_failure_reason, coalesce(p_analyzer_version,'ebur128-js-v1'))
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end; $$;
grant execute on function public.record_audio_quality(uuid, text, text, numeric, numeric, numeric, boolean, int, int, int, boolean, text, text) to authenticated;

create or replace function public.admin_list_audio_quality(p_filter text default 'all', p_limit int default 200)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v jsonb;
begin
  if not exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin') then raise exception 'admin only'; end if;
  select coalesce(jsonb_agg(row_to_json(x) order by x.analyzed_at desc),'[]'::jsonb) into v from (
    select q.id, q.track_id, q.original_filename, q.integrated_lufs, q.true_peak, q.loudness_range,
           q.clipping_detected, q.sample_rate, q.channels, q.bitrate_kbps, q.passed_quality_check,
           q.failure_reason, q.analyzed_at, t.title, t.artist
    from public.track_audio_quality q left join public.tracks t on t.id=q.track_id
    where case p_filter
      when 'failed' then q.passed_quality_check=false
      when 'clipping' then q.clipping_detected=true
      when 'low_loudness' then q.failure_reason like '%low_loudness%'
      when 'over_compressed' then q.loudness_range is not null and q.loudness_range < 3
      else true end
    limit greatest(1,p_limit)
  ) x;
  return v;
end; $$;
grant execute on function public.admin_list_audio_quality(text, int) to authenticated;
