-- 0513_admin_ai_enterprise_knowledge_graph.sql
-- Phase AI-OPS-10 — Enterprise Knowledge Graph, Organizational Intelligence & Dependency Reasoning.
--
-- 실제 Entity/관계 구조 분석 결과(추측 없음):
--   [explicit_fk 확인] playlist_tracks(playlist_id/track_id), artist_profiles.user_id,
--     artist_contracts.artist_user_id, artist_settlements(artist_user_id/policy_id/payout_account_id),
--     settlement_items(settlement_id/track_id), subscriptions.user_id,
--     payment_orders(user_id/subscription_id), artist_payout_accounts.user_id,
--     franchise_stores(franchise_id/store_id→users), playback_events_v2.track_id.
--   [inferred_reference — FK 없음] tracks.artist 는 text(이름 문자열 — artist FK 없음),
--     playback_events_v2.user_id/business_id 는 FK 없는 uuid 컬럼.
--   [explicit_code_reference] ai_enterprise_policies.depends_on(jsonb),
--     ai_policy_recommendations.policy_code(text — FK 없음).
--   [미존재 테이블 — unsupported 정직 표기] enterprises/brands/stores/store_codes/audio_tracks/
--     artist_tracks/contract_snapshots/settlement_versions/enterprise_contracts.
--     '매장' 실체 = users(account_type='business'), '기업' 실체 = franchises + enterprise_accounts.
--
-- 원칙:
--   * Knowledge Graph 는 조회/분석/근거 생성 전용 — 원본 Entity/FK/관계/Scope/Owner/계약/정산/
--     정책/플레이리스트 변경 없음. 자동 Orphan 삭제·중복 병합·FK 생성 없음. Trigger 없음.
--   * inferred_reference 는 confirmed 로 표시하지 않는다. null→0 변환 없음.
--   * 원본 전체 복제 금지 — 스캔은 유형별 상한(bounded sample) + display_label 마스킹
--     (이메일/전화/계좌/real_name/계약 원문 저장 금지). Snapshot ≠ Production Master Data.
--   * validated_reference 는 검토 결과일 뿐 실제 DB 관계 변경 상태가 아니다. 삭제 RPC 없음.

-- ─────────────────────────────────────────────────────────────────────────
-- 1) Entity Inventory — 검증된 entity_type 17종만(존재하지 않는 Entity 생성 금지).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_knowledge_entities (
  id                  uuid primary key default gen_random_uuid(),
  entity_type         text not null check (entity_type in ('enterprise','enterprise_account','store','user','admin_user','artist','track','playlist','contract','subscription','payment','settlement','payout_account','policy','recommendation','decision','incident')),
  source_table        text not null,
  source_primary_key  text not null,
  display_label       text not null,                          -- 마스킹 라벨(민감 원문 금지)
  domain              text not null check (domain in ('organization','identity','artist','track','playlist','contract','subscription','revenue','settlement','payout','policy','governance','incident')),
  lifecycle_status    text,
  is_sensitive        boolean not null default false,
  source_version      text not null default 'kg_v1(0513)',
  limitations         jsonb not null default '["bounded sample — 전체 아님","snapshot ≠ master data"]'::jsonb,
  first_observed_at   timestamptz not null default now(),
  last_observed_at    timestamptz not null default now(),
  snapshot_at         timestamptz not null default now(),
  created_at          timestamptz not null default now(),
  unique (entity_type, source_primary_key)
);
create index if not exists idx_kg_ent on public.ai_knowledge_entities (entity_type, snapshot_at desc);
create index if not exists idx_kg_ent_domain on public.ai_knowledge_entities (domain);

