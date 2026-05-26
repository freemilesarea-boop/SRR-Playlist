-- 0194 — RBAC 권한 강제 2차.
--  1) 정산 생성/지급상태 변경 RPC = super_admin 전용 (+ admin_action_log 기록)
--  2) AI 큐레이션 핵심 진입 RPC = 영역(역할)별 서버 가드 → 직접 호출(URL) 시 차단
--     · 검수/메타/재검수/Guardrail/고위험/임베딩 = can_manage_tracks (content+super)
--     · 운영성과/Flow/자동재배치/사업자반응 = can_manage_curation (curator+super)
--     · sales_admin / reviewer 는 어느 쪽 권한도 없으므로 errcode 42501 (403)
--  3) reviewer 는 메타 수정/일반 승인 가능, 강제 승인(force)은 content+super 만.
--  4) admin_recent_action_log 에 대상 곡 제목 포함(누가/언제/어떤 곡/무엇을).
--
-- 본문이 큰/여러 마이그레이션에 흩어진 함수는 "rename → _impl + 얇은 가드 래퍼" 방식으로
-- 본문 복제 없이 가드만 강화한다. _impl 은 authenticated/public 실행권한을 회수하여
-- security definer 래퍼(소유자 컨텍스트)를 통해서만 호출되도록 한다.

-- =====================================================================
-- helper: rename original → _impl (한 번만), 그리고 _impl 실행권한 회수
-- =====================================================================

-- ---- 정산 생성 (date, boolean) -------------------------------------
do $$ begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
             where n.nspname='public' and p.proname='admin_generate_monthly_settlement')
     and not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
             where n.nspname='public' and p.proname='_admin_generate_monthly_settlement_impl') then
    alter function public.admin_generate_monthly_settlement(date, boolean) rename to _admin_generate_monthly_settlement_impl;
  end if;
end $$;
revoke execute on function public._admin_generate_monthly_settlement_impl(date, boolean) from public, authenticated;

create or replace function public.admin_generate_monthly_settlement(p_month date, p_dry_run boolean default true)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v jsonb;
begin
  if not public.is_super_admin() then raise exception '정산 생성은 super_admin 만 가능합니다' using errcode='42501'; end if;
  v := public._admin_generate_monthly_settlement_impl(p_month, p_dry_run);
  if not coalesce(p_dry_run, true) then
    insert into public.admin_action_log(actor_user_id, action, detail)
    values (auth.uid(), 'settlement_generate', jsonb_build_object('month', p_month));
  end if;
  return v;
end; $$;
grant execute on function public.admin_generate_monthly_settlement(date, boolean) to authenticated;

-- ---- 정산 finalize (uuid) ------------------------------------------
do $$ begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
             where n.nspname='public' and p.proname='admin_finalize_settlement')
     and not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
             where n.nspname='public' and p.proname='_admin_finalize_settlement_impl') then
    alter function public.admin_finalize_settlement(uuid) rename to _admin_finalize_settlement_impl;
  end if;
end $$;
revoke execute on function public._admin_finalize_settlement_impl(uuid) from public, authenticated;

create or replace function public.admin_finalize_settlement(p_settlement_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v jsonb;
begin
  if not public.is_super_admin() then raise exception '정산 확정(finalize)은 super_admin 만 가능합니다' using errcode='42501'; end if;
  v := public._admin_finalize_settlement_impl(p_settlement_id);
  insert into public.admin_action_log(actor_user_id, action, target_id, detail)
  values (auth.uid(), 'settlement_finalize', p_settlement_id, v);
  return v;
end; $$;
grant execute on function public.admin_finalize_settlement(uuid) to authenticated;

-- ---- 정산 지급 완료 (uuid, text) -----------------------------------
do $$ begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
             where n.nspname='public' and p.proname='admin_mark_settlement_paid')
     and not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
             where n.nspname='public' and p.proname='_admin_mark_settlement_paid_impl') then
    alter function public.admin_mark_settlement_paid(uuid, text) rename to _admin_mark_settlement_paid_impl;
  end if;
