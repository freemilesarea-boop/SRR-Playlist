-- 0258 — Phase X5.0 Genre Guardrail Engine
--
-- 목표: 장르 × 매장 기반 fit_score hard filter + soft penalty + bonus.
--       admin_store_exclusion (X3) 가 트랙 단위 차단이라면, X5 는 장르 패턴 단위 차단.
--
-- 정책:
--   - hard_block: fit_score=0 강제 (admin override 외 우회 불가)
--   - soft_penalty: fit_score 감산 (음수 delta)
--   - bonus: fit_score 가산 (양수 delta)
--   - 모든 매칭 reason_codes 기록 (genre_hard_block / genre_soft_penalty / genre_store_bonus)
--
-- 매칭:
--   genre_pattern ILIKE substring match against tracks.main_genre + sub_genre + genre_tags[]

-- ===== A. genre_store_guardrails =====
create table if not exists public.genre_store_guardrails (
  id            uuid primary key default gen_random_uuid(),
  genre_pattern text not null,
  store_slug    text not null,
  rule_type     text not null check (rule_type in ('hard_block','soft_penalty','bonus')),
  score_delta   numeric not null default 0,
  description   text,
  is_active     boolean not null default true,
  created_by    uuid references public.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create unique index if not exists uq_gsg_pattern_store_type
  on public.genre_store_guardrails(lower(genre_pattern), store_slug, rule_type);
create index if not exists ix_gsg_active
  on public.genre_store_guardrails(store_slug, rule_type) where is_active;

alter table public.genre_store_guardrails enable row level security;
drop policy if exists "gsg admin all" on public.genre_store_guardrails;
create policy "gsg admin all" on public.genre_store_guardrails for all to authenticated
  using (exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin'))
  with check (exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin'));

-- ===== B. Seed (사용자 spec) =====

-- HARD BLOCK: 7 genres × 4 stores = 28 rows
insert into public.genre_store_guardrails(genre_pattern, store_slug, rule_type, score_delta, description)
select g, s, 'hard_block', 0, format('%s 트랙은 %s 절대 배치 금지', g, s)
from (values ('Anime'),('Metal'),('Punk'),('Hard Rock'),('Hardstyle'),('Dubstep'),('Phonk')) AS gg(g),
     (values ('winebar'),('hotel'),('hospital'),('lounge')) AS ss(s)
on conflict (lower(genre_pattern), store_slug, rule_type) do nothing;

-- SOFT PENALTY: 4 genres × 2 stores = 8 rows
insert into public.genre_store_guardrails(genre_pattern, store_slug, rule_type, score_delta, description)
select g, s, 'soft_penalty', -20, format('%s 트랙은 %s 에서 fit -20 (Lounge 분위기 부적합)', g, s)
from (values ('JPOP'),('KPOP'),('Rock'),('HipHop')) AS gg(g),
     (values ('winebar'),('hotel')) AS ss(s)
on conflict (lower(genre_pattern), store_slug, rule_type) do nothing;

-- BONUS: 5 genres × winebar = 5 rows
insert into public.genre_store_guardrails(genre_pattern, store_slug, rule_type, score_delta, description)
select g, 'winebar', 'bonus', 10, format('%s 트랙은 와인바에서 fit +10', g)
from (values ('Jazz'),('Bossa Nova'),('Lounge'),('Ambient'),('Piano')) AS gg(g)
on conflict (lower(genre_pattern), store_slug, rule_type) do nothing;

-- ===== C. _check_genre_guardrail (track × store) =====
-- 반환: { hard_block, hard_block_patterns, soft_penalty_delta, soft_penalty_patterns, bonus_delta, bonus_patterns }
create or replace function public._check_genre_guardrail(p_track_id uuid, p_store_slug text)
returns jsonb
language sql
stable
parallel safe
as $$
  with t as (
    select coalesce(main_genre,'') as mg, coalesce(sub_genre,'') as sg,
           coalesce(genre_tags, '{}'::text[]) as gt
    from public.tracks where id = p_track_id
  ),
  matched as (
    select g.rule_type, g.genre_pattern, g.score_delta
    from public.genre_store_guardrails g, t
    where g.is_active and g.store_slug = p_store_slug
      and (
        lower(t.mg) like '%' || lower(g.genre_pattern) || '%'
        or lower(t.sg) like '%' || lower(g.genre_pattern) || '%'
        or exists (
          select 1 from unnest(t.gt) tag
          where lower(tag) like '%' || lower(g.genre_pattern) || '%'
        )
      )
  )
  select jsonb_build_object(
    'hard_block', exists (select 1 from matched where rule_type='hard_block'),
    'hard_block_patterns', coalesce(
      (select array_agg(distinct genre_pattern) from matched where rule_type='hard_block'),
      '{}'::text[]),
    'soft_penalty_delta', coalesce(
      (select sum(score_delta) from matched where rule_type='soft_penalty'), 0),
    'soft_penalty_patterns', coalesce(
      (select array_agg(distinct genre_pattern) from matched where rule_type='soft_penalty'),
      '{}'::text[]),
    'bonus_delta', coalesce(
      (select sum(score_delta) from matched where rule_type='bonus'), 0),
    'bonus_patterns', coalesce(
      (select array_agg(distinct genre_pattern) from matched where rule_type='bonus'),
      '{}'::text[])
  );
$$;

-- ===== D. _ai_compute_fit v4 (X5.0) — genre guardrail 통합 =====
-- 변경 요약:
--   1. v_normalized_slug 계산을 위쪽으로 이동
--   2. exclusion check 직후 genre_hard_block check 추가 (matched 시 early return fit=0)
--   3. score 계산 후 soft_penalty / bonus delta 적용
--   4. reason_codes 에 genre_hard_block / genre_soft_penalty / genre_store_bonus 추가
create or replace function public._ai_compute_fit(p_playlist_id uuid, p_track_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  pl record; ai record; t record; cfg record; gr jsonb; pred record;
  v_key text; v_audio numeric; v_meta numeric; v_behav numeric; v_pen numeric;
  v_manual numeric; v_fit numeric;
  v_status text; v_reason text; v_excluded boolean := false; v_gpen numeric := 0;
  v_normalized_slug text;
  v_ai_genre int := 0; v_ai_mood int := 0; v_ai_store int := 0; v_ai_boost int := 0;
  v_mood_overlap int := 0;
  v_reason_codes text[] := '{}';
  -- X5.0
  v_guardrail jsonb;
  v_gr_soft numeric := 0;
  v_gr_bonus numeric := 0;
  v_gr_hard_patterns text[];
begin
  select * into cfg from public.ai_scoring_config where id=1;
  select id, business_category, category, daypart, genre_tags, mood_tags, situation_tags, ai_store_key
    into pl from public.playlists where id=p_playlist_id;
  if pl.id is null then return; end if;

  -- X5.0: store slug 미리 계산
  v_normalized_slug := public.normalize_store_label(pl.business_category);

  -- X3 hard block: admin_store_exclusion
  if public._track_is_excluded_from_playlist(p_track_id, p_playlist_id) then
    insert into public.playlist_track_fit_scores(
      playlist_id, track_id, fit_score, audio_score, metadata_score, behavior_score, penalty_score,
      reason, source, status, updated_at,
      manual_score, ai_store_score, ai_mood_score, ai_genre_score, ai_boost_total,
      normalized_store_slug, reason_codes
    ) values (
      p_playlist_id, p_track_id, 0, 0, 0, 0, 0,
      '[admin_store_exclusion] 관리자가 이 매장에서 이 트랙을 제외함',
      'algorithm', 'excluded', now(),
      0, 0, 0, 0, 0,
      v_normalized_slug,
      array['admin_store_exclusion']
    )
    on conflict (playlist_id, track_id) do update set
      fit_score = 0, audio_score = 0, metadata_score = 0, behavior_score = 0, penalty_score = 0,
      reason = '[admin_store_exclusion] 관리자가 이 매장에서 이 트랙을 제외함',
      status = case when public.playlist_track_fit_scores.source = 'admin'
                    then public.playlist_track_fit_scores.status else 'excluded' end,
      updated_at = now(),
      manual_score = 0, ai_store_score = 0, ai_mood_score = 0,
      ai_genre_score = 0, ai_boost_total = 0,
      reason_codes = array['admin_store_exclusion'];
    return;
  end if;

  -- 🆕 X5.0: genre guardrail hard_block check
  if v_normalized_slug is not null then
    v_guardrail := public._check_genre_guardrail(p_track_id, v_normalized_slug);
    if (v_guardrail->>'hard_block')::boolean then
      v_gr_hard_patterns := coalesce(
        (select array_agg(x) from jsonb_array_elements_text(v_guardrail->'hard_block_patterns') x),
        '{}'::text[]);
      insert into public.playlist_track_fit_scores(
        playlist_id, track_id, fit_score, audio_score, metadata_score, behavior_score, penalty_score,
        reason, source, status, updated_at,
        manual_score, ai_store_score, ai_mood_score, ai_genre_score, ai_boost_total,
        normalized_store_slug, reason_codes
      ) values (
        p_playlist_id, p_track_id, 0, 0, 0, 0, 0,
        format('[genre_hard_block] %s 트랙은 %s 매장 배치 금지 (matched: %s)',
               'X5', v_normalized_slug, array_to_string(v_gr_hard_patterns, ',')),
        'algorithm', 'excluded', now(),
        0, 0, 0, 0, 0,
        v_normalized_slug,
        array_append(array['genre_hard_block'],
          'matched:' || array_to_string(v_gr_hard_patterns, '|'))
      )
      on conflict (playlist_id, track_id) do update set
        fit_score = 0, audio_score = 0, metadata_score = 0, behavior_score = 0, penalty_score = 0,
        reason = format('[genre_hard_block] %s 매장 배치 금지 (matched: %s)',
                        v_normalized_slug, array_to_string(v_gr_hard_patterns, ',')),
        status = case when public.playlist_track_fit_scores.source = 'admin'
                      then public.playlist_track_fit_scores.status else 'excluded' end,
        updated_at = now(),
        manual_score = 0, ai_store_score = 0, ai_mood_score = 0,
        ai_genre_score = 0, ai_boost_total = 0,
        reason_codes = array_append(array['genre_hard_block'],
          'matched:' || array_to_string(v_gr_hard_patterns, '|'));
      return;
    end if;
    v_gr_soft := coalesce((v_guardrail->>'soft_penalty_delta')::numeric, 0);
    v_gr_bonus := coalesce((v_guardrail->>'bonus_delta')::numeric, 0);
  end if;

  select * into ai from public.track_ai_metadata where track_id=p_track_id;
  select genre_tags, mood_tags, audio_health_status into t from public.tracks where id=p_track_id;

  v_key := coalesce(nullif(btrim(pl.ai_store_key),''),
                    public._ai_playlist_store_key(pl.business_category, pl.category, pl.daypart));

  if ai.track_id is not null and v_key is not null and ai.ai_store_fit ? v_key then
    v_audio := (ai.ai_store_fit->>v_key)::numeric; else v_audio := 50; end if;
  v_meta := 50 + public._ai_overlap(pl.genre_tags, t.genre_tags)*8
              + public._ai_overlap(pl.mood_tags, t.mood_tags)*8
    + (case when ai.track_id is not null then public._ai_overlap(pl.situation_tags, ai.ai_situations)*6 else 0 end)
    - (case when ai.track_id is not null then coalesce(ai.mismatch_score,0)*30 else 0 end);
  v_meta := least(100, greatest(0, v_meta));
  v_behav := public._ai_behavior_score(p_playlist_id, p_track_id);
  v_pen := (case when ai.track_id is not null then coalesce(ai.mismatch_score,0)*40 else 0 end)
    + (case when t.audio_health_status='conversion_failed' then 50 else 0 end)
    + least(30, coalesce((select count(*) from public.playlist_track_skip_events e
         where e.playlist_id=p_playlist_id and e.track_id=p_track_id
           and e.created_at>now()-interval '30 days' and e.played_seconds>=5),0)*5);
  v_pen := least(100, greatest(0, v_pen));
  v_manual := least(100, greatest(0, v_audio*cfg.fit_audio_w + v_meta*cfg.fit_meta_w
                                    + v_behav*cfg.fit_behavior_w - v_pen*cfg.fit_penalty_w));

  select * into pred from public.track_ai_predictions
    where track_id=p_track_id and model_version='taxonomy-v1';

  if pred.predicted_main_genre is not null
     and exists(select 1 from unnest(pl.genre_tags) g where lower(g)=lower(pred.predicted_main_genre)) then
    v_ai_genre := 5;
    v_reason_codes := array_append(v_reason_codes, 'ai_genre_match');
  end if;
  if pred.predicted_moods is not null then
    select count(*) into v_mood_overlap from unnest(pred.predicted_moods) pm
    join public.taxonomy_moods tm on tm.slug=pm
    where tm.name_ko = any(coalesce(pl.mood_tags,'{}'::text[]));
    v_ai_mood := least(v_mood_overlap*3, 9);
    if v_mood_overlap > 0 then
      v_reason_codes := array_append(v_reason_codes, 'ai_mood_overlap_' || v_mood_overlap::text);
    end if;
  end if;
  if pred.predicted_store_types is not null and v_normalized_slug is not null then
    if array_length(pred.predicted_store_types, 1) >= 1
       and pred.predicted_store_types[1] = v_normalized_slug then
      v_ai_store := v_ai_store + 20;
      v_reason_codes := array_append(v_reason_codes, 'ai_store_top1_match');
    elsif array_length(pred.predicted_store_types, 1) >= 2
          and pred.predicted_store_types[2] = v_normalized_slug then
      v_ai_store := v_ai_store + 10;
      v_reason_codes := array_append(v_reason_codes, 'ai_store_top2_match');
    elsif array_length(pred.predicted_store_types, 1) >= 3
          and pred.predicted_store_types[3] = v_normalized_slug then
      v_ai_store := v_ai_store + 10;
      v_reason_codes := array_append(v_reason_codes, 'ai_store_top3_match');
    end if;
    if pred.prediction_scores ? 'store_type'
       and (pred.prediction_scores->'store_type' ? v_normalized_slug) then
      v_ai_store := v_ai_store + least(10, round(
        (pred.prediction_scores->'store_type'->>v_normalized_slug)::numeric * 30
      )::int);
      v_reason_codes := array_append(v_reason_codes, 'ai_store_prob_boost');
    end if;
  end if;

  v_ai_boost := v_ai_genre + v_ai_mood + v_ai_store;

  -- 🆕 X5.0: genre guardrail soft_penalty / bonus 반영
  v_fit := least(100, greatest(0, v_manual + v_ai_boost + v_gr_soft + v_gr_bonus));
  if v_gr_soft < 0 then
    v_reason_codes := array_append(v_reason_codes, 'genre_soft_penalty_' || abs(v_gr_soft)::text);
  end if;
  if v_gr_bonus > 0 then
    v_reason_codes := array_append(v_reason_codes, 'genre_store_bonus_' || v_gr_bonus::text);
  end if;

  if v_key is not null then
    gr := public._ai_check_store_guardrails(p_track_id, v_key);
    if (gr->>'blocked')::boolean then
      v_fit := 0; v_excluded := true;
      v_reason := '[guardrail hard_block] ' || coalesce((select string_agg(e->>'reason',', ') from jsonb_array_elements(gr->'violations') e), '');
      v_reason_codes := array_append(v_reason_codes, 'guardrail_blocked');
    else
      v_gpen := coalesce((gr->>'penalty_score')::numeric, 0);
      if v_gpen > 0 then
        v_fit := greatest(0, v_fit - v_gpen);
        v_reason_codes := array_append(v_reason_codes, 'guardrail_penalty_' || round(v_gpen)::text);
      end if;
    end if;
  end if;
  if ai.track_id is not null and v_key is not null and ai.ai_exclusions @> array[v_key] then
    v_excluded := true;
    v_reason_codes := array_append(v_reason_codes, 'ai_excluded');
  end if;

  if v_status is null then
    v_status := case when v_excluded then 'excluded'
                     when v_fit < cfg.fit_exclude_cutoff then 'review_needed'
                     else 'active' end;
  end if;
  if v_reason is null then
    v_reason := format('audio %s · meta %s · behavior %s · penalty %s · manual %s · ai_boost +%s (g%s/m%s/s%s) · gr_soft %s · gr_bonus %s%s%s',
      round(v_audio), round(v_meta), round(v_behav), round(v_pen),
      round(v_manual), v_ai_boost, v_ai_genre, v_ai_mood, v_ai_store,
      v_gr_soft, v_gr_bonus,
      case when v_key is not null then ' · store='||v_key else '' end,
      case when v_gpen>0 then ' · guardrail -'||round(v_gpen) else '' end);
  end if;

  insert into public.playlist_track_fit_scores(
    playlist_id, track_id, fit_score, audio_score, metadata_score, behavior_score, penalty_score,
    reason, source, status, updated_at,
    manual_score, ai_store_score, ai_mood_score, ai_genre_score, ai_boost_total,
    normalized_store_slug, reason_codes
  )
  values (p_playlist_id, p_track_id, round(v_fit),
          round(v_audio), round(v_meta), round(v_behav), round(v_pen),
          v_reason, 'algorithm', v_status, now(),
          round(v_manual), v_ai_store, v_ai_mood, v_ai_genre, v_ai_boost,
          v_normalized_slug, v_reason_codes)
  on conflict (playlist_id, track_id) do update set
    fit_score=excluded.fit_score, audio_score=excluded.audio_score, metadata_score=excluded.metadata_score,
    behavior_score=excluded.behavior_score, penalty_score=excluded.penalty_score, reason=excluded.reason,
    status=case when public.playlist_track_fit_scores.source='admin'
                then public.playlist_track_fit_scores.status else excluded.status end,
    updated_at=now(),
    manual_score=excluded.manual_score, ai_store_score=excluded.ai_store_score,
    ai_mood_score=excluded.ai_mood_score, ai_genre_score=excluded.ai_genre_score,
    ai_boost_total=excluded.ai_boost_total,
    normalized_store_slug=excluded.normalized_store_slug,
    reason_codes=excluded.reason_codes;
end; $$;

-- ===== E. Admin RPCs =====

create or replace function public.admin_list_genre_guardrails(p_store_slug text default null)
returns table (
  id uuid, genre_pattern text, store_slug text, rule_type text,
  score_delta numeric, description text, is_active boolean,
  created_by_name text, created_at timestamptz, updated_at timestamptz
)
language sql security definer set search_path = public stable as $$
  select g.id, g.genre_pattern, g.store_slug, g.rule_type,
         g.score_delta, g.description, g.is_active,
         (select u.full_name from public.users u where u.id = g.created_by),
         g.created_at, g.updated_at
  from public.genre_store_guardrails g
  where (p_store_slug is null or g.store_slug = p_store_slug)
  order by g.store_slug,
    case g.rule_type when 'hard_block' then 0 when 'soft_penalty' then 1 else 2 end,
    g.genre_pattern;
$$;

create or replace function public.admin_upsert_genre_guardrail(
  p_id uuid default null,
  p_genre_pattern text default null,
  p_store_slug text default null,
  p_rule_type text default null,
  p_score_delta numeric default null,
  p_description text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_admin uuid := auth.uid();
  v_id uuid;
begin
  if not exists (select 1 from public.users u where u.id=v_admin and u.role='admin') then
    raise exception 'unauthorized';
  end if;
  if p_id is not null then
    update public.genre_store_guardrails
      set genre_pattern = coalesce(p_genre_pattern, genre_pattern),
          store_slug = coalesce(p_store_slug, store_slug),
          rule_type = coalesce(p_rule_type, rule_type),
          score_delta = coalesce(p_score_delta, score_delta),
          description = coalesce(p_description, description),
          updated_at = now()
      where id = p_id
      returning id into v_id;
    if v_id is null then raise exception 'guardrail not found: %', p_id; end if;
  else
    if p_genre_pattern is null or p_store_slug is null or p_rule_type is null then
      raise exception 'genre_pattern, store_slug, rule_type required for insert';
    end if;
    insert into public.genre_store_guardrails(
      genre_pattern, store_slug, rule_type, score_delta, description, created_by
    ) values (
      p_genre_pattern, p_store_slug, p_rule_type, coalesce(p_score_delta, 0),
      p_description, v_admin
    )
    on conflict (lower(genre_pattern), store_slug, rule_type) do update set
      score_delta = coalesce(excluded.score_delta, public.genre_store_guardrails.score_delta),
      description = coalesce(excluded.description, public.genre_store_guardrails.description),
      is_active = true,
      updated_at = now()
    returning id into v_id;
  end if;
  return v_id;
end; $$;

create or replace function public.admin_toggle_genre_guardrail(p_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_admin uuid := auth.uid(); v_active boolean;
begin
  if not exists (select 1 from public.users u where u.id=v_admin and u.role='admin') then
    raise exception 'unauthorized';
  end if;
  update public.genre_store_guardrails
    set is_active = not is_active, updated_at = now()
    where id = p_id
    returning is_active into v_active;
  if v_active is null then raise exception 'guardrail not found: %', p_id; end if;
  return v_active;
end; $$;

create or replace function public.admin_delete_genre_guardrail(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_admin uuid := auth.uid();
begin
  if not exists (select 1 from public.users u where u.id=v_admin and u.role='admin') then
    raise exception 'unauthorized';
  end if;
  delete from public.genre_store_guardrails where id = p_id;
end; $$;

create or replace function public.admin_genre_guardrail_summary()
returns jsonb language sql security definer set search_path = public stable as $$
  select jsonb_build_object(
    'total', (select count(*) from public.genre_store_guardrails),
    'active', (select count(*) from public.genre_store_guardrails where is_active),
    'by_rule_type', (
      select jsonb_object_agg(rule_type, cnt) from (
        select rule_type, count(*) as cnt
        from public.genre_store_guardrails where is_active
        group by rule_type
      ) s
    ),
    'by_store', (
      select jsonb_object_agg(store_slug, cnt) from (
        select store_slug, count(*) as cnt
        from public.genre_store_guardrails where is_active
        group by store_slug
      ) s
    )
  );
$$;

-- ===== F. 권한 =====
revoke all on function public._check_genre_guardrail(uuid, text) from public, anon;
revoke all on function public.admin_list_genre_guardrails(text) from public, anon;
revoke all on function public.admin_upsert_genre_guardrail(uuid, text, text, text, numeric, text) from public, anon;
revoke all on function public.admin_toggle_genre_guardrail(uuid) from public, anon;
revoke all on function public.admin_delete_genre_guardrail(uuid) from public, anon;
revoke all on function public.admin_genre_guardrail_summary() from public, anon;

grant execute on function public._check_genre_guardrail(uuid, text) to authenticated, service_role;
grant execute on function public.admin_list_genre_guardrails(text) to authenticated, service_role;
grant execute on function public.admin_upsert_genre_guardrail(uuid, text, text, text, numeric, text) to authenticated, service_role;
grant execute on function public.admin_toggle_genre_guardrail(uuid) to authenticated, service_role;
grant execute on function public.admin_delete_genre_guardrail(uuid) to authenticated, service_role;
grant execute on function public.admin_genre_guardrail_summary() to authenticated, service_role;