-- ─────────────────────────────────────────────────────────────────────────
-- 2) Relationship Inventory — 검증 근거 있는 15종만. inferred ≠ confirmed.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_knowledge_relationships (
  id                  uuid primary key default gen_random_uuid(),
  relationship_type   text not null check (relationship_type in ('playlist_contains_track','user_is_artist','contract_belongs_to_artist','settlement_belongs_to_artist','settlement_references_track','settlement_uses_policy','payout_account_belongs_to_artist','subscription_belongs_to_user','payment_pays_subscription','payment_belongs_to_user','enterprise_operates_store','policy_depends_on_policy','recommendation_references_policy','track_played_at_store','artist_named_on_track')),
  source_entity_id    uuid not null references public.ai_knowledge_entities(id),
  target_entity_id    uuid not null references public.ai_knowledge_entities(id),
  direction           text not null default 'directed' check (direction in ('directed','undirected')),
  evidence_type       text not null check (evidence_type in ('explicit_fk','explicit_code_reference','explicit_rpc_join','explicit_view_join','explicit_snapshot_reference','audit_reference','event_reference','external_reference','inferred_reference','unknown')),
  evidence_source     text not null,
  evidence_strength   text not null check (evidence_strength in ('confirmed','strong','moderate','weak','unverified','insufficient_data')),
  relationship_status text not null default 'active_reference' check (relationship_status in ('active_reference','historical_reference','stale_reference_candidate','inferred_reference','invalidated','insufficient_data')),
  confidence          numeric check (confidence is null or (confidence >= 0 and confidence <= 100)),
  limitations         jsonb not null default '["관계 존재 ≠ 업무 실행 보장(재생/지급/적용 아님)"]'::jsonb,
  source_version      text not null default 'kg_v1(0513)',
  first_observed_at   timestamptz not null default now(),
  last_observed_at    timestamptz not null default now(),
  snapshot_at         timestamptz not null default now(),
  created_at          timestamptz not null default now(),
  unique (relationship_type, source_entity_id, target_entity_id),
  check (evidence_type <> 'inferred_reference' or evidence_strength in ('weak','unverified','insufficient_data'))  -- inferred 는 confirmed 금지
);
create index if not exists idx_kg_rel on public.ai_knowledge_relationships (relationship_type, snapshot_at desc);
create index if not exists idx_kg_rel_src on public.ai_knowledge_relationships (source_entity_id);
create index if not exists idx_kg_rel_tgt on public.ai_knowledge_relationships (target_entity_id);

-- ─────────────────────────────────────────────────────────────────────────
-- 3) Graph Snapshot — 분석 결과 기록(Production Master Data 아님).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_knowledge_graph_snapshots (
  id                  uuid primary key default gen_random_uuid(),
  snapshot_code       text not null unique,
  domain_scope        text not null default 'all',
  entity_count        int not null default 0,
  relationship_count  int not null default 0,
  confirmed_relationship_count int not null default 0,
  inferred_relationship_count  int not null default 0,
  source_entity_counts jsonb not null default '{}'::jsonb,   -- 원본 테이블 실측 총계(복제 아님)
  risk_summary        jsonb,
  limitations         jsonb not null default '["bounded sample","snapshot 이후 변경 미반영 가능(stale 가능)","분석 결과 — master data 아님"]'::jsonb,
  input_hash          text not null,
  source_version      text not null default 'kg_v1(0513)',
  generated_by        uuid,
  generated_at        timestamptz not null default now(),
  created_at          timestamptz not null default now()
);
create index if not exists idx_kg_snap on public.ai_knowledge_graph_snapshots (generated_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 4) Human Review + External Correction Reference(참고 기록만 — 실행 없음).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_knowledge_reviews (
  id                  uuid primary key default gen_random_uuid(),
  review_code         text not null unique,
  kind                text not null default 'review' check (kind in ('review','external_correction_reference')),
  subject_entity_id   uuid references public.ai_knowledge_entities(id),
  subject_relationship_id uuid references public.ai_knowledge_relationships(id),
  topic               text not null check (topic in ('orphan_candidate','duplicate_candidate','inferred_relationship','lineage_gap','scope_conflict','circular_dependency','single_point_candidate','contract_settlement_link','policy_scope','relationship_audit','snapshot_refresh','other')),
  reason              text not null,
  evidence            jsonb not null default '[]'::jsonb,
  review_status       text not null default 'draft' check (review_status in ('draft','pending_review','waiting_evidence','validated_reference','correction_recommended','rejected','cancelled','expired','invalidated')),
  external_action_type text check (external_action_type is null or external_action_type in ('entity_corrected_reference','relationship_corrected_reference','orphan_resolved_reference','duplicate_merged_reference','scope_corrected_reference','owner_assigned_reference','backup_owner_assigned_reference','foreign_key_added_reference','stale_reference_removed_reference')),
  human_decision_reason text,
  decided_by          uuid,
  decided_at          timestamptz,
  limitations         jsonb not null default '["검토/참고 기록 — 실제 DB 관계 변경 상태 아님"]'::jsonb,
  idempotency_key     text not null unique,
  created_by          uuid,
  created_at          timestamptz not null default now()
);
create index if not exists idx_kg_review on public.ai_knowledge_reviews (review_status, created_at desc);