end $$;
revoke execute on function public._admin_mark_settlement_paid_impl(uuid, text) from public, authenticated;

create or replace function public.admin_mark_settlement_paid(p_settlement_id uuid, p_payout_memo text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v jsonb;
begin
  if not public.is_super_admin() then raise exception '정산 지급 완료 처리는 super_admin 만 가능합니다' using errcode='42501'; end if;
  v := public._admin_mark_settlement_paid_impl(p_settlement_id, p_payout_memo);
  insert into public.admin_action_log(actor_user_id, action, target_id, detail)
  values (auth.uid(), 'settlement_mark_paid', p_settlement_id, jsonb_build_object('memo', nullif(btrim(coalesce(p_payout_memo,'')),'')));
  return v;
end; $$;
grant execute on function public.admin_mark_settlement_paid(uuid, text) to authenticated;

-- ---- 정산 보류 (uuid, text) ----------------------------------------
do $$ begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
             where n.nspname='public' and p.proname='admin_mark_settlement_held')
     and not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
             where n.nspname='public' and p.proname='_admin_mark_settlement_held_impl') then
    alter function public.admin_mark_settlement_held(uuid, text) rename to _admin_mark_settlement_held_impl;
  end if;
end $$;
revoke execute on function public._admin_mark_settlement_held_impl(uuid, text) from public, authenticated;

create or replace function public.admin_mark_settlement_held(p_settlement_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v jsonb;
begin
  if not public.is_super_admin() then raise exception '정산 보류 처리는 super_admin 만 가능합니다' using errcode='42501'; end if;
  v := public._admin_mark_settlement_held_impl(p_settlement_id, p_reason);
  insert into public.admin_action_log(actor_user_id, action, target_id, detail)
  values (auth.uid(), 'settlement_mark_held', p_settlement_id, jsonb_build_object('reason', btrim(coalesce(p_reason,''))));
  return v;
end; $$;
grant execute on function public.admin_mark_settlement_held(uuid, text) to authenticated;

-- ---- 정산 목록/상세 (조회) = super_admin 전용 (본문 재정의) ----------
create or replace function public.admin_settlement_list(
  p_month date default null, p_status text default null, p_search text default null)
returns table(
  id uuid, settlement_month date, artist_user_id uuid, artist_nickname text, artist_email text,
  gross_settlement_amount bigint, company_fee_amount bigint, sales_agent_fee_amount bigint,
  artist_net_settlement bigint, previous_carried_amount bigint, total_settlement_amount bigint,
  meets_min_payout boolean, withholding_tax_amount bigint, final_payout_amount bigint,
  carried_over_amount bigint, status text, finalized_at timestamptz, paid_at timestamptz, created_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare v_pattern text := case when p_search is null or length(btrim(p_search))=0 then null else '%' || btrim(p_search) || '%' end;
begin
  if not public.is_super_admin() then raise exception '정산 목록 조회는 super_admin 만 가능합니다' using errcode='42501'; end if;
  return query
  select s.id, s.settlement_month, s.artist_user_id,
    coalesce(u.nickname, '')::text, coalesce(au.email::text, '')::text,
    s.gross_settlement_amount, s.company_fee_amount, s.sales_agent_fee_amount,
    s.artist_net_settlement, s.previous_carried_amount, s.total_settlement_amount,
    s.meets_min_payout, s.withholding_tax_amount, s.final_payout_amount, s.carried_over_amount,
    s.status, s.finalized_at, s.paid_at, s.created_at
  from public.artist_settlements s
  join public.users u on u.id = s.artist_user_id
  left join auth.users au on au.id = s.artist_user_id
  where (p_month is null or s.settlement_month = p_month)
    and (p_status is null or s.status = p_status)
    and (v_pattern is null or coalesce(u.nickname, '') ilike v_pattern or coalesce(au.email::text, '') ilike v_pattern)
  order by s.settlement_month desc, s.created_at desc;
end; $$;
grant execute on function public.admin_settlement_list(date, text, text) to authenticated;

create or replace function public.admin_settlement_detail(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_result jsonb;
begin
  if not public.is_super_admin() then raise exception '정산 상세 조회는 super_admin 만 가능합니다' using errcode='42501'; end if;
  select jsonb_build_object(
    'settlement', to_jsonb(s.*),
    'artist', jsonb_build_object('nickname', u.nickname, 'email', au.email, 'artist_name', ap.artist_name),
    'policy', to_jsonb(p.*),
    'items', (select coalesce(jsonb_agg(jsonb_build_object(
        'track_code', i.track_code, 'track_title', i.track_title,
        'stream_count', i.stream_count, 'pool_revenue_share', i.pool_revenue_share
      ) order by i.pool_revenue_share desc), '[]'::jsonb)
      from public.settlement_items i where i.settlement_id = s.id)
  ) into v_result
  from public.artist_settlements s
  join public.users u on u.id = s.artist_user_id
  left join auth.users au on au.id = s.artist_user_id
  left join public.artist_profiles ap on ap.user_id = s.artist_user_id
  left join public.settlement_policies p on p.id = s.policy_id
  where s.id = p_id;
  return v_result;
end; $$;
grant execute on function public.admin_settlement_detail(uuid) to authenticated;

-- =====================================================================
-- 2) AI 큐레이션 핵심 진입 RPC — 영역별 가드 래퍼
--    매크로처럼 동일 패턴 반복(모두 returns jsonb).
-- =====================================================================

-- [content] AI 검수/메타 목록
do $$ begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='admin_list_ai_curation')
     and not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='_admin_list_ai_curation_impl') then
    alter function public.admin_list_ai_curation(text, int, int) rename to _admin_list_ai_curation_impl;
  end if;
