-- 0174 — Guardrail 위반 대시보드/일괄처리 + 업로더 metadata trust score. additive.
-- 추천/정산 미변경. trust score 는 운영 지표(추천/정산 직접 반영 안 함).
create table if not exists public.track_guardrail_flags (
  track_id uuid not null references public.tracks(id) on delete cascade,
  owner_user_id uuid, store_key text not null, severity text not null,
  violated_rules text[] not null default '{}', created_at timestamptz not null default now(),
  primary key (track_id, store_key)
);
create index if not exists idx_tgf_store on public.track_guardrail_flags(store_key, severity);
create index if not exists idx_tgf_owner on public.track_guardrail_flags(owner_user_id);
alter table public.track_guardrail_flags enable row level security;
drop policy if exists tgf_admin_read on public.track_guardrail_flags;
create policy tgf_admin_read on public.track_guardrail_flags for select using (exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin'));

alter table public.artist_profiles add column if not exists metadata_trust_score numeric default 100;

create or replace function public.admin_recompute_guardrail_flags()
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare tr record; sk record; gr jsonb; v_n int := 0;
begin
  if not exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin') then raise exception 'admin only'; end if;
  delete from public.track_guardrail_flags;
  for tr in select id, owner_user_id from public.tracks
    where source_type in ('artist_upload','admin_upload') and removed_at is null and release_status in ('released','approved','scheduled') loop
    for sk in select distinct store_key from public.store_guardrails where enabled loop
      gr := public._ai_check_store_guardrails(tr.id, sk.store_key);
      if (gr->'violations') <> '[]'::jsonb then
        insert into public.track_guardrail_flags(track_id, owner_user_id, store_key, severity, violated_rules)
        values (tr.id, tr.owner_user_id, sk.store_key, gr->>'severity',
          (select array_agg(e->>'rule_key') from jsonb_array_elements(gr->'violations') e))
        on conflict (track_id, store_key) do update set severity=excluded.severity, violated_rules=excluded.violated_rules, created_at=now();
        v_n := v_n + 1;
      end if;
    end loop;
  end loop;
  return jsonb_build_object('ok', true, 'flags', v_n);
end; $$;
grant execute on function public.admin_recompute_guardrail_flags() to authenticated;

create or replace function public.admin_guardrail_dashboard()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v jsonb;
begin
  if not exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin') then raise exception 'admin only'; end if;
  select jsonb_build_object(
    'total_violating_tracks', (select count(distinct track_id) from public.track_guardrail_flags),
    'hard_block_tracks', (select count(distinct track_id) from public.track_guardrail_flags where severity='hard_block'),
    'by_severity', (select coalesce(jsonb_object_agg(severity, c),'{}'::jsonb) from (select severity, count(*) c from public.track_guardrail_flags group by severity) s),
    'by_store', (select coalesce(jsonb_agg(row_to_json(a) order by a.hard_count desc, a.total desc),'[]'::jsonb) from (
        select store_key, count(*) total, count(*) filter (where severity='hard_block') hard_count from public.track_guardrail_flags group by store_key) a),
    'top_rules', (select coalesce(jsonb_agg(row_to_json(b) order by b.cnt desc),'[]'::jsonb) from (
        select rule_key, count(*) cnt from public.track_guardrail_flags, unnest(violated_rules) rule_key group by rule_key order by cnt desc limit 10) b),
    'uploaders', (select coalesce(jsonb_agg(row_to_json(c) order by c.violation_rate desc nulls last),'[]'::jsonb) from (
        select ap.user_id, ap.artist_name, ap.metadata_trust_score,
          (select count(*) from public.tracks t where t.owner_user_id=ap.user_id and t.removed_at is null and t.release_status in ('released','approved','scheduled')) as total_tracks,
          (select count(distinct f.track_id) from public.track_guardrail_flags f where f.owner_user_id=ap.user_id and f.severity='hard_block') as hard_tracks,
          round(100.0 * (select count(distinct f.track_id) from public.track_guardrail_flags f where f.owner_user_id=ap.user_id and f.severity='hard_block')
            / nullif((select count(*) from public.tracks t where t.owner_user_id=ap.user_id and t.removed_at is null and t.release_status in ('released','approved','scheduled')),0)) as violation_rate
        from public.artist_profiles ap where exists (select 1 from public.track_guardrail_flags f where f.owner_user_id=ap.user_id)) c)
  ) into v;
  return v;
end; $$;
grant execute on function public.admin_guardrail_dashboard() to authenticated;

create or replace function public.admin_list_guardrail_violation_tracks(p_severity text default 'hard_block', p_store_key text default null, p_limit int default 200)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v jsonb;
begin
  if not exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin') then raise exception 'admin only'; end if;
  select coalesce(jsonb_agg(row_to_json(x) order by x.hard_stores desc),'[]'::jsonb) into v from (
    select f.track_id, t.title, t.artist, t.main_genre,
      count(*) filter (where f.severity='hard_block') as hard_stores,
      count(*) filter (where f.severity='soft_block') as soft_stores,
      array_agg(distinct f.store_key) filter (where f.severity='hard_block') as blocked_stores,
      array_agg(distinct rk) as rules
    from public.track_guardrail_flags f join public.tracks t on t.id=f.track_id
    left join lateral unnest(f.violated_rules) rk on true
    where (p_severity='all' or f.severity=p_severity) and (p_store_key is null or f.store_key=p_store_key)
    group by f.track_id, t.title, t.artist, t.main_genre limit greatest(1,p_limit)) x;
  return v;
end; $$;
grant execute on function public.admin_list_guardrail_violation_tracks(text, text, int) to authenticated;

create or replace function public.admin_recompute_metadata_trust()
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_n int := 0;
begin
  if not exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin') then raise exception 'admin only'; end if;
  update public.artist_profiles ap set metadata_trust_score = sub.score from (
    select ap2.user_id, greatest(0, round(100
      - 70.0 * coalesce((select count(distinct f.track_id) from public.track_guardrail_flags f where f.owner_user_id=ap2.user_id and f.severity='hard_block'),0)
            / nullif((select count(*) from public.tracks t where t.owner_user_id=ap2.user_id and t.removed_at is null and t.release_status in ('released','approved','scheduled')),0)
      - 20.0 * coalesce((select count(distinct f.track_id) from public.track_guardrail_flags f where f.owner_user_id=ap2.user_id and f.severity='soft_block'),0)
            / nullif((select count(*) from public.tracks t where t.owner_user_id=ap2.user_id and t.removed_at is null and t.release_status in ('released','approved','scheduled')),0)
    )) as score from public.artist_profiles ap2) sub
  where ap.user_id = sub.user_id and sub.score is not null;
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'updated', v_n);
end; $$;
grant execute on function public.admin_recompute_metadata_trust() to authenticated;

