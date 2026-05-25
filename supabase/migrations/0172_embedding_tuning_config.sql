-- 0172 — embedding 오판 감지 임계값/가중치 설정화 (실 OpenL3 import 후 코드변경 없이 튜닝). additive.
create table if not exists public.embedding_tuning_config (
  id int primary key default 1 check (id=1),
  gym_fp_heur_min numeric not null default 80,
  gym_fp_emb_max numeric not null default 0.65,
  gym_fp_calm_min numeric not null default 0.75,
  cafe_missed_emb_min numeric not null default 0.80,
  cafe_missed_heur_max numeric not null default 50,
  w_top1_mismatch numeric not null default 30,
  w_low_overlap numeric not null default 30,
  w_gym_fp numeric not null default 30,
  w_cafe_missed numeric not null default 10,
  disagree_review_cutoff numeric not null default 50,
  similarity_high numeric not null default 0.80,
  updated_at timestamptz not null default now(), updated_by uuid references public.users(id) on delete set null
);
insert into public.embedding_tuning_config(id) values (1) on conflict (id) do nothing;
alter table public.embedding_tuning_config enable row level security;
drop policy if exists etc_read on public.embedding_tuning_config;
create policy etc_read on public.embedding_tuning_config for select using (true);

create or replace function public.get_embedding_tuning_config()
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select to_jsonb(c) from public.embedding_tuning_config c where id=1; $$;
grant execute on function public.get_embedding_tuning_config() to authenticated;

create or replace function public.admin_update_embedding_tuning_config(p_patch jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid();
begin
  if not exists (select 1 from public.users u where u.id=v_uid and u.role='admin') then raise exception 'admin only'; end if;
  update public.embedding_tuning_config set
    gym_fp_heur_min=coalesce((p_patch->>'gym_fp_heur_min')::numeric, gym_fp_heur_min),
    gym_fp_emb_max=coalesce((p_patch->>'gym_fp_emb_max')::numeric, gym_fp_emb_max),
    gym_fp_calm_min=coalesce((p_patch->>'gym_fp_calm_min')::numeric, gym_fp_calm_min),
    cafe_missed_emb_min=coalesce((p_patch->>'cafe_missed_emb_min')::numeric, cafe_missed_emb_min),
    cafe_missed_heur_max=coalesce((p_patch->>'cafe_missed_heur_max')::numeric, cafe_missed_heur_max),
    w_top1_mismatch=coalesce((p_patch->>'w_top1_mismatch')::numeric, w_top1_mismatch),
    w_low_overlap=coalesce((p_patch->>'w_low_overlap')::numeric, w_low_overlap),
    w_gym_fp=coalesce((p_patch->>'w_gym_fp')::numeric, w_gym_fp),
    w_cafe_missed=coalesce((p_patch->>'w_cafe_missed')::numeric, w_cafe_missed),
    disagree_review_cutoff=coalesce((p_patch->>'disagree_review_cutoff')::numeric, disagree_review_cutoff),
    similarity_high=coalesce((p_patch->>'similarity_high')::numeric, similarity_high),
    updated_at=now(), updated_by=v_uid where id=1;
  return public.get_embedding_tuning_config();
end; $$;
grant execute on function public.admin_update_embedding_tuning_config(jsonb) to authenticated;

-- _emb_disagreement 가 config 임계값/가중치 사용 (0171b 버전 대체)
create or replace function public._emb_disagreement(p_track_id uuid, p_model text default 'openl3')
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_ai record; cfg record; emb jsonb := '{}'::jsonb; emb_top text; heur_top text;
  heur_gym numeric; emb_gym numeric; emb_calm_max numeric;
  v_score numeric := 0; v_issues text[] := '{}'; v_overlap int; heur_wine numeric;
begin
  select * into cfg from public.embedding_tuning_config where id=1;
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
  if heur_top is not null and emb_top is not null and heur_top <> emb_top then v_score := v_score + cfg.w_top1_mismatch; end if;
  if heur_top is not null then
    select count(*) into v_overlap from (
      (select key from jsonb_each_text(emb) order by value::numeric desc limit 3)
      intersect
      (select key from jsonb_each_text(v_ai.ai_store_fit) order by value::numeric desc limit 3)
    ) z;
    if coalesce(v_overlap,0) = 0 then v_score := v_score + cfg.w_low_overlap; end if;
  end if;
  if coalesce(heur_gym,0) >= cfg.gym_fp_heur_min and emb_gym < cfg.gym_fp_emb_max and emb_calm_max >= cfg.gym_fp_calm_min then
    v_score := v_score + cfg.w_gym_fp; v_issues := array_append(v_issues, 'gym_false_positive');
  end if;
  heur_wine := greatest(coalesce((v_ai.ai_store_fit->>'winebar')::numeric,0), coalesce((v_ai.ai_store_fit->>'cafe_independent')::numeric,0), coalesce((v_ai.ai_store_fit->>'hotel_lobby')::numeric,0));
  if emb_calm_max >= cfg.cafe_missed_emb_min and v_ai.track_id is not null and heur_wine < cfg.cafe_missed_heur_max then
    v_score := v_score + cfg.w_cafe_missed; v_issues := array_append(v_issues, 'cafe_winebar_missed');
  end if;
  return jsonb_build_object('has_embedding', true, 'score', least(100, v_score), 'issues', to_jsonb(v_issues),
    'embedding_sims', emb, 'embedding_top', emb_top, 'heuristic_top', heur_top);
end; $$;
grant execute on function public._emb_disagreement(uuid, text) to authenticated;
