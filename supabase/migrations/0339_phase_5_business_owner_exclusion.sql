-- 0339 — Phase 5: 매장주 1-click 제외 + Phase 3c cluster 학습 데이터 채우기 (X6.72)
--
-- 배경:
--   X6.65 (Phase 3c) 가 매장별 cluster 분리 인프라 + per-store 예측 badge 까지 완성.
--   그러나 track_store_exclusions active=0건 — admin 만 RPC 호출 가능했음.
--   매장주가 직접 "이 곡 우리 매장 안 어울려" 표시 가능하게 하면:
--     1) Phase 3c 매장별 cluster 가 실제 학습 데이터로 채워짐
--     2) 다음 트랙부터 _ai_check_store_guardrails 로 자동 차단됨
--     3) Phase 4d auto-recompute 트리거로 해당 매장 fit_score 즉시 재계산
--
-- 변경:
--   1) business_exclude_track(track_id, store_type_slug, reason_key) RPC
--      · 인증된 business plan 사용자가 본인 매장에서 트랙 제외
--      · is_active=true upsert (reactivation on conflict)
--      · reason 은 list_canonical_reject_reasons (X6.65) 사용
--   2) business_undo_track_exclusion(exclusion_id) — 본인 등록만 취소 가능
--   3) business_list_my_exclusions(store_type_slug?) — 매장주 본인 이력
--   4) RLS 정책 확장: business 사용자가 본인 created_by exclusions SELECT 허용
--   5) track_store_exclusions INSERT/UPDATE/DELETE 트리거
--      → fit_score_recompute_jobs 에 segment 별 enqueue (Phase 4d 통합)

-- =============================================================================
-- 1. RLS: business 사용자가 본인 exclusions select 허용 (admin 정책 유지)
-- =============================================================================
drop policy if exists excl_business_own_read on public.track_store_exclusions;
create policy excl_business_own_read on public.track_store_exclusions
  for select using (created_by = auth.uid());


-- =============================================================================
-- 2. business_exclude_track — 매장주 1-click 제외
-- =============================================================================
create or replace function public.business_exclude_track(
  p_track_id uuid,
  p_store_type_slug text,
  p_reason_key text default 'store_mismatch'
)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid uuid := auth.uid();
  v_subscription text;
  v_membership text;
  v_reason_label text;
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'unauthorized: authentication required';
  end if;

  -- business plan 검증 (subscription_type 또는 membership_tier)
  select subscription_type, membership_tier
    into v_subscription, v_membership
    from public.users where id = v_uid;
  if coalesce(v_subscription, '') <> 'business'
     and coalesce(v_membership, '') <> 'business' then
    raise exception 'forbidden: business plan required (current: subscription=% / membership=%)',
      coalesce(v_subscription, '?'), coalesce(v_membership, '?');
  end if;

  -- store_type_slug 검증 (taxonomy 등록 매장만)
  if not exists (
    select 1 from public.taxonomy_store_types
    where slug = p_store_type_slug and is_active = true
  ) then
    raise exception 'invalid store_type_slug: %', p_store_type_slug;
  end if;

  -- track 존재 검증
  if not exists (select 1 from public.tracks where id = p_track_id) then
    raise exception 'track not found: %', p_track_id;
  end if;

  -- reason label 도출 (canonical → 한글 label)
  select label into v_reason_label
    from public.list_canonical_reject_reasons()
    where reason_key = p_reason_key;
  v_reason_label := coalesce(v_reason_label, p_reason_key, '매장 분위기 부적합');

  -- Upsert: 기존 inactive 이면 reactivation
  insert into public.track_store_exclusions
    (track_id, store_type_slug, reason, created_by, is_active, created_at)
  values
    (p_track_id, p_store_type_slug, v_reason_label, v_uid, true, now())
  on conflict (track_id, store_type_slug) do update set
    is_active = true,
    reason = excluded.reason,
    created_by = excluded.created_by,
    created_at = now()
  returning id into v_id;

  return jsonb_build_object(
    'ok', true,
    'exclusion_id', v_id,
    'track_id', p_track_id,
    'store_type_slug', p_store_type_slug,
    'reason_key', p_reason_key,
    'reason', v_reason_label
  );
