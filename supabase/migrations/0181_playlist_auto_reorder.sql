-- 0181 — Playlist Auto Reordering AI. Flow Score 기반 곡 순서 최적화 "제안" 생성.
-- 자동 적용 금지: 제안(pending)만 생성. 관리자가 admin_apply_playlist_reorder 호출 시에만 order_index 반영.
-- playlist_tracks 행 추가/삭제 없음(순서만). stream_events / 정산 / 차트 / release_status 미접근.

create table if not exists public.playlist_reorder_proposals (
  id uuid primary key default gen_random_uuid(),
  playlist_id uuid not null references public.playlists(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','applied','rejected')),
  current_order uuid[] not null,
  proposed_order uuid[] not null,
  current_score int, proposed_score int, improvement int,
  metrics_before jsonb, metrics_after jsonb,
  created_at timestamptz not null default now(), created_by uuid,
  applied_at timestamptz, applied_by uuid, rejected_at timestamptz
);
create index if not exists idx_prp_playlist_status on public.playlist_reorder_proposals(playlist_id, status);
alter table public.playlist_reorder_proposals enable row level security;
drop policy if exists prp_admin_read on public.playlist_reorder_proposals;
create policy prp_admin_read on public.playlist_reorder_proposals for select using (exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin'));

-- 주어진 순서(uuid[])의 flow 지표 계산 (flow 엔진과 동일 공식, dominant-mood 사용)
create or replace function public._flow_score_of_order(p_ids uuid[])
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  r record; has_prev boolean := false;
  p_bpm numeric; p_en numeric; p_br numeric; p_vo numeric; p_md text;
  c_md text; d_bpm numeric; d_en numeric; d_br numeric; d_vo numeric; v_drop numeric;
  pb numeric; pe numeric; pbr numeric; pv numeric; pd numeric; pm numeric; v_sim boolean;
  v_pen numeric; v_ts int;
  v_n int := 0; v_sum numeric := 0; v_rough int := 0; v_repeat int := 0; v_dropc int := 0; v_moodc int := 0;
  v_run int := 0; v_maxrun int := 0; v_cont numeric := 0;
  v_avg numeric; v_fat numeric; v_mono numeric; v_emc int; v_flow int;
begin
  for r in
    select coalesce(f.bpm,100) bpm, coalesce(f.energy,0.5) en, coalesce(f.brightness,0.3) br,
           coalesce(f.vocal_presence,0.4) vo, (m.ai_moods)[1] md
    from unnest(p_ids) with ordinality as u(tid, ord)
    left join public.track_audio_features f on f.track_id = u.tid and f.status='done'
    left join public.track_ai_metadata m on m.track_id = u.tid
    order by u.ord
  loop
    c_md := r.md;
    if has_prev then
      d_bpm := abs(r.bpm - p_bpm); d_en := abs(r.en - p_en); d_br := abs(r.br - p_br); d_vo := abs(r.vo - p_vo);
      v_drop := p_en - r.en;
      pb := least(1, d_bpm/40.0); pe := least(1, d_en/0.40); pbr := least(1, d_br/0.35); pv := least(1, d_vo/0.50);
      pd := least(1, greatest(0, v_drop-0.30)/0.40);
      pm := case when p_md is not null and c_md is not null and p_md <> c_md then 0.6 else 0 end;
      v_sim := (d_bpm < 4 and d_en < 0.05 and d_br < 0.04 and d_vo < 0.06);
      v_pen := pb*22 + pe*24 + pbr*12 + pv*14 + pd*16 + pm*12;
      v_ts := round(100 - least(100, v_pen));
      v_sum := v_sum + v_ts; v_n := v_n + 1; v_cont := v_cont + (d_en*0.6 + d_br*0.4);
      if v_ts < 60 then v_rough := v_rough + 1; v_run := v_run + 1; v_maxrun := greatest(v_maxrun, v_run); else v_run := 0; end if;
      if v_sim then v_repeat := v_repeat + 1; end if;
      if pd >= 0.5 then v_dropc := v_dropc + 1; end if;
      if pm >= 0.5 then v_moodc := v_moodc + 1; end if;
    end if;
    p_bpm := r.bpm; p_en := r.en; p_br := r.br; p_vo := r.vo; p_md := c_md; has_prev := true;
  end loop;
  if v_n = 0 then return jsonb_build_object('flow_score', null, 'n_transitions', 0); end if;
  v_avg := v_sum/v_n; v_fat := least(15, greatest(0, v_maxrun-1)*5); v_mono := least(15, (v_repeat::numeric/v_n)*30);
  v_emc := round(100 - least(100, (v_cont/v_n)/0.40*100));
  v_flow := greatest(0, least(100, round(v_avg - v_fat - v_mono)));
  return jsonb_build_object('flow_score', v_flow, 'n_transitions', v_n, 'avg_transition', round(v_avg,1),
    'rough_transitions', v_rough, 'repetitive_count', v_repeat, 'drop_shock_count', v_dropc, 'mood_collision_count', v_moodc,
    'fatigue_index', round(v_fat)::int, 'monotony_index', round(v_mono)::int, 'emotional_continuity', v_emc);
end; $$;

-- 재배치 제안 생성 (greedy nearest-neighbor, 다중 seed) — 적용하지 않음, pending 저장
create or replace function public.admin_generate_playlist_reorder(p_playlist_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid uuid := auth.uid();
  ids uuid[]; bpm numeric[]; en numeric[]; br numeric[]; vo numeric[]; md text[];
  n int; seed int; step int; j int; cur int;
  visited boolean[]; perm int[]; total numeric; bestc numeric; bestj int;
  best_total numeric; best_perm int[];
  d_bpm numeric; d_en numeric; d_br numeric; d_vo numeric; v_drop numeric;
  pb numeric; pe numeric; pbr numeric; pv numeric; pd numeric; pm numeric; v_sim boolean; c numeric;
  proposed uuid[]; k int; v_seed_cap int;
  m_before jsonb; m_after jsonb; v_cs int; v_ps int; v_title text; v_pid uuid;
begin
  if not exists (select 1 from public.users u where u.id=v_uid and u.role='admin') then raise exception 'admin only'; end if;
  select title into v_title from public.playlists where id = p_playlist_id;
  select array_agg(s.tid order by s.rn), array_agg(s.bpm order by s.rn), array_agg(s.en order by s.rn),
         array_agg(s.br order by s.rn), array_agg(s.vo order by s.rn), array_agg(s.md order by s.rn)
  into ids, bpm, en, br, vo, md
  from (
    select pt.track_id tid, row_number() over (order by pt.order_index, pt.created_at) rn,
      coalesce(f.bpm,100) bpm, coalesce(f.energy,0.5) en, coalesce(f.brightness,0.3) br,
      coalesce(f.vocal_presence,0.4) vo, (m.ai_moods)[1] md
    from public.playlist_tracks pt
    left join public.track_audio_features f on f.track_id = pt.track_id and f.status='done'
    left join public.track_ai_metadata m on m.track_id = pt.track_id
    where pt.playlist_id = p_playlist_id
  ) s;
  n := coalesce(array_length(ids,1), 0);
  if n < 3 then
    return jsonb_build_object('ok', false, 'playlist_id', p_playlist_id, 'title', v_title, 'note', '곡 3개 미만 — 재배치 제안 불필요');
  end if;

  best_total := null; best_perm := null;
  v_seed_cap := least(n, 42);
  for seed in 1..v_seed_cap loop
    visited := array_fill(false, ARRAY[n]); perm := array[seed]; visited[seed] := true; cur := seed; total := 0;
    for step in 2..n loop
      bestc := null; bestj := null;
      for j in 1..n loop
        if not visited[j] then
          d_bpm := abs(bpm[j]-bpm[cur]); d_en := abs(en[j]-en[cur]); d_br := abs(br[j]-br[cur]); d_vo := abs(vo[j]-vo[cur]);
          v_drop := en[cur]-en[j];
          pb := least(1,d_bpm/40.0); pe := least(1,d_en/0.40); pbr := least(1,d_br/0.35); pv := least(1,d_vo/0.50);
          pd := least(1, greatest(0, v_drop-0.30)/0.40);
          pm := case when md[cur] is not null and md[j] is not null and md[cur] <> md[j] then 0.6 else 0 end;
          v_sim := (d_bpm < 4 and d_en < 0.05 and d_br < 0.04 and d_vo < 0.06);
          c := pb*22 + pe*24 + pbr*12 + pv*14 + pd*16 + pm*12 + case when v_sim then 25 else 0 end;
          if bestc is null or c < bestc then bestc := c; bestj := j; end if;
        end if;
      end loop;
      visited[bestj] := true; perm := perm || bestj; total := total + bestc; cur := bestj;
    end loop;
    if best_total is null or total < best_total then best_total := total; best_perm := perm; end if;
  end loop;

  proposed := array[]::uuid[];
  for k in 1..n loop proposed := proposed || ids[best_perm[k]]; end loop;

  m_before := public._flow_score_of_order(ids);
  m_after := public._flow_score_of_order(proposed);
  v_cs := nullif(m_before->>'flow_score','')::int;
  v_ps := nullif(m_after->>'flow_score','')::int;

  delete from public.playlist_reorder_proposals where playlist_id = p_playlist_id and status = 'pending';
  insert into public.playlist_reorder_proposals(playlist_id, status, current_order, proposed_order,
    current_score, proposed_score, improvement, metrics_before, metrics_after, created_by)
  values (p_playlist_id, 'pending', ids, proposed, v_cs, v_ps, coalesce(v_ps,0)-coalesce(v_cs,0), m_before, m_after, v_uid)
  returning playlist_id into v_pid;

  return jsonb_build_object('ok', true, 'playlist_id', p_playlist_id, 'title', v_title,
    'current_score', v_cs, 'proposed_score', v_ps, 'improvement', coalesce(v_ps,0)-coalesce(v_cs,0),
    'n_tracks', n, 'changed', (ids <> proposed), 'metrics_before', m_before, 'metrics_after', m_after);
end; $$;
grant execute on function public.admin_generate_playlist_reorder(uuid) to authenticated;

-- 전체(곡 보유) 플레이리스트 제안 일괄 생성
create or replace function public.admin_generate_all_reorders()
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare r record; v_n int := 0; v_imp int := 0;
begin
  if not exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin') then raise exception 'admin only'; end if;
  for r in select distinct playlist_id from public.playlist_tracks loop
    if (public.admin_generate_playlist_reorder(r.playlist_id)->>'ok')::boolean then v_n := v_n + 1; end if;
  end loop;
  select count(*) into v_imp from public.playlist_reorder_proposals where status='pending' and coalesce(improvement,0) > 0;
  return jsonb_build_object('ok', true, 'proposals', v_n, 'with_improvement', v_imp);
end; $$;
grant execute on function public.admin_generate_all_reorders() to authenticated;

-- 제안 목록 (개선폭 큰 순)
create or replace function public.admin_list_reorder_proposals()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v jsonb;
begin
  if not exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin') then raise exception 'admin only'; end if;
  select coalesce(jsonb_agg(row_to_json(x) order by x.improvement desc nulls last), '[]'::jsonb) into v from (
    select pr.id, pr.playlist_id, p.title, pr.status, pr.current_score, pr.proposed_score, pr.improvement,
      array_length(pr.proposed_order,1) as n_tracks, pr.created_at,
      pr.metrics_before, pr.metrics_after
    from public.playlist_reorder_proposals pr join public.playlists p on p.id = pr.playlist_id
    where pr.status = 'pending') x;
  return v;
end; $$;
grant execute on function public.admin_list_reorder_proposals() to authenticated;

-- 제안 상세 (현재/제안 순서 + 곡 제목)
create or replace function public.admin_get_reorder_proposal(p_playlist_id uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare pr record; v_cur jsonb; v_prop jsonb; v_title text;
begin
  if not exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin') then raise exception 'admin only'; end if;
  select * into pr from public.playlist_reorder_proposals where playlist_id = p_playlist_id order by created_at desc limit 1;
  if pr.id is null then return jsonb_build_object('ok', false, 'note', '제안 없음'); end if;
  select title into v_title from public.playlists where id = p_playlist_id;
  select jsonb_agg(jsonb_build_object('position', ord, 'track_id', tid, 'title', t.title) order by ord) into v_cur
    from unnest(pr.current_order) with ordinality as u(tid, ord) left join public.tracks t on t.id = u.tid;
  select jsonb_agg(jsonb_build_object('position', ord, 'track_id', tid, 'title', t.title,
      'moved', (pr.current_order[ord] is distinct from tid)) order by ord) into v_prop
    from unnest(pr.proposed_order) with ordinality as u(tid, ord) left join public.tracks t on t.id = u.tid;
  return jsonb_build_object('ok', true, 'proposal_id', pr.id, 'playlist_id', p_playlist_id, 'title', v_title,
    'status', pr.status, 'current_score', pr.current_score, 'proposed_score', pr.proposed_score, 'improvement', pr.improvement,
    'metrics_before', pr.metrics_before, 'metrics_after', pr.metrics_after,
    'current_list', coalesce(v_cur,'[]'::jsonb), 'proposed_list', coalesce(v_prop,'[]'::jsonb));
end; $$;
grant execute on function public.admin_get_reorder_proposal(uuid) to authenticated;

-- 승인 적용 (관리자 명시 호출 시에만 order_index 반영). 행 추가/삭제 없음.
create or replace function public.admin_apply_playlist_reorder(p_proposal_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid(); pr record; v_n int;
begin
  if not exists (select 1 from public.users u where u.id=v_uid and u.role='admin') then raise exception 'admin only'; end if;
  select * into pr from public.playlist_reorder_proposals where id = p_proposal_id;
  if pr.id is null then raise exception 'proposal not found'; end if;
  if pr.status <> 'pending' then raise exception '이미 처리된 제안입니다 (%).', pr.status; end if;
  -- 안전장치: 제안의 곡 집합이 현재 playlist_tracks 와 정확히 일치해야 적용 (그 사이 곡 추가/삭제 시 거부)
  if exists (select unnest(pr.proposed_order) except select track_id from public.playlist_tracks where playlist_id = pr.playlist_id)
     or exists (select track_id from public.playlist_tracks where playlist_id = pr.playlist_id except select unnest(pr.proposed_order)) then
    raise exception '플레이리스트 구성이 변경되어 제안을 적용할 수 없습니다. 다시 생성하세요.';
  end if;
  update public.playlist_tracks pt set order_index = m.ord
  from (select tid, ord from unnest(pr.proposed_order) with ordinality as u(tid, ord)) m
  where pt.playlist_id = pr.playlist_id and pt.track_id = m.tid;
  get diagnostics v_n = row_count;
  update public.playlist_reorder_proposals set status='applied', applied_by=v_uid, applied_at=now() where id = p_proposal_id;
  perform public.admin_compute_playlist_flow(pr.playlist_id);
  return jsonb_build_object('ok', true, 'playlist_id', pr.playlist_id, 'reordered', v_n);
end; $$;
grant execute on function public.admin_apply_playlist_reorder(uuid) to authenticated;

create or replace function public.admin_reject_playlist_reorder(p_proposal_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid();
begin
  if not exists (select 1 from public.users u where u.id=v_uid and u.role='admin') then raise exception 'admin only'; end if;
  update public.playlist_reorder_proposals set status='rejected', rejected_at=now() where id = p_proposal_id and status='pending';
  return jsonb_build_object('ok', true);
end; $$;
grant execute on function public.admin_reject_playlist_reorder(uuid) to authenticated;