end $$;
revoke execute on function public._admin_list_ai_curation_impl(text, int, int) from public, authenticated;
create or replace function public.admin_list_ai_curation(p_filter text default 'all', p_limit int default 100, p_offset int default 0)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not public.can_manage_tracks() then raise exception 'AI 검수/메타 영역은 content_admin / super_admin 만 접근할 수 있습니다' using errcode='42501'; end if;
  return public._admin_list_ai_curation_impl(p_filter, p_limit, p_offset);
end; $$;
grant execute on function public.admin_list_ai_curation(text, int, int) to authenticated;

-- [content] 위반/검토 후보
do $$ begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='admin_list_unified_violations')
     and not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='_admin_list_unified_violations_impl') then
    alter function public.admin_list_unified_violations(int) rename to _admin_list_unified_violations_impl;
  end if;
end $$;
revoke execute on function public._admin_list_unified_violations_impl(int) from public, authenticated;
create or replace function public.admin_list_unified_violations(p_limit int default 200)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not public.can_manage_tracks() then raise exception 'AI 검토 영역은 content_admin / super_admin 만 접근할 수 있습니다' using errcode='42501'; end if;
  return public._admin_list_unified_violations_impl(p_limit);
end; $$;
grant execute on function public.admin_list_unified_violations(int) to authenticated;

-- [content] Guardrail 대시보드
do $$ begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='admin_guardrail_dashboard')
     and not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='_admin_guardrail_dashboard_impl') then
    alter function public.admin_guardrail_dashboard() rename to _admin_guardrail_dashboard_impl;
  end if;
end $$;
revoke execute on function public._admin_guardrail_dashboard_impl() from public, authenticated;
create or replace function public.admin_guardrail_dashboard()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not public.can_manage_tracks() then raise exception 'Guardrail 영역은 content_admin / super_admin 만 접근할 수 있습니다' using errcode='42501'; end if;
  return public._admin_guardrail_dashboard_impl();