create table if not exists public.ai_knowledge_graph_events (
  id                  uuid primary key default gen_random_uuid(),
  event_type          text not null check (event_type in ('entity_snapshot_created','relationship_snapshot_created','graph_snapshot_created','inferred_relationship_detected','orphan_candidate_detected','duplicate_candidate_detected','circular_dependency_detected','relationship_conflict_detected','single_point_candidate_detected','lineage_gap_detected','blast_radius_analyzed','graph_risk_calculated','graph_recommendation_created','graph_review_completed','graph_snapshot_invalidated')),
  ref_id              uuid,
  detail              text,
  payload             jsonb,
  actor_id            uuid,
  created_at          timestamptz not null default now()
);
create index if not exists idx_kg_evt on public.ai_knowledge_graph_events (event_type, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 5) 요약 — 원본 실측 총계 + inventory 현황(읽기 전용).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_knowledge_graph_summary()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  perform public._admin_growth_guard();
  select jsonb_build_object(
    'inventory_entities', (select count(*) from public.ai_knowledge_entities),
    'inventory_entities_by_type', (select coalesce(jsonb_object_agg(entity_type, n), '{}'::jsonb) from (select entity_type, count(*) n from public.ai_knowledge_entities group by entity_type) x),
    'inventory_relationships', (select count(*) from public.ai_knowledge_relationships),
    'inventory_relationships_by_type', (select coalesce(jsonb_object_agg(relationship_type, n), '{}'::jsonb) from (select relationship_type, count(*) n from public.ai_knowledge_relationships group by relationship_type) x),
    'confirmed_relationships', (select count(*) from public.ai_knowledge_relationships where evidence_strength = 'confirmed'),
    'inferred_relationships', (select count(*) from public.ai_knowledge_relationships where evidence_type = 'inferred_reference'),
    'reviews_by_status', (select coalesce(jsonb_object_agg(review_status, n), '{}'::jsonb) from (select review_status, count(*) n from public.ai_knowledge_reviews group by review_status) x),
    -- 원본 실측 총계(복제 아님 — 개수만):
    'source_counts', jsonb_build_object(
      'franchises', (select count(*) from public.franchises),
      'enterprise_accounts', (select count(*) from public.enterprise_accounts),
      'business_users', (select count(*) from public.users where account_type = 'business'),
      'admin_users', (select count(*) from public.users where role = 'admin'),
      'artist_profiles', (select count(*) from public.artist_profiles),
      'tracks', (select count(*) from public.tracks),
      'playlists', (select count(*) from public.playlists),
      'playlist_tracks', (select count(*) from public.playlist_tracks),
      'artist_contracts', (select count(*) from public.artist_contracts),
      'subscriptions', (select count(*) from public.subscriptions),
      'payment_orders', (select count(*) from public.payment_orders),
      'artist_settlements', (select count(*) from public.artist_settlements),
      'settlement_items', (select count(*) from public.settlement_items),
      'artist_payout_accounts', (select count(*) from public.artist_payout_accounts),
      'ai_enterprise_policies', (select count(*) from public.ai_enterprise_policies),
      'ai_incidents', (select count(*) from public.ai_incidents)
    ),
    'latest_snapshot', (select jsonb_build_object('snapshot_code', snapshot_code, 'generated_at', generated_at, 'entity_count', entity_count, 'relationship_count', relationship_count, 'confirmed', confirmed_relationship_count, 'inferred', inferred_relationship_count)
        from public.ai_knowledge_graph_snapshots order by generated_at desc limit 1),   -- 없으면 null(snapshot_age_unknown)
    'no_auto_mutation', true,
    'generated_at', now()
  ) into v;
  return v;
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 6) Snapshot 생성 — 원본 읽기 → bounded upsert(원본 미변경). 유형별 상한 200,
--    관계 유형별 상한 300. 동일 input_hash 최신 snapshot 존재 시 idempotent 반환.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_knowledge_graph_snapshot_create()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid; v_now timestamptz := now(); v_hash text; v_code text; v_id uuid;
  v_ent int; v_rel int; v_conf int; v_inf int; v_counts jsonb;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();

  -- Entities(유형별 최신 200 — bounded sample, 마스킹 라벨)
  insert into public.ai_knowledge_entities (entity_type, source_table, source_primary_key, display_label, domain, lifecycle_status, is_sensitive, snapshot_at)
  select * from (
    (select 'enterprise', 'franchises', id::text, left(name, 60), 'organization', null::text, false, v_now from public.franchises order by created_at desc limit 200)
    union all (select 'enterprise_account', 'enterprise_accounts', id::text, 'ent-account ' || left(id::text, 8), 'organization', null, false, v_now from public.enterprise_accounts order by created_at desc limit 200)
    union all (select 'store', 'users', id::text, coalesce(left(business_name, 40), 'store') || ' (' || left(id::text, 8) || ')', 'organization', case when withdrawn_at is null then 'active' else 'withdrawn' end, false, v_now from public.users where account_type = 'business' order by created_at desc limit 200)
    union all (select 'admin_user', 'users', id::text, 'admin ' || left(id::text, 8), 'identity', case when withdrawn_at is null then 'active' else 'withdrawn' end, true, v_now from public.users where role = 'admin' order by created_at desc limit 50)
    union all (select 'artist', 'artist_profiles', id::text, left(artist_name, 40), 'artist', null, false, v_now from public.artist_profiles order by created_at desc limit 200)
    union all (select 'track', 'tracks', id::text, left(title, 60), 'track', null, false, v_now from public.tracks order by created_at desc limit 200)
    union all (select 'playlist', 'playlists', id::text, left(title, 60), 'playlist', null, false, v_now from public.playlists order by created_at desc limit 200)
    union all (select 'contract', 'artist_contracts', id::text, 'contract ' || left(id::text, 8) || ' (' || status || ')', 'contract', status, true, v_now from public.artist_contracts order by created_at desc limit 200)
    union all (select 'subscription', 'subscriptions', id::text, 'sub ' || left(id::text, 8) || ' (' || status || ')', 'subscription', status, false, v_now from public.subscriptions order by created_at desc limit 200)
    union all (select 'payment', 'payment_orders', id::text, 'order ' || left(id::text, 8) || ' (' || status || ')', 'revenue', status, false, v_now from public.payment_orders order by created_at desc limit 200)
    union all (select 'settlement', 'artist_settlements', id::text, 'settlement ' || left(id::text, 8), 'settlement', status, true, v_now from public.artist_settlements order by created_at desc limit 200)
    union all (select 'payout_account', 'artist_payout_accounts', id::text, 'payout ' || left(id::text, 8), 'payout', null, true, v_now from public.artist_payout_accounts order by created_at desc limit 200)  -- 계좌번호 저장 금지
    union all (select 'policy', 'ai_enterprise_policies', id::text, policy_code, 'policy', status, false, v_now from public.ai_enterprise_policies order by created_at desc limit 200)
    union all (select 'recommendation', 'ai_policy_recommendations', id::text, rec_code, 'governance', approval_status, false, v_now from public.ai_policy_recommendations order by created_at desc limit 200)
    union all (select 'decision', 'ai_executive_decisions', id::text, decision_code, 'governance', decision_status, false, v_now from public.ai_executive_decisions order by created_at desc limit 200)
    union all (select 'incident', 'ai_incidents', id::text, incident_code || ' (' || severity || ')', 'incident', status, false, v_now from public.ai_incidents order by created_at desc limit 200)
  ) s (entity_type, source_table, source_primary_key, display_label, domain, lifecycle_status, is_sensitive, snapshot_at)
  on conflict (entity_type, source_primary_key)
  do update set display_label = excluded.display_label, lifecycle_status = excluded.lifecycle_status, last_observed_at = excluded.snapshot_at, snapshot_at = excluded.snapshot_at;

  -- Relationships(검증 근거별 — inferred 는 weak/unverified 로만)
  -- explicit_fk(confirmed)
  insert into public.ai_knowledge_relationships (relationship_type, source_entity_id, target_entity_id, evidence_type, evidence_source, evidence_strength, confidence, snapshot_at)
  select * from (
    (select 'playlist_contains_track', ep.id, et.id, 'explicit_fk', 'playlist_tracks(0001) FK', 'confirmed', 95, v_now
       from public.playlist_tracks pt
       join public.ai_knowledge_entities ep on ep.entity_type = 'playlist' and ep.source_primary_key = pt.playlist_id::text
       join public.ai_knowledge_entities et on et.entity_type = 'track' and et.source_primary_key = pt.track_id::text
       limit 300)
    union all (select 'user_is_artist', ea.id, eu.id, 'explicit_fk', 'artist_profiles.user_id(0017) FK', 'confirmed', 95, v_now
       from public.artist_profiles ap
       join public.ai_knowledge_entities ea on ea.entity_type = 'artist' and ea.source_primary_key = ap.id::text
       join public.ai_knowledge_entities eu on eu.entity_type = 'store' and eu.source_primary_key = ap.user_id::text
       limit 300)
    union all (select 'contract_belongs_to_artist', ec.id, ea.id, 'explicit_fk', 'artist_contracts.artist_user_id(0057) FK', 'confirmed', 95, v_now
       from public.artist_contracts c
       join public.ai_knowledge_entities ec on ec.entity_type = 'contract' and ec.source_primary_key = c.id::text
       join public.artist_profiles ap on ap.user_id = c.artist_user_id
       join public.ai_knowledge_entities ea on ea.entity_type = 'artist' and ea.source_primary_key = ap.id::text
       limit 300)
    union all (select 'settlement_belongs_to_artist', es.id, ea.id, 'explicit_fk', 'artist_settlements.artist_user_id(0060) FK', 'confirmed', 95, v_now
       from public.artist_settlements st
       join public.ai_knowledge_entities es on es.entity_type = 'settlement' and es.source_primary_key = st.id::text
       join public.artist_profiles ap on ap.user_id = st.artist_user_id
       join public.ai_knowledge_entities ea on ea.entity_type = 'artist' and ea.source_primary_key = ap.id::text
       limit 300)
    union all (select 'settlement_references_track', es.id, et.id, 'explicit_rpc_join', 'settlement_items(settlement_id/track_id FK) join', 'strong', 85, v_now
       from public.settlement_items si
       join public.ai_knowledge_entities es on es.entity_type = 'settlement' and es.source_primary_key = si.settlement_id::text
       join public.ai_knowledge_entities et on et.entity_type = 'track' and et.source_primary_key = si.track_id::text
       where si.track_id is not null
       limit 300)
    union all (select 'payout_account_belongs_to_artist', epa.id, ea.id, 'explicit_fk', 'artist_payout_accounts.user_id(0025) FK', 'confirmed', 95, v_now
       from public.artist_payout_accounts pa
       join public.ai_knowledge_entities epa on epa.entity_type = 'payout_account' and epa.source_primary_key = pa.id::text
       join public.artist_profiles ap on ap.user_id = pa.user_id
       join public.ai_knowledge_entities ea on ea.entity_type = 'artist' and ea.source_primary_key = ap.id::text
       limit 300)
    union all (select 'subscription_belongs_to_user', esub.id, eu.id, 'explicit_fk', 'subscriptions.user_id(0015) FK', 'confirmed', 95, v_now
       from public.subscriptions s
       join public.ai_knowledge_entities esub on esub.entity_type = 'subscription' and esub.source_primary_key = s.id::text
       join public.ai_knowledge_entities eu on eu.entity_type = 'store' and eu.source_primary_key = s.user_id::text
       limit 300)
    union all (select 'payment_pays_subscription', epay.id, esub.id, 'explicit_fk', 'payment_orders.subscription_id(0015) FK', 'confirmed', 95, v_now
       from public.payment_orders po
       join public.ai_knowledge_entities epay on epay.entity_type = 'payment' and epay.source_primary_key = po.id::text
       join public.ai_knowledge_entities esub on esub.entity_type = 'subscription' and esub.source_primary_key = po.subscription_id::text
       where po.subscription_id is not null
       limit 300)
    union all (select 'enterprise_operates_store', ee.id, es2.id, 'explicit_fk', 'franchise_stores(franchise_id/store_id FK, 0349)', 'confirmed', 95, v_now
       from public.franchise_stores fs
       join public.ai_knowledge_entities ee on ee.entity_type = 'enterprise' and ee.source_primary_key = fs.franchise_id::text
       join public.ai_knowledge_entities es2 on es2.entity_type = 'store' and es2.source_primary_key = fs.store_id::text
       limit 300)
    union all (select 'settlement_uses_policy', es.id, ep2.id, 'explicit_fk', 'artist_settlements.policy_id(0060) FK', 'confirmed', 95, v_now
       from public.artist_settlements st
       join public.ai_knowledge_entities es on es.entity_type = 'settlement' and es.source_primary_key = st.id::text
       join public.settlement_policies sp on sp.id = st.policy_id
       join public.ai_knowledge_entities ep2 on ep2.entity_type = 'policy' and ep2.source_primary_key = sp.id::text
       limit 300)
    -- explicit_code_reference(moderate — FK 아님)
    union all (select 'recommendation_references_policy', er.id, ep3.id, 'explicit_code_reference', 'ai_policy_recommendations.policy_code(text — FK 없음)', 'moderate', 60, v_now
       from public.ai_policy_recommendations r
       join public.ai_knowledge_entities er on er.entity_type = 'recommendation' and er.source_primary_key = r.id::text
       join public.ai_enterprise_policies p on p.policy_code = r.policy_code
       join public.ai_knowledge_entities ep3 on ep3.entity_type = 'policy' and ep3.source_primary_key = p.id::text
       where r.policy_code is not null
       limit 300)
    -- inferred_reference(weak — confirmed 금지)
    union all (select 'track_played_at_store', et.id, es3.id, 'inferred_reference', 'playback_events_v2.business_id(FK 없음 — 재생 보장 아님)', 'weak', 30, v_now
       from (select distinct track_id, business_id from public.playback_events_v2 where track_id is not null and business_id is not null limit 300) pe
       join public.ai_knowledge_entities et on et.entity_type = 'track' and et.source_primary_key = pe.track_id::text
       join public.ai_knowledge_entities es3 on es3.entity_type = 'store' and es3.source_primary_key = pe.business_id::text)
    union all (select 'artist_named_on_track', ea.id, et.id, 'inferred_reference', 'tracks.artist 텍스트 = artist_profiles.artist_name(FK 없음 — 동명 가능)', 'unverified', 20, v_now
       from public.tracks t
       join public.artist_profiles ap on ap.artist_name = t.artist
       join public.ai_knowledge_entities ea on ea.entity_type = 'artist' and ea.source_primary_key = ap.id::text
       join public.ai_knowledge_entities et on et.entity_type = 'track' and et.source_primary_key = t.id::text
       where t.artist is not null
       limit 300)
  ) r (relationship_type, source_entity_id, target_entity_id, evidence_type, evidence_source, evidence_strength, confidence, snapshot_at)
  on conflict (relationship_type, source_entity_id, target_entity_id)
  do update set last_observed_at = excluded.snapshot_at, snapshot_at = excluded.snapshot_at, evidence_strength = excluded.evidence_strength;

  -- inferred 상태 표기
  update public.ai_knowledge_relationships set relationship_status = 'inferred_reference'
   where evidence_type = 'inferred_reference' and relationship_status = 'active_reference';

  select count(*) into v_ent from public.ai_knowledge_entities;
  select count(*) into v_rel from public.ai_knowledge_relationships;
  select count(*) into v_conf from public.ai_knowledge_relationships where evidence_strength = 'confirmed';
  select count(*) into v_inf from public.ai_knowledge_relationships where evidence_type = 'inferred_reference';
  v_counts := jsonb_build_object('entities', v_ent, 'relationships', v_rel, 'confirmed', v_conf, 'inferred', v_inf);
  v_hash := md5(v_counts::text);

  select id into v_id from public.ai_knowledge_graph_snapshots where input_hash = v_hash order by generated_at desc limit 1;
  if v_id is not null then
    return jsonb_build_object('ok', true, 'idempotent', true, 'snapshot_id', v_id, 'counts', v_counts, 'production_applied', false);
  end if;

  v_code := 'kgsnap_' || to_char(v_now, 'YYYYMMDD_HH24MISS');
  insert into public.ai_knowledge_graph_snapshots (snapshot_code, entity_count, relationship_count, confirmed_relationship_count, inferred_relationship_count, source_entity_counts, input_hash, generated_by, generated_at)
  values (v_code, v_ent, v_rel, v_conf, v_inf, v_counts, v_hash, v_uid, v_now)
  returning id into v_id;
  insert into public.ai_knowledge_graph_events (event_type, ref_id, detail, actor_id) values ('graph_snapshot_created', v_id, v_code || ' — bounded sample(유형별≤200/관계≤300)', v_uid);
  return jsonb_build_object('ok', true, 'idempotent', false, 'snapshot_id', v_id, 'snapshot_code', v_code, 'counts', v_counts, 'production_applied', false);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 7) 조회 RPC — pagination + clamp.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_knowledge_entities(p_type text default null, p_domain text default null, p_limit int default 100, p_offset int default 0)