create or replace function public.admin_bulk_guardrail_override(p_track_ids uuid[], p_store_key text, p_reason text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid(); v_n int := 0; tid uuid;
begin
  if not exists (select 1 from public.users u where u.id=v_uid and u.role='admin') then raise exception 'admin only'; end if;
  foreach tid in array p_track_ids loop
    insert into public.store_guardrail_overrides(track_id, store_key, reason, created_by)
    values (tid, p_store_key, coalesce(nullif(btrim(p_reason),''),'일괄 override'), v_uid)
    on conflict (track_id, store_key) do update set reason=excluded.reason, created_by=v_uid, created_at=now();
    delete from public.track_guardrail_flags where track_id=tid and store_key=p_store_key; v_n := v_n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'overridden', v_n);
end; $$;
grant execute on function public.admin_bulk_guardrail_override(uuid[], text, text) to authenticated;

create or replace function public.admin_bulk_guardrail_clear(p_track_ids uuid[], p_reason text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid(); v_n int := 0; tid uuid; sk text;
begin
  if not exists (select 1 from public.users u where u.id=v_uid and u.role='admin') then raise exception 'admin only'; end if;
  foreach tid in array p_track_ids loop
    for sk in select store_key from public.track_guardrail_flags where track_id=tid and severity='hard_block' loop
      insert into public.store_guardrail_overrides(track_id, store_key, reason, created_by)
      values (tid, sk, coalesce(nullif(btrim(p_reason),''),'문제 없음 처리'), v_uid)
      on conflict (track_id, store_key) do update set reason=excluded.reason, created_by=v_uid, created_at=now();
    end loop;
    delete from public.track_guardrail_flags where track_id=tid and severity='hard_block'; v_n := v_n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'cleared', v_n);
end; $$;
grant execute on function public.admin_bulk_guardrail_clear(uuid[], text) to authenticated;
