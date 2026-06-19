-- 0345 — Phase 9: 매장주 행동 데이터 (👍/👎 reaction) 1차 (X6.84)
--
-- 목적:
--   매장용 플레이어에 좋음/별로 버튼 추가 → 매장주 취향 학습 신호 수집.
--   2차 PR (별도) 에서 추천 알고리즘 (behavior_score, store learning,
--   fit_score guardrail) 에 연결 예정. 이 PR 은 데이터 수집만.
--
-- 설계:
--   - store_id = business 플랜 사용자의 user.id (별도 stores 테이블 없음)
--   - business_id = nullable (향후 다점포 운영 시 parent 식별자)
--   - unique(store_id, track_id) — 같은 매장 같은 곡은 1행, reaction_type 만 변경
--   - RLS: SELECT 는 admin/본인, INSERT/UPDATE 는 RPC 만 (직접 차단)
--   - RPC 가 auth.uid() 자동 캡처

-- =============================================================================
-- 1. store_track_reactions 테이블
-- =============================================================================
create table if not exists public.store_track_reactions (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null,
  business_id uuid,
  track_id uuid not null references public.tracks(id) on delete cascade,
  playlist_id uuid,
  reaction_type text not null check (reaction_type in ('like', 'dislike')),
  source text not null default 'store_player',
  user_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint store_track_reactions_unique unique (store_id, track_id)
);

create index if not exists idx_store_track_reactions_store_id_created_at
  on public.store_track_reactions (store_id, created_at desc);
create index if not exists idx_store_track_reactions_track_id
  on public.store_track_reactions (track_id);
create index if not exists idx_store_track_reactions_reaction_type
  on public.store_track_reactions (reaction_type);
create index if not exists idx_store_track_reactions_store_track
  on public.store_track_reactions (store_id, track_id);

alter table public.store_track_reactions enable row level security;

-- 본인 매장 + admin SELECT
drop policy if exists store_reactions_self_or_admin_read on public.store_track_reactions;
create policy store_reactions_self_or_admin_read on public.store_track_reactions
  for select using (
    store_id = auth.uid()
    or exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin')
  );

-- INSERT/UPDATE/DELETE 는 직접 차단 (RPC 만 허용)
revoke insert, update, delete on public.store_track_reactions from authenticated, anon;


-- =============================================================================
-- 2. upsert_store_track_reaction RPC
--    같은 (store_id, track_id) 이면 reaction_type / updated_at 갱신.
--    auth.uid() 를 user_id 로 자동 캡처.
--    p_reaction_type 유효성 체크.
-- =============================================================================
create or replace function public.upsert_store_track_reaction(
  p_store_id uuid,
  p_track_id uuid,
  p_reaction_type text,
  p_playlist_id uuid default null,
  p_business_id uuid default null
)
returns public.store_track_reactions
language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid uuid := auth.uid();
  v_row public.store_track_reactions;
begin
  if v_uid is null then
    raise exception 'unauthorized: authentication required';
  end if;
  if p_reaction_type not in ('like', 'dislike') then
    raise exception 'invalid reaction_type: % (must be like|dislike)', p_reaction_type;
  end if;
  if not exists (select 1 from public.tracks where id = p_track_id) then
    raise exception 'track not found: %', p_track_id;
  end if;

  insert into public.store_track_reactions
    (store_id, business_id, track_id, playlist_id, reaction_type, source, user_id, updated_at)
  values
    (p_store_id, p_business_id, p_track_id, p_playlist_id,
     p_reaction_type, 'store_player', v_uid, now())
  on conflict (store_id, track_id) do update set
    reaction_type = excluded.reaction_type,
    playlist_id = coalesce(excluded.playlist_id, public.store_track_reactions.playlist_id),
    business_id = coalesce(excluded.business_id, public.store_track_reactions.business_id),
    user_id = excluded.user_id,
    updated_at = now()
  returning * into v_row;

  return v_row;
end; $$;

