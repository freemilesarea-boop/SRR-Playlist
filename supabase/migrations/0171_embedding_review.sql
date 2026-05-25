-- 0171 — Audio Embedding 결과 관리자 검증: 리뷰/seed 테이블 + 비교/액션 RPC. additive.
-- 추천/홈/차트/정산/playlist_tracks 미변경. 자동 공개 없음(검증/조치/저장까지만).

alter table public.track_ai_metadata add column if not exists embedding_store_fit jsonb;

create table if not exists public.track_embedding_reviews (
  id uuid primary key default gen_random_uuid(),
  track_id uuid not null references public.tracks(id) on delete cascade,
  model_name text not null default 'openl3',
  review_status text not null default 'pending' check (review_status in ('pending','reviewed','needs_reanalysis','ignored')),
  disagreement_score numeric, suspected_issue text[], admin_note text,
  reviewed_by uuid references public.users(id) on delete set null, reviewed_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (track_id, model_name)
);
alter table public.track_embedding_reviews enable row level security;
drop policy if exists ter_admin_read on public.track_embedding_reviews;
create policy ter_admin_read on public.track_embedding_reviews for select using (exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin'));

create table if not exists public.store_archetype_seed_candidates (
  id uuid primary key default gen_random_uuid(),
  store_key text not null, track_id uuid not null references public.tracks(id) on delete cascade,
  model_name text not null default 'openl3', similarity_score numeric,
  status text not null default 'candidate' check (status in ('candidate','approved','rejected')),
  admin_note text, created_at timestamptz not null default now(), reviewed_at timestamptz,
  unique (store_key, track_id, model_name)
);
alter table public.store_archetype_seed_candidates enable row level security;
drop policy if exists sasc_admin_read on public.store_archetype_seed_candidates;
create policy sasc_admin_read on public.store_archetype_seed_candidates for select using (exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin'));

-- heuristic(ai_store_fit) vs embedding similarity 불일치/오판 계산
create or replace function public._emb_disagreement(p_track_id uuid, p_model text default 'openl3')
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_ai record; emb jsonb := '{}'::jsonb; emb_top text; heur_top text;
  heur_gym numeric; emb_gym numeric; emb_calm_max numeric;
  v_score numeric := 0; v_issues text[] := '{}'; v_overlap int; heur_wine numeric;
begin
  select * into v_ai from public.track_ai_metadata where track_id=p_track_id;
  select coalesce(jsonb_object_agg(s.store_key, round((1-(e.embedding OPERATOR(public.<=>) s.embedding))::numeric,4)), '{}'::jsonb) into emb
  from public.track_embeddings e join public.store_archetype_embeddings s on s.model_name=e.model_name
  where e.track_id=p_track_id and e.model_name=p_model and e.status='done' and e.embedding is not null;
  if emb = '{}'::jsonb then return jsonb_build_object('has_embedding', false, 'score', null, 'issues', '[]'::jsonb, 'embedding_sims', '{}'::jsonb); end if;
  select key into emb_top from jsonb_each_text(emb) order by value::numeric desc limit 1;
  if v_ai.track_id is not null and v_ai.ai_store_fit is not null and v_ai.ai_store_fit <> '{}'::jsonb then
    select key into heur_top from jsonb_each_text(v_ai.ai_store_fit) order by value::numeric desc limit 1;
    heur_gym := coalesce((v_ai.ai_store_fit->>'gym')::numeric, 0);
  end if;
  emb_gym := coalesce((emb->>'gym')::numeric, 0);
  emb_calm_max := greatest(coalesce((emb->>'winebar')::numeric,0), coalesce((emb->>'cafe_independent')::numeric,0),
                           coalesce((emb->>'hotel_lobby')::numeric,0), coalesce((emb->>'cocktail_bar')::numeric,0));
  if heur_top is not null and emb_top is not null and heur_top <> emb_top then v_score := v_score + 30; end if;
  if heur_top is not null then
    select count(*) into v_overlap from (
      (select key from jsonb_each_text(emb) order by value::numeric desc limit 3)
      intersect
      (select key from jsonb_each_text(v_ai.ai_store_fit) order by value::numeric desc limit 3)
    ) z;
    if coalesce(v_overlap,0) = 0 then v_score := v_score + 30; end if;
  end if;
  if coalesce(heur_gym,0) >= 80 and emb_gym < 0.65 and emb_calm_max >= 0.75 then
    v_score := v_score + 30; v_issues := array_append(v_issues, 'gym_false_positive');
  end if;
  heur_wine := greatest(coalesce((v_ai.ai_store_fit->>'winebar')::numeric,0), coalesce((v_ai.ai_store_fit->>'cafe_independent')::numeric,0), coalesce((v_ai.ai_store_fit->>'hotel_lobby')::numeric,0));
  if emb_calm_max >= 0.8 and v_ai.track_id is not null and heur_wine < 50 then
    v_score := v_score + 10; v_issues := array_append(v_issues, 'cafe_winebar_missed');
  end if;
  return jsonb_build_object('has_embedding', true, 'score', least(100, v_score), 'issues', to_jsonb(v_issues),
    'embedding_sims', emb, 'embedding_top', emb_top, 'heuristic_top', heur_top);
end; $$;
grant execute on function public._emb_disagreement(uuid, text) to authenticated;

-- (이하 admin_get_embedding_comparison / admin_list_embedding_review_tracks /
--  admin_mark_embedding_reviewed / admin_mark_embedding_reanalysis_needed /
--  admin_add_store_seed_candidate / admin_apply_embedding_to_ai_metadata 는
--  0171b 마이그레이션에 정의 — DB 적용 완료. 본 파일은 핵심 스키마+helper 기록용.)