end; $$;
grant execute on function public.admin_guardrail_dashboard() to authenticated;

-- [content] 고위험 검수
do $$ begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='admin_list_high_risk_tracks')
     and not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='_admin_list_high_risk_tracks_impl') then
    alter function public.admin_list_high_risk_tracks(int) rename to _admin_list_high_risk_tracks_impl;
  end if;
end $$;
revoke execute on function public._admin_list_high_risk_tracks_impl(int) from public, authenticated;
create or replace function public.admin_list_high_risk_tracks(p_limit int default 200)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not public.can_manage_tracks() then raise exception '고위험 검수 영역은 content_admin / super_admin 만 접근할 수 있습니다' using errcode='42501'; end if;
  return public._admin_list_high_risk_tracks_impl(p_limit);
end; $$;
grant execute on function public.admin_list_high_risk_tracks(int) to authenticated;

-- [content] 전체 재검수 큐
do $$ begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='admin_rereview_queue')
     and not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='_admin_rereview_queue_impl') then
    alter function public.admin_rereview_queue(text, int) rename to _admin_rereview_queue_impl;
  end if;
end $$;
revoke execute on function public._admin_rereview_queue_impl(text, int) from public, authenticated;
create or replace function public.admin_rereview_queue(p_filter text default 'needs_re_review', p_limit int default 200)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not public.can_manage_tracks() then raise exception '재검수 영역은 content_admin / super_admin 만 접근할 수 있습니다' using errcode='42501'; end if;
  return public._admin_rereview_queue_impl(p_filter, p_limit);
end; $$;
grant execute on function public.admin_rereview_queue(text, int) to authenticated;

-- [content] 임베딩 검증 목록
do $$ begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='admin_list_embedding_review_tracks')
     and not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='_admin_list_embedding_review_tracks_impl') then
    alter function public.admin_list_embedding_review_tracks(text, text, int) rename to _admin_list_embedding_review_tracks_impl;
  end if;
end $$;
revoke execute on function public._admin_list_embedding_review_tracks_impl(text, text, int) from public, authenticated;
create or replace function public.admin_list_embedding_review_tracks(p_filter text default 'all', p_model text default 'openl3', p_limit int default 150)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not public.can_manage_tracks() then raise exception '임베딩 검증 영역은 content_admin / super_admin 만 접근할 수 있습니다' using errcode='42501'; end if;
  return public._admin_list_embedding_review_tracks_impl(p_filter, p_model, p_limit);
end; $$;
grant execute on function public.admin_list_embedding_review_tracks(text, text, int) to authenticated;

-- [curation] 운영 성과(재생/스킵 통계)
do $$ begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='admin_play_event_stats')
     and not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='_admin_play_event_stats_impl') then
    alter function public.admin_play_event_stats(int) rename to _admin_play_event_stats_impl;
  end if;
end $$;
revoke execute on function public._admin_play_event_stats_impl(int) from public, authenticated;
create or replace function public.admin_play_event_stats(p_days int default 30)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not public.can_manage_curation() then raise exception '운영 성과 영역은 curator_admin / super_admin 만 접근할 수 있습니다' using errcode='42501'; end if;
  return public._admin_play_event_stats_impl(p_days);
end; $$;
grant execute on function public.admin_play_event_stats(int) to authenticated;

-- [curation] Playlist Flow 요약
do $$ begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='admin_playlist_flow_summary')
     and not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='_admin_playlist_flow_summary_impl') then
    alter function public.admin_playlist_flow_summary() rename to _admin_playlist_flow_summary_impl;
  end if;
end $$;
revoke execute on function public._admin_playlist_flow_summary_impl() from public, authenticated;
create or replace function public.admin_playlist_flow_summary()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not public.can_manage_curation() then raise exception 'Playlist Flow 영역은 curator_admin / super_admin 만 접근할 수 있습니다' using errcode='42501'; end if;
  return public._admin_playlist_flow_summary_impl();
