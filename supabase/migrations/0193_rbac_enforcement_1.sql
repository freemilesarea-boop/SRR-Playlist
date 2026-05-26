-- 0193 — RBAC 권한 강제 1차. 사고 위험 큰 RPC 에 can_* 역할 체크 적용. 본문 동일, 가드만 역할 기반으로 교체.
-- guardrail override = super_admin, clear = content+, 영업코드/수수료 = super, 매출조회 = sales+,
-- 음원삭제/비공개 = content+, 자동재배치 승인 = curator+, 수수료정산 = super, 일반승인 = reviewer+, 메타수정+승인(강제포함) = content+.

-- [Guardrail]
create or replace function public.admin_set_guardrail_override(p_track_id uuid, p_store_key text, p_enable boolean, p_reason text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid();
begin
  if not public.can_override_guardrails() then raise exception '가드레일 override 는 super_admin 만 가능합니다' using errcode='42501'; end if;
  if p_enable then
    insert into public.store_guardrail_overrides(track_id, store_key, reason, created_by)
    values (p_track_id, p_store_key, nullif(btrim(p_reason),''), v_uid)
    on conflict (track_id, store_key) do update set reason=coalesce(excluded.reason, public.store_guardrail_overrides.reason), created_by=v_uid, created_at=now();
  else
    delete from public.store_guardrail_overrides where track_id=p_track_id and store_key=p_store_key;
  end if;
  insert into public.admin_action_log(actor_user_id, action, target_id, detail) values (v_uid, 'guardrail_override', p_track_id, jsonb_build_object('store_key', p_store_key, 'enable', p_enable));
  return jsonb_build_object('ok', true, 'override', p_enable);
end; $$;

create or replace function public.admin_bulk_guardrail_override(p_track_ids uuid[], p_store_key text, p_reason text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid(); v_n int := 0; tid uuid;
begin
  if not public.can_override_guardrails() then raise exception '가드레일 override 는 super_admin 만 가능합니다' using errcode='42501'; end if;
  foreach tid in array p_track_ids loop
    insert into public.store_guardrail_overrides(track_id, store_key, reason, created_by)
    values (tid, p_store_key, coalesce(nullif(btrim(p_reason),''),'일괄 override'), v_uid)
    on conflict (track_id, store_key) do update set reason=excluded.reason, created_by=v_uid, created_at=now();
    delete from public.track_guardrail_flags where track_id=tid and store_key=p_store_key; v_n := v_n + 1;
  end loop;
  insert into public.admin_action_log(actor_user_id, action, detail) values (v_uid, 'guardrail_bulk_override', jsonb_build_object('store_key', p_store_key, 'count', v_n));
  return jsonb_build_object('ok', true, 'overridden', v_n);
end; $$;

create or replace function public.admin_bulk_guardrail_clear(p_track_ids uuid[], p_reason text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid(); v_n int := 0; tid uuid; sk text;
begin
  if not public.can_manage_tracks() then raise exception '가드레일 처리(문제없음)는 super_admin/content_admin 만 가능합니다' using errcode='42501'; end if;
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

-- [Sales] 코드/수수료 변경 = super, 조회 = sales+. (admin_sales_agent_list/detail/upsert/generate_code/link 가드만 교체 — 본문은 0192/기존과 동일)
-- 운영 DB 적용 완료. 본문 전체는 0193b/0193b2 적용분과 동일하며 가드만 can_manage_sales()/is_super_admin() 로 교체됨.

-- [Tracks] 삭제/비공개/복구 = content+. (admin_takedown_track/admin_hide_released_track/admin_restore_track/admin_bulk_delete_tracks)
-- [Reorder] 자동재배치 승인 = curator+. (admin_apply_playlist_reorder)
-- [Payout] 수수료 정산 = super. (admin_record_commission_payout)
-- [Approve] 일반 승인 = reviewer+ (admin_approve_artist_release), 메타수정+승인(강제포함) = content+ (admin_update_track_metadata_and_approve)
-- 위 함수들은 본문 동일하게 유지하고 상단 가드만 해당 can_* 로 교체하여 운영 DB 에 적용함(0193b~0193f2).
-- 권한 실패 시 errcode 42501 + 한글 메시지. 관리자 액션은 admin_action_log 에 성공 기록.

-- ===== 전체 본문 (fresh deploy 파리티) =====
create or replace function public.admin_generate_sales_agent_code()
returns text language plpgsql security definer set search_path to 'public' as $f$
declare v_chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; v_code text; v_attempts int := 0;
begin
  if not public.is_super_admin() then raise exception '영업인 코드 발급은 super_admin 만 가능합니다' using errcode='42501'; end if;
  loop
    v_attempts := v_attempts + 1; v_code := '';
    for i in 1..6 loop v_code := v_code || substr(v_chars, 1 + floor(random() * length(v_chars))::int, 1); end loop;
    exit when not exists (select 1 from public.sales_agents where code = v_code);
    if v_attempts > 50 then raise exception 'sales_agent code generation failed'; end if;
  end loop;
  return v_code;
end; $f$;

create or replace function public.admin_sales_agent_upsert(p_id uuid default null, p_user_id uuid default null, p_name text default null, p_email text default null, p_phone text default null, p_code text default null, p_commission_rate numeric default null, p_is_active boolean default null, p_note text default null)
returns uuid language plpgsql security definer set search_path to 'public' as $f$
declare v_id uuid; v_code text;
  v_name_in text := nullif(btrim(coalesce(p_name, '')), ''); v_email_in text := nullif(btrim(coalesce(p_email, '')), '');
  v_phone_in text := nullif(btrim(coalesce(p_phone, '')), ''); v_code_in text := nullif(btrim(coalesce(p_code, '')), ''); v_note_in text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if not public.is_super_admin() then raise exception '영업인 등록/수수료율 변경은 super_admin 만 가능합니다' using errcode='42501'; end if;
  if v_code_in is not null then if exists (select 1 from public.sales_agents where code = v_code_in and (p_id is null or id <> p_id)) then raise exception 'duplicate sales_agent code: %', v_code_in using errcode = '23505'; end if; end if;
  if p_id is null then
    if v_name_in is null then raise exception 'name required'; end if;
    v_code := coalesce(v_code_in, public.admin_generate_sales_agent_code());
    insert into public.sales_agents (user_id, name, email, phone, code, commission_rate, is_active, note)
    values (p_user_id, v_name_in, v_email_in, v_phone_in, v_code, coalesce(p_commission_rate, 0), coalesce(p_is_active, true), v_note_in) returning id into v_id;
  else
    update public.sales_agents set user_id = case when p_user_id is not null then p_user_id else user_id end,
      name = coalesce(v_name_in, name), email = coalesce(v_email_in, email), phone = coalesce(v_phone_in, phone),
      code = coalesce(v_code_in, code), commission_rate = coalesce(p_commission_rate, commission_rate),
      is_active = coalesce(p_is_active, is_active), note = coalesce(v_note_in, note) where id = p_id returning id into v_id;
    if v_id is null then raise exception 'sales_agent not found: %', p_id; end if;
  end if;
  insert into public.admin_action_log(actor_user_id, action, target_id, detail) values (auth.uid(), 'sales_agent_upsert', v_id, jsonb_build_object('commission_rate', p_commission_rate));
  return v_id;
end; $f$;

create or replace function public.admin_link_sales_agent_account(p_agent_id uuid, p_user_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $f$
begin
  if not public.is_super_admin() then raise exception '영업인 계정 연결은 super_admin 만 가능합니다' using errcode='42501'; end if;
  update public.sales_agents set user_id = p_user_id, updated_at = now() where id = p_agent_id;
  return jsonb_build_object('ok', true);
end; $f$;

create or replace function public.admin_takedown_track(p_track_id uuid, p_reason text)
returns void language plpgsql security definer set search_path to 'public' as $f$
declare v_uid uuid := auth.uid();
begin
  if not public.can_manage_tracks() then raise exception '음원 비공개/상태 변경은 super_admin/content_admin 만 가능합니다' using errcode='42501'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'removed_reason required (min 5 chars)'; end if;
  update public.tracks set release_status = 'removed', visibility_status = 'hidden', is_recommendable = false,
    removed_at = now(), removed_by = v_uid, removed_reason = btrim(p_reason), admin_review_note = btrim(p_reason) where id = p_track_id;
  insert into public.admin_action_log(actor_user_id, action, target_id, detail) values (v_uid, 'track_takedown', p_track_id, jsonb_build_object('reason', btrim(p_reason)));
end; $f$;

create or replace function public.admin_hide_released_track(p_track_id uuid, p_reason text default null)
returns void language plpgsql security definer set search_path to 'public' as $f$
begin
  if not public.can_manage_tracks() then raise exception '음원 숨김은 super_admin/content_admin 만 가능합니다' using errcode='42501'; end if;
  update public.tracks set visibility_status = 'hidden', admin_review_note = coalesce(nullif(btrim(p_reason),''), admin_review_note) where id = p_track_id and release_status = 'released';
end; $f$;

create or replace function public.admin_restore_track(p_track_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $f$
begin
  if not public.can_manage_tracks() then raise exception '음원 복구는 super_admin/content_admin 만 가능합니다' using errcode='42501'; end if;
  update public.tracks set release_status = 'draft', removed_at = null, removed_by = null, removed_reason = null,
    rejected_reason = null, admin_review_note = null, audio_review_status = 'pending', cover_review_status = 'pending', metadata_review_status = 'pending'
  where id = p_track_id and release_status in ('removed','rejected');
end; $f$;

create or replace function public.admin_record_commission_payout(p_agent_id uuid, p_amount bigint, p_period text default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $f$
declare v_uid uuid := auth.uid(); v_id uuid;
begin
  if not public.is_super_admin() then raise exception '수수료 정산 기록은 super_admin 만 가능합니다' using errcode='42501'; end if;
  insert into public.salesperson_commission_payouts(agent_id, period_label, amount, status, note, confirmed_by, confirmed_at)
  values (p_agent_id, p_period, p_amount, 'paid', p_note, v_uid, now()) returning id into v_id;
  insert into public.admin_action_log(actor_user_id, action, target_id, detail) values (v_uid, 'commission_payout', p_agent_id, jsonb_build_object('amount', p_amount, 'period', p_period));
  return jsonb_build_object('ok', true, 'id', v_id);
end; $f$;

-- NOTE: admin_sales_agent_list / admin_sales_agent_detail (can_manage_sales 가드),
--       admin_bulk_delete_tracks (can_manage_tracks), admin_apply_playlist_reorder (can_manage_curation),
--       admin_approve_artist_release (can_review_tracks), admin_update_track_metadata_and_approve (can_manage_tracks)
--       는 각 원본 마이그레이션(0181/0188 등) 본문과 동일하며 상단 가드만 위 can_* 로 교체되어 운영 DB 에 적용됨(0193b2~0193f2).
