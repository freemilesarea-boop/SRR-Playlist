-- 0160 — AI 큐레이션 운영 안정화: 가중치 설정화(#7) + 자동배치 안전장치(#8) + 통합 위반 뷰(#6)

create table if not exists public.ai_scoring_config (
  id int primary key default 1 check (id = 1),
  fit_audio_w numeric not null default 0.50,
  fit_meta_w numeric not null default 0.20,
  fit_behavior_w numeric not null default 0.20,
  fit_penalty_w numeric not null default 0.10,
  mismatch_threshold numeric not null default 0.40,
  fit_recommend_cutoff numeric not null default 70,
  fit_exclude_cutoff numeric not null default 40,
  store_exclude_threshold numeric not null default 25,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.users(id) on delete set null
);
insert into public.ai_scoring_config(id) values (1) on conflict (id) do nothing;
alter table public.ai_scoring_config enable row level security;
drop policy if exists ai_cfg_admin_read on public.ai_scoring_config;
create policy ai_cfg_admin_read on public.ai_scoring_config for select
  using (exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin'));

create or replace function public.get_ai_scoring_config()
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select to_jsonb(c) from public.ai_scoring_config c where id=1;
$$;
grant execute on function public.get_ai_scoring_config() to authenticated;

create or replace function public.admin_update_ai_scoring_config(p_patch jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid();
begin
  if not exists (select 1 from public.users u where u.id=v_uid and u.role='admin') then raise exception 'admin only'; end if;
  update public.ai_scoring_config set
    fit_audio_w = coalesce((p_patch->>'fit_audio_w')::numeric, fit_audio_w),
    fit_meta_w = coalesce((p_patch->>'fit_meta_w')::numeric, fit_meta_w),
    fit_behavior_w = coalesce((p_patch->>'fit_behavior_w')::numeric, fit_behavior_w),
    fit_penalty_w = coalesce((p_patch->>'fit_penalty_w')::numeric, fit_penalty_w),
    mismatch_threshold = coalesce((p_patch->>'mismatch_threshold')::numeric, mismatch_threshold),
    fit_recommend_cutoff = coalesce((p_patch->>'fit_recommend_cutoff')::numeric, fit_recommend_cutoff),
    fit_exclude_cutoff = coalesce((p_patch->>'fit_exclude_cutoff')::numeric, fit_exclude_cutoff),
    store_exclude_threshold = coalesce((p_patch->>'store_exclude_threshold')::numeric, store_exclude_threshold),
    updated_at = now(), updated_by = v_uid
  where id=1;
  return public.get_ai_scoring_config();
end; $$;
grant execute on function public.admin_update_ai_scoring_config(jsonb) to authenticated;

create table if not exists public.ai_playlist_suggestions (
  id uuid primary key default gen_random_uuid(),
  playlist_id uuid not null references public.playlists(id) on delete cascade,
  track_id uuid not null references public.tracks(id) on delete cascade,
  fit_score numeric, reason text,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at timestamptz not null default now(),
  reviewed_by uuid references public.users(id) on delete set null,
  reviewed_at timestamptz,
  unique (playlist_id, track_id)
);
create index if not exists idx_aps_playlist_status on public.ai_playlist_suggestions(playlist_id, status, fit_score desc);
alter table public.ai_playlist_suggestions enable row level security;
drop policy if exists aps_admin_read on public.ai_playlist_suggestions;
create policy aps_admin_read on public.ai_playlist_suggestions for select
  using (exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin'));

create or replace function public.admin_generate_ai_suggestions(p_playlist_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_n int := 0; v_cut numeric;
begin
  if not exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin') then raise exception 'admin only'; end if;
  select fit_recommend_cutoff into v_cut from public.ai_scoring_config where id=1;
  insert into public.ai_playlist_suggestions(playlist_id, track_id, fit_score, reason, status)
  select s.playlist_id, s.track_id, s.fit_score, s.reason, 'pending'
  from public.playlist_track_fit_scores s
  join public.tracks t on t.id=s.track_id
  where s.playlist_id=p_playlist_id and s.status='active' and s.fit_score >= v_cut
    and t.release_status in ('released','approved') and t.removed_at is null
    and not exists (select 1 from public.playlist_tracks pt where pt.playlist_id=s.playlist_id and pt.track_id=s.track_id)
  on conflict (playlist_id, track_id) do update set
    fit_score=excluded.fit_score, reason=excluded.reason,
    status=case when public.ai_playlist_suggestions.status='rejected' then 'rejected' else 'pending' end;
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'suggestions', v_n);
end; $$;
grant execute on function public.admin_generate_ai_suggestions(uuid) to authenticated;

create or replace function public.admin_decide_ai_suggestion(p_id uuid, p_approve boolean)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid(); s record; v_next int;
begin
  if not exists (select 1 from public.users u where u.id=v_uid and u.role='admin') then raise exception 'admin only'; end if;
  select * into s from public.ai_playlist_suggestions where id=p_id;
  if s.id is null then raise exception 'suggestion not found'; end if;
  if p_approve then
    if not exists (select 1 from public.playlist_tracks pt where pt.playlist_id=s.playlist_id and pt.track_id=s.track_id) then
      select coalesce(max(order_index),0)+1 into v_next from public.playlist_tracks where playlist_id=s.playlist_id;
      insert into public.playlist_tracks(playlist_id, track_id, order_index, match_score, placement_reason, placed_by)
      values (s.playlist_id, s.track_id, v_next, s.fit_score, coalesce(s.reason,'AI 추천 승인'), 'ai_approved');
    end if;
    update public.ai_playlist_suggestions set status='approved', reviewed_by=v_uid, reviewed_at=now() where id=p_id;
  else
    update public.ai_playlist_suggestions set status='rejected', reviewed_by=v_uid, reviewed_at=now() where id=p_id;
  end if;
  return jsonb_build_object('ok', true, 'approved', p_approve);
end; $$;
grant execute on function public.admin_decide_ai_suggestion(uuid, boolean) to authenticated;

create or replace function public.admin_list_ai_suggestions(p_playlist_id uuid, p_status text default 'pending')
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v jsonb;
begin
  if not exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin') then raise exception 'admin only'; end if;
  select coalesce(jsonb_agg(row_to_json(x) order by x.fit_score desc),'[]'::jsonb) into v from (
    select a.id, a.track_id, a.fit_score, a.reason, a.status, t.title, t.artist, t.cover_url
    from public.ai_playlist_suggestions a join public.tracks t on t.id=a.track_id
    where a.playlist_id=p_playlist_id and (p_status='all' or a.status=p_status)
  ) x;
  return v;
end; $$;
grant execute on function public.admin_list_ai_suggestions(uuid, text) to authenticated;

create or replace function public.admin_list_unified_violations(p_limit int default 200)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v jsonb;
begin
  if not exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin') then raise exception 'admin only'; end if;
  select coalesce(jsonb_agg(row_to_json(x) order by x.severity_rank desc, x.detected_at desc),'[]'::jsonb) into v from (
    select c.id::text as id, 'skip' as source, c.track_id, c.playlist_id, t.title, t.artist,
           coalesce(c.violation_type,'high_skip_rate') as violation_type,
           coalesce(c.severity,'medium') as severity,
           case coalesce(c.severity,'medium') when 'high' then 3 when 'medium' then 2 else 1 end as severity_rank,
           c.skip_count, c.mismatch_score, c.status, c.reason, c.last_detected_at as detected_at, c.admin_note
    from public.metadata_violation_candidates c join public.tracks t on t.id=c.track_id
    union all
    select 'ai:'||m.track_id::text as id, 'ai' as source, m.track_id, null::uuid as playlist_id, t.title, t.artist,
           case
             when exists (select 1 from unnest(coalesce(m.mismatch_reasons,'{}')) r where r like '%적합도%') then 'wrong_store_fit'
             when exists (select 1 from unnest(coalesce(m.mismatch_reasons,'{}')) r where r like '%에너지%') then 'wrong_energy'
             else 'ai_mismatch' end as violation_type,
           case when m.mismatch_score>=0.6 then 'high' when m.mismatch_score>=0.4 then 'medium' else 'low' end as severity,
           case when m.mismatch_score>=0.6 then 3 when m.mismatch_score>=0.4 then 2 else 1 end as severity_rank,
           null::int as skip_count, m.mismatch_score, m.status, m.explanation as reason, m.updated_at as detected_at, null::text as admin_note
    from public.track_ai_metadata m join public.tracks t on t.id=m.track_id
    where coalesce(m.mismatch_score,0) >= (select mismatch_threshold from public.ai_scoring_config where id=1)
      and m.status <> 'reviewed'
    limit greatest(1,p_limit)
  ) x;
  return v;
end; $$;
grant execute on function public.admin_list_unified_violations(int) to authenticated;

-- _ai_compute_fit: fit 가중치/cutoff 를 ai_scoring_config 에서 읽도록 (#7)
create or replace function public._ai_compute_fit(p_playlist_id uuid, p_track_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare
  pl record; ai record; t record; cfg record;
  v_key text; v_audio numeric; v_meta numeric; v_behav numeric; v_pen numeric; v_fit numeric;
  v_plays int; v_comps int; v_skips int; v_status text; v_reason text; v_excluded boolean := false;
begin
  select * into cfg from public.ai_scoring_config where id=1;
  select id, business_category, category, daypart, genre_tags, mood_tags, situation_tags
    into pl from public.playlists where id=p_playlist_id;
  if pl.id is null then return; end if;
  select * into ai from public.track_ai_metadata where track_id=p_track_id;
  select genre_tags, mood_tags, audio_health_status into t from public.tracks where id=p_track_id;

  v_key := public._ai_playlist_store_key(pl.business_category, pl.category, pl.daypart);
  if ai.track_id is not null and v_key is not null and ai.ai_store_fit ? v_key then
    v_audio := (ai.ai_store_fit->>v_key)::numeric; else v_audio := 50; end if;

  v_meta := 50 + public._ai_overlap(pl.genre_tags, t.genre_tags)*8 + public._ai_overlap(pl.mood_tags, t.mood_tags)*8
    + (case when ai.track_id is not null then public._ai_overlap(pl.situation_tags, ai.ai_situations)*6 else 0 end)
    - (case when ai.track_id is not null then coalesce(ai.mismatch_score,0)*30 else 0 end);
  v_meta := least(100, greatest(0, v_meta));

  select count(*) filter (where event_type in ('play','start')), count(*) filter (where event_type='complete'), count(*) filter (where event_type='skip')
    into v_plays, v_comps, v_skips
  from public.track_play_events where playlist_id=p_playlist_id and track_id=p_track_id and created_at > now()-interval '90 days';
  if coalesce(v_plays,0) = 0 then v_behav := 50;
  else v_behav := least(100, greatest(0, 50 + (v_comps::numeric/v_plays)*40 - (v_skips::numeric/v_plays)*40)); end if;

  v_pen := (case when ai.track_id is not null then coalesce(ai.mismatch_score,0)*40 else 0 end)
    + (case when t.audio_health_status='conversion_failed' then 50 else 0 end)
    + least(30, coalesce((select count(*) from public.playlist_track_skip_events e
         where e.playlist_id=p_playlist_id and e.track_id=p_track_id and e.created_at>now()-interval '30 days' and e.played_seconds>=5),0)*5);
  v_pen := least(100, greatest(0, v_pen));

  v_fit := least(100, greatest(0, v_audio*cfg.fit_audio_w + v_meta*cfg.fit_meta_w + v_behav*cfg.fit_behavior_w - v_pen*cfg.fit_penalty_w));
  if ai.track_id is not null and v_key is not null and ai.ai_exclusions @> array[v_key] then v_excluded := true; end if;
  v_status := case when v_excluded then 'excluded' when v_fit < cfg.fit_exclude_cutoff then 'review_needed' else 'active' end;
  v_reason := format('audio %s · meta %s · behavior %s · penalty %s%s', round(v_audio), round(v_meta), round(v_behav), round(v_pen),
    case when v_key is not null then ' · store='||v_key else '' end);

  insert into public.playlist_track_fit_scores(playlist_id, track_id, fit_score, audio_score, metadata_score, behavior_score, penalty_score, reason, source, status, updated_at)
  values (p_playlist_id, p_track_id, round(v_fit), round(v_audio), round(v_meta), round(v_behav), round(v_pen), v_reason, 'algorithm', v_status, now())
  on conflict (playlist_id, track_id) do update set
    fit_score=excluded.fit_score, audio_score=excluded.audio_score, metadata_score=excluded.metadata_score,
    behavior_score=excluded.behavior_score, penalty_score=excluded.penalty_score, reason=excluded.reason,
    status=case when public.playlist_track_fit_scores.source='admin' then public.playlist_track_fit_scores.status else excluded.status end,
    updated_at=now();
end; $$;