end; $$;
grant execute on function public.admin_playlist_flow_summary() to authenticated;

-- [curation] 자동 재배치 제안 목록
do $$ begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='admin_list_reorder_proposals')
     and not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='_admin_list_reorder_proposals_impl') then
    alter function public.admin_list_reorder_proposals() rename to _admin_list_reorder_proposals_impl;
  end if;
end $$;
revoke execute on function public._admin_list_reorder_proposals_impl() from public, authenticated;
create or replace function public.admin_list_reorder_proposals()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not public.can_manage_curation() then raise exception '자동 재배치 영역은 curator_admin / super_admin 만 접근할 수 있습니다' using errcode='42501'; end if;
  return public._admin_list_reorder_proposals_impl();
end; $$;
grant execute on function public.admin_list_reorder_proposals() to authenticated;

-- [curation] 사업자 반응 요약
do $$ begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='admin_business_skip_summary')
     and not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='_admin_business_skip_summary_impl') then
    alter function public.admin_business_skip_summary() rename to _admin_business_skip_summary_impl;
  end if;
end $$;
revoke execute on function public._admin_business_skip_summary_impl() from public, authenticated;
create or replace function public.admin_business_skip_summary()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not public.can_manage_curation() then raise exception '사업자 반응 영역은 curator_admin / super_admin 만 접근할 수 있습니다' using errcode='42501'; end if;
  return public._admin_business_skip_summary_impl();
end; $$;
grant execute on function public.admin_business_skip_summary() to authenticated;

-- =====================================================================
-- 3) reviewer 메타 수정 가능 + 강제 승인은 content+super 만
--    (본문은 0188 과 동일, 상단 가드만 can_review_tracks 로 완화하고
--     p_force 사용 시 can_manage_tracks 추가 요구)
-- =====================================================================
create or replace function public.admin_update_track_metadata_and_approve(
  p_track_id uuid,
  p_use_ai boolean default false,
  p_genre_tags text[] default null, p_mood_tags text[] default null, p_business_type_tags text[] default null,
  p_vocal_type text default null, p_dayparts text[] default null, p_language text default null, p_tempo_feel text default null,
  p_approve boolean default true, p_immediate boolean default null, p_force boolean default false)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid uuid := auth.uid(); v_rs text; v_src text;
  v_decl text[]; v_hard text[]; v_qpass boolean; v_lufs numeric;
  v_blocked text[] := '{}'; v_warn text[] := '{}'; v_approved boolean := false; v_note text;
  v_diff jsonb; v_meta jsonb; v_mismatch numeric; v_flags text[];