revoke execute on function public.upsert_store_track_reaction(uuid, uuid, text, uuid, uuid) from public, anon;
grant execute on function public.upsert_store_track_reaction(uuid, uuid, text, uuid, uuid) to authenticated;


-- =============================================================================
-- 3. get_store_track_reaction RPC — 현재 곡 반응 조회 (없으면 null)
-- =============================================================================
create or replace function public.get_store_track_reaction(
  p_store_id uuid,
  p_track_id uuid
)
returns public.store_track_reactions
language sql stable security definer set search_path to 'public' as $$
  select * from public.store_track_reactions
   where store_id = p_store_id and track_id = p_track_id
   limit 1;
$$;
grant execute on function public.get_store_track_reaction(uuid, uuid) to authenticated;


-- =============================================================================
-- 4. View — 매장 × 트랙 요약 (admin 분석용)
-- =============================================================================
create or replace view public.store_track_reaction_summary as
  select track_id,
         store_id,
         count(*) filter (where reaction_type='like') as like_count,
         count(*) filter (where reaction_type='dislike') as dislike_count,
         max(updated_at) as last_reaction_at
    from public.store_track_reactions
   group by track_id, store_id;

-- View — 트랙별 전 매장 집계 (추천 알고리즘 2차 연결용)
create or replace view public.track_reaction_aggregate as
  select track_id,
         count(*) filter (where reaction_type='like') as like_count,
         count(*) filter (where reaction_type='dislike') as dislike_count,
         count(*) as total_reactions,
         round(
           100.0 * count(*) filter (where reaction_type='like') / nullif(count(*), 0),
           1
         ) as like_ratio,
         round(
           100.0 * count(*) filter (where reaction_type='dislike') / nullif(count(*), 0),
           1
         ) as dislike_ratio,
         max(updated_at) as last_reaction_at
    from public.store_track_reactions
   group by track_id;


-- =============================================================================
-- 5. Admin 통계 RPC (StoreLearningTab 연결 후보)
-- =============================================================================
create or replace function public.admin_store_reaction_stats(p_window_days int default 7)
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object(
    'total_likes', (select count(*) from public.store_track_reactions where reaction_type='like'),
    'total_dislikes', (select count(*) from public.store_track_reactions where reaction_type='dislike'),
    'recent_window_days', p_window_days,
    'recent_likes', (select count(*) from public.store_track_reactions
      where reaction_type='like' and updated_at > now() - (p_window_days || ' days')::interval),
    'recent_dislikes', (select count(*) from public.store_track_reactions
      where reaction_type='dislike' and updated_at > now() - (p_window_days || ' days')::interval),
    'unique_stores', (select count(distinct store_id) from public.store_track_reactions),
    'unique_tracks', (select count(distinct track_id) from public.store_track_reactions),
    'top_liked', (select coalesce(jsonb_agg(jsonb_build_object(
      'track_id', track_id, 'title', title, 'artist', artist, 'like_count', like_count
    ) order by like_count desc), '[]'::jsonb) from (
      select a.track_id, t.title, t.artist, a.like_count
      from public.track_reaction_aggregate a
      join public.tracks t on t.id = a.track_id
      order by a.like_count desc limit 20
    ) s),
    'top_disliked', (select coalesce(jsonb_agg(jsonb_build_object(
      'track_id', track_id, 'title', title, 'artist', artist,
      'dislike_count', dislike_count, 'dislike_ratio', dislike_ratio
    ) order by dislike_ratio desc), '[]'::jsonb) from (
      select a.track_id, t.title, t.artist, a.dislike_count, a.dislike_ratio
      from public.track_reaction_aggregate a
      join public.tracks t on t.id = a.track_id
      where a.total_reactions >= 3  -- 최소 3건 이상 (편향 방지)
      order by a.dislike_ratio desc limit 20
    ) s),
    'computed_at', now()
  )
  where exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin');
$$;
grant execute on function public.admin_store_reaction_stats(int) to authenticated;