end; $$;

revoke execute on function public.business_exclude_track(uuid, text, text) from public, anon;
grant execute on function public.business_exclude_track(uuid, text, text) to authenticated;


-- =============================================================================
-- 3. business_undo_track_exclusion — 본인 등록만 취소 가능 (soft delete)
-- =============================================================================
create or replace function public.business_undo_track_exclusion(p_exclusion_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid uuid := auth.uid();
  v_owner uuid;
  v_track uuid;
  v_slug text;
begin
  if v_uid is null then raise exception 'unauthorized'; end if;

  select created_by, track_id, store_type_slug
    into v_owner, v_track, v_slug
    from public.track_store_exclusions where id = p_exclusion_id;
  if v_owner is null then raise exception 'exclusion not found'; end if;

  -- 본인 등록만 (admin 은 admin_remove_track_exclusion 별도 사용)
  if v_owner <> v_uid then
    raise exception 'forbidden: can only undo own exclusions';
  end if;

  update public.track_store_exclusions
     set is_active = false
   where id = p_exclusion_id;

  return jsonb_build_object('ok', true, 'exclusion_id', p_exclusion_id,
    'track_id', v_track, 'store_type_slug', v_slug);
end; $$;

revoke execute on function public.business_undo_track_exclusion(uuid) from public, anon;
grant execute on function public.business_undo_track_exclusion(uuid) to authenticated;


-- =============================================================================
-- 4. business_list_my_exclusions — 매장주 본인 active 제외 이력
-- =============================================================================
create or replace function public.business_list_my_exclusions(
  p_store_type_slug text default null,
  p_limit int default 100
)
returns table(
  id uuid,
  track_id uuid,
  track_title text,
  track_artist text,
  cover_url text,
  store_type_slug text,
  reason text,
  created_at timestamptz
) language sql stable security definer set search_path to 'public' as $$
  select e.id, e.track_id, t.title, t.artist, t.cover_url,
         e.store_type_slug, e.reason, e.created_at
  from public.track_store_exclusions e
  join public.tracks t on t.id = e.track_id
  where e.is_active = true
    and e.created_by = auth.uid()
    and (p_store_type_slug is null or e.store_type_slug = p_store_type_slug)
  order by e.created_at desc
  limit greatest(1, p_limit);
$$;

grant execute on function public.business_list_my_exclusions(text, int) to authenticated;


-- =============================================================================
-- 5. track_store_exclusions 변경 트리거 → fit_score 자동 재계산 (Phase 4d 연계)
--    exclusion 추가/해제는 해당 매장의 모든 fit_score 에 영향 (_ai_check_store_guardrails)
--    fit_score_recompute_jobs 큐 활용 → dedup + batch + cron 처리
-- =============================================================================
create or replace function public._tg_enqueue_fit_recompute_exclusion()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  v_slug text;
  v_scope text;
  v_source text;
begin
  if tg_op = 'DELETE' then
    v_slug := old.store_type_slug; v_source := 'exclusion_delete';
  else
    -- INSERT 또는 UPDATE (is_active 토글 모두 영향)
    v_slug := new.store_type_slug;
    v_source := case tg_op when 'INSERT' then 'exclusion_insert' else 'exclusion_update' end;
  end if;
  -- override scope 와 동일 namespace 사용 (segment 단위 enqueue, daypart NULL = 전체 시간대)
  v_scope := 'override:' || coalesce(v_slug, '*') || '/*';
  perform public._enqueue_fit_recompute(v_scope, v_slug, null, v_source);
  if tg_op = 'DELETE' then return old; else return new; end if;
end; $$;

drop trigger if exists tg_enqueue_fit_recompute_exclusion on public.track_store_exclusions;
create trigger tg_enqueue_fit_recompute_exclusion
  after insert or update or delete on public.track_store_exclusions
  for each row execute function public._tg_enqueue_fit_recompute_exclusion();