returns setof public.ai_knowledge_entities language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_knowledge_entities
    where (p_type is null or entity_type = p_type) and (p_domain is null or domain = p_domain)
    order by snapshot_at desc, display_label
    limit least(greatest(coalesce(p_limit, 100), 1), 300) offset greatest(coalesce(p_offset, 0), 0);
end $$;

create or replace function public.admin_knowledge_relationships(p_type text default null, p_strength text default null, p_limit int default 200, p_offset int default 0)
returns setof public.ai_knowledge_relationships language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_knowledge_relationships
    where (p_type is null or relationship_type = p_type) and (p_strength is null or evidence_strength = p_strength)
    order by snapshot_at desc
    limit least(greatest(coalesce(p_limit, 200), 1), 500) offset greatest(coalesce(p_offset, 0), 0);
end $$;

create or replace function public.admin_knowledge_entity_detail(p_entity_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  perform public._admin_growth_guard();
  select jsonb_build_object(
    'entity', to_jsonb(e),
    'outgoing', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'relationship_type', r.relationship_type, 'target_entity_id', r.target_entity_id, 'target_label', te.display_label, 'target_type', te.entity_type, 'evidence_type', r.evidence_type, 'evidence_strength', r.evidence_strength, 'evidence_source', r.evidence_source)), '[]'::jsonb)
        from (select * from public.ai_knowledge_relationships where source_entity_id = p_entity_id limit 100) r
        join public.ai_knowledge_entities te on te.id = r.target_entity_id),
    'incoming', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'relationship_type', r.relationship_type, 'source_entity_id', r.source_entity_id, 'source_label', se.display_label, 'source_type', se.entity_type, 'evidence_type', r.evidence_type, 'evidence_strength', r.evidence_strength, 'evidence_source', r.evidence_source)), '[]'::jsonb)
        from (select * from public.ai_knowledge_relationships where target_entity_id = p_entity_id limit 100) r
        join public.ai_knowledge_entities se on se.id = r.source_entity_id)
  ) into v from public.ai_knowledge_entities e where e.id = p_entity_id;
  if v is null then raise exception 'entity 없음'; end if;
  return v;