begin
  if not public.can_review_tracks() then raise exception '메타 수정/승인은 reviewer / content_admin / super_admin 만 가능합니다' using errcode='42501'; end if;
  if p_force and not public.can_manage_tracks() then raise exception '강제 승인(차단 사유 무시)은 content_admin / super_admin 만 가능합니다' using errcode='42501'; end if;
  select release_status, source_type into v_rs, v_src from public.tracks where id = p_track_id;
  if v_rs is null then raise exception 'track not found'; end if;

  if p_use_ai then
    v_diff := public.admin_apply_ai_metadata_and_recompute(p_track_id, '{"auto_resolve":false}'::jsonb);
  else
    perform public.admin_update_track_tags(p_track_id, p_genre_tags, p_mood_tags, p_business_type_tags, p_vocal_type, p_dayparts, p_language, p_tempo_feel);
  end if;

  select array_remove(array_agg(public._ai_tag_to_store_key(tag)), null) into v_decl
    from unnest(coalesce((select business_type_tags from public.tracks where id = p_track_id), '{}')) tag;
  select array_agg(distinct f.store_key) into v_hard from public.track_guardrail_flags f
    where f.track_id = p_track_id and f.severity = 'hard_block' and f.store_key = any(coalesce(v_decl, '{}'));
  if v_hard is not null then
    v_blocked := v_blocked || format('등록 매장 금지규칙(hard_block): %s', (select string_agg(public._store_label(s), ', ') from unnest(v_hard) s));
    if exists (select 1 from unnest(v_hard) s where s in ('hospital','kids_cafe','yoga','dog_cafe')) then
      v_warn := v_warn || '민감 매장(병원/키즈카페/요가 등) 차단 — 승인 시 각별히 주의하세요';
    end if;
  end if;
  select passed_quality_check, integrated_lufs into v_qpass, v_lufs
    from public.track_audio_quality where track_id = p_track_id order by analyzed_at desc limit 1;
  if v_qpass is false then v_blocked := v_blocked || 'LUFS/품질 검사 미달'; end if;

  if p_approve then
    if v_src <> 'artist_upload' or v_rs not in ('submitted','review_pending','changes_requested') then
      v_note := format('현재 상태(%s)에서는 승인을 적용하지 않습니다 — 메타데이터만 수정되었습니다.', v_rs);
    elsif array_length(v_blocked, 1) is not null and not p_force then
      v_note := '차단 사유가 있어 승인하지 않았습니다. 메타 수정 후 다시 시도하거나 강제 승인하세요.';
    else
      begin
        perform public.admin_approve_artist_release(p_track_id, p_immediate);
        v_approved := true;
      exception when others then
        v_blocked := v_blocked || ('승인 실패: ' || SQLERRM);
      end;
    end if;
  end if;

  select coalesce(mismatch_score, 0) into v_mismatch from public.track_ai_metadata where track_id = p_track_id;
  select array_agg(distinct flag_type) into v_flags from public.track_rereview_flags where track_id = p_track_id and status = 'open';
  select jsonb_build_object('genre_tags', genre_tags, 'mood_tags', mood_tags, 'business_type_tags', business_type_tags,
    'vocal_type', vocal_type, 'recommended_dayparts', recommended_dayparts, 'tempo_feel', tempo_feel) into v_meta
    from public.tracks where id = p_track_id;

  if v_approved then
    insert into public.admin_action_log(actor_user_id, action, target_id, detail)
    values (v_uid, case when p_force then 'track_force_approve' else 'track_approve' end, p_track_id, jsonb_build_object('forced', p_force));
  end if;

  return jsonb_build_object(
    'ok', true, 'approved', v_approved,
    'release_status', (select release_status from public.tracks where id = p_track_id),
    'blocked_reasons', to_jsonb(v_blocked), 'warnings', to_jsonb(v_warn),
    'guardrail_hard_declared', to_jsonb(coalesce(v_hard, '{}')),
    'mismatch_score', round(v_mismatch, 2), 'lufs', v_lufs,
    'open_flags', to_jsonb(coalesce(v_flags, '{}')),
    'updated_metadata', v_meta, 'note', v_note, 'recompute_diff', v_diff);
end; $$;
grant execute on function public.admin_update_track_metadata_and_approve(uuid, boolean, text[], text[], text[], text, text[], text, text, boolean, boolean, boolean) to authenticated;

-- =====================================================================
-- 4) admin_recent_action_log — 대상 곡 제목 포함(누가/언제/어떤 곡/무엇을)
-- =====================================================================
create or replace function public.admin_recent_action_log(p_limit int default 100)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v jsonb;
begin
  if not public.can_manage_admins() then raise exception 'super_admin only' using errcode='42501'; end if;
  select coalesce(jsonb_agg(row_to_json(x) order by x.created_at desc), '[]'::jsonb) into v from (
    select l.id, l.action, l.target_email, l.target_id, l.detail, l.created_at,
      (select email from auth.users au where au.id = l.actor_user_id) as actor_email,
      (select t.title from public.tracks t where t.id = l.target_id) as target_title
    from public.admin_action_log l order by l.created_at desc limit greatest(1, p_limit)) x;
  return v;
end; $$;
grant execute on function public.admin_recent_action_log(int) to authenticated;