end $$;

create or replace function public.admin_knowledge_graph_snapshots(p_limit int default 30)
returns setof public.ai_knowledge_graph_snapshots language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_knowledge_graph_snapshots order by generated_at desc limit least(greatest(coalesce(p_limit, 30), 1), 100);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 8) Review 생성/결정 + External Correction Reference(참고 기록만).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_knowledge_review_create(
  p_code text, p_topic text, p_reason text, p_evidence jsonb,
  p_subject_entity_id uuid default null, p_subject_relationship_id uuid default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Reason 필수'; end if;
  if p_evidence is null or jsonb_typeof(p_evidence) <> 'array' or jsonb_array_length(p_evidence) = 0 then raise exception 'Evidence 필수(빈 배열 금지)'; end if;
  if pg_column_size(p_evidence) > 32768 then raise exception 'evidence 32KB 초과'; end if;
  if p_subject_entity_id is not null and not exists (select 1 from public.ai_knowledge_entities where id = p_subject_entity_id) then raise exception 'subject entity 없음'; end if;
  if p_subject_relationship_id is not null and not exists (select 1 from public.ai_knowledge_relationships where id = p_subject_relationship_id) then raise exception 'subject relationship 없음'; end if;
  select id into v_id from public.ai_knowledge_reviews where idempotency_key = p_code;
  if v_id is not null then return jsonb_build_object('ok', true, 'id', v_id, 'idempotent', true); end if;
  insert into public.ai_knowledge_reviews (review_code, kind, subject_entity_id, subject_relationship_id, topic, reason, evidence, review_status, idempotency_key, created_by)
  values (p_code, 'review', p_subject_entity_id, p_subject_relationship_id, p_topic, p_reason, p_evidence, 'pending_review', p_code, v_uid)
  returning id into v_id;
  insert into public.ai_knowledge_graph_events (event_type, ref_id, detail, actor_id) values ('graph_recommendation_created', v_id, p_code || ' (' || p_topic || ')', v_uid);
  return jsonb_build_object('ok', true, 'id', v_id, 'review_status', 'pending_review', 'production_applied', false);
end $$;

create or replace function public.admin_knowledge_review_decide(p_id uuid, p_status text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_cur text;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_status not in ('pending_review','waiting_evidence','validated_reference','correction_recommended','rejected','cancelled','expired','invalidated') then raise exception '허용되지 않는 상태: %', p_status; end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception '결정 사유 필수'; end if;
  select review_status into v_cur from public.ai_knowledge_reviews where id = p_id for update;
  if v_cur is null then raise exception 'review 없음'; end if;
  if v_cur in ('validated_reference','correction_recommended','rejected','cancelled','expired','invalidated') then
    raise exception '종결 상태(%)에서 재결정 불가', v_cur;
  end if;
  update public.ai_knowledge_reviews
     set review_status = p_status, human_decision_reason = p_reason, decided_by = v_uid, decided_at = now()
   where id = p_id;
  insert into public.ai_knowledge_graph_events (event_type, ref_id, detail, actor_id)
  values ('graph_review_completed', p_id, v_cur || ' → ' || p_status || ' — ' || left(p_reason, 200), v_uid);
  return jsonb_build_object('ok', true, 'review_status', p_status, 'db_relationship_changed', false, 'production_applied', false);
end $$;

create or replace function public.admin_knowledge_external_correction_reference(
  p_code text, p_action_type text, p_reason text, p_evidence jsonb, p_subject_entity_id uuid default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Reason 필수'; end if;
  if p_evidence is null or jsonb_typeof(p_evidence) <> 'array' or jsonb_array_length(p_evidence) = 0 then raise exception 'Evidence 필수'; end if;
  if pg_column_size(p_evidence) > 32768 then raise exception 'evidence 32KB 초과'; end if;
  select id into v_id from public.ai_knowledge_reviews where idempotency_key = p_code;
  if v_id is not null then return jsonb_build_object('ok', true, 'id', v_id, 'idempotent', true); end if;
  insert into public.ai_knowledge_reviews (review_code, kind, subject_entity_id, topic, reason, evidence, review_status, external_action_type, idempotency_key, created_by)
  values (p_code, 'external_correction_reference', p_subject_entity_id, 'other', p_reason, p_evidence, 'validated_reference', p_action_type, p_code, v_uid)
  returning id into v_id;
  insert into public.ai_knowledge_graph_events (event_type, ref_id, detail, actor_id) values ('graph_review_completed', v_id, 'external: ' || p_action_type, v_uid);
  return jsonb_build_object('ok', true, 'id', v_id, 'reference_only', true, 'production_applied', false);
end $$;

create or replace function public.admin_knowledge_reviews(p_status text default null, p_limit int default 100)
returns setof public.ai_knowledge_reviews language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_knowledge_reviews
    where (p_status is null or review_status = p_status)
    order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 200);
end $$;

create or replace function public.admin_knowledge_audit(p_limit int default 100)
returns setof public.ai_knowledge_graph_events language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_knowledge_graph_events order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

-- RLS — service role/definer 경유만.
alter table public.ai_knowledge_entities enable row level security;
alter table public.ai_knowledge_relationships enable row level security;
alter table public.ai_knowledge_graph_snapshots enable row level security;
alter table public.ai_knowledge_reviews enable row level security;
alter table public.ai_knowledge_graph_events enable row level security;

comment on table public.ai_knowledge_entities is 'AI-OPS-10 — Entity Inventory(검증된 17종·bounded sample·마스킹 라벨). 원본 복제/변경 없음.';
comment on table public.ai_knowledge_relationships is 'AI-OPS-10 — Relationship Inventory(검증 15종). inferred ≠ confirmed(CHECK 강제). 원본 FK 변경 없음.';
comment on table public.ai_knowledge_graph_snapshots is 'AI-OPS-10 — Graph Snapshot(분석 결과 — Production Master Data 아님).';
comment on table public.ai_knowledge_reviews is 'AI-OPS-10 — Human Review + External Correction Reference(참고 기록 — 실제 DB 관계 변경 아님).';
comment on table public.ai_knowledge_graph_events is 'AI-OPS-10 — Graph Audit(event_type whitelist 15종).';
