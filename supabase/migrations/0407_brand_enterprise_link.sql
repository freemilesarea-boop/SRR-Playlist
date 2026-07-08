-- 0407 — Brand Player Refactor: Store Invite Code 기반 통합 (Brand Code 제거)
--
-- 목적:
--   사용자 입력 "브랜드 코드" 제거. 매장은 본사 Store Invite Code 만 입력 →
--   enterprise 조회 → 연결된 brand 조회 → player session 발급 → 브랜드 설정 로드.
--
-- 결정사항:
--   • 매장별 차등 없음 — 본사(Enterprise)/브랜드 단위 통합 플레이어.
--   • Brand ↔ Enterprise 1:1 (본사당 active brand 1개, unique).
--   • 브랜드 미연결이면 fallback 없음 → 'brand_not_linked' 에러.
--
-- 안전:
--   • additive. 기존 Enterprise/Store/정산/계약/ENT-DETAIL 무변경(읽기만).
--   • brand_accounts 0행 → 데이터 마이그레이션 없음.
--   • verify_brand_code 는 deprecate(권한 회수), 함수 자체는 보존.

-- 1) brand_accounts ↔ enterprise 링크
alter table public.brand_accounts add column if not exists enterprise_account_id uuid references public.enterprise_accounts(id) on delete set null;
-- 코드 미사용화 (사용자 입력 코드 제거)
alter table public.brand_accounts alter column code_hash drop not null;
-- 본사당 active(미삭제) 브랜드 1개
create unique index if not exists idx_brand_one_active_per_enterprise
  on public.brand_accounts (enterprise_account_id)
  where deleted_at is null and enterprise_account_id is not null;
create index if not exists idx_brand_accounts_enterprise on public.brand_accounts (enterprise_account_id);

-- 2) brand_player_sessions — 어느 본사/매장 재생인지 추적 (additive)
alter table public.brand_player_sessions add column if not exists enterprise_account_id uuid;

-- 3) admin_create_brand — 코드 생성 제거 + enterprise 연결(선택)
drop function if exists public.admin_create_brand(text, text, text);
create or replace function public.admin_create_brand(
  p_name text, p_industry_type text default null, p_description text default null,
  p_enterprise_account_id uuid default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  if coalesce(btrim(p_name),'') = '' then raise exception 'brand name required'; end if;
  if p_enterprise_account_id is not null
     and not exists (select 1 from public.enterprise_accounts where id = p_enterprise_account_id and deleted_at is null) then
    raise exception 'enterprise not found';
  end if;
  begin
    insert into public.brand_accounts (name, industry_type, description, created_by, enterprise_account_id)
    values (btrim(p_name), nullif(btrim(p_industry_type),''), nullif(btrim(p_description),''), auth.uid(), p_enterprise_account_id)
    returning id into v_id;
  exception when unique_violation then
    raise exception '이미 이 본사에 연결된 브랜드가 있습니다 (본사당 1개)';
  end;
  insert into public.brand_music_policies (brand_id) values (v_id);
  perform public._brand_audit(v_id, 'brand.create', jsonb_build_object('name', btrim(p_name), 'enterprise_account_id', p_enterprise_account_id));
  return jsonb_build_object('success', true, 'id', v_id);
end$$;
revoke execute on function public.admin_create_brand(text, text, text, uuid) from public, anon;
grant  execute on function public.admin_create_brand(text, text, text, uuid) to authenticated;

-- 4) 브랜드 ↔ 본사 연결/해제
create or replace function public.admin_set_brand_enterprise(p_brand_id uuid, p_enterprise_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  if not exists (select 1 from public.brand_accounts where id = p_brand_id and deleted_at is null) then
    raise exception 'brand not found';
  end if;
  if p_enterprise_id is not null
     and not exists (select 1 from public.enterprise_accounts where id = p_enterprise_id and deleted_at is null) then
    raise exception 'enterprise not found';
  end if;
  begin
    update public.brand_accounts set enterprise_account_id = p_enterprise_id where id = p_brand_id;
  exception when unique_violation then
    raise exception '이미 이 본사에 연결된 브랜드가 있습니다 (본사당 1개)';
  end;
  perform public._brand_audit(p_brand_id, 'brand.link_enterprise', jsonb_build_object('enterprise_account_id', p_enterprise_id));
  return jsonb_build_object('success', true, 'brand_id', p_brand_id, 'enterprise_account_id', p_enterprise_id);
end$$;
revoke execute on function public.admin_set_brand_enterprise(uuid, uuid) from public, anon;
grant  execute on function public.admin_set_brand_enterprise(uuid, uuid) to authenticated;

-- 5) admin_list_brands / admin_get_brand — 연결 본사 정보 포함
create or replace function public.admin_list_brands(p_include_deleted boolean default false)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  select coalesce(jsonb_agg(row_to_json(x) order by x.created_at desc), '[]'::jsonb) into v
  from (
    select b.id, b.name, b.status, b.industry_type, b.description,
           b.enterprise_account_id,
           (select ea.enterprise_name from public.enterprise_accounts ea where ea.id = b.enterprise_account_id) as enterprise_name,
           b.created_at, b.updated_at, b.deleted_at,
           (select count(*) from public.brand_media_assets m where m.brand_id=b.id and m.deleted_at is null and m.status='active') as active_media_count,
           (select count(*) from public.brand_media_assets m where m.brand_id=b.id and m.deleted_at is null) as total_media_count,
           (select max(s.last_seen_at) from public.brand_player_sessions s where s.brand_id=b.id) as last_seen_at,
           (select p.auto_generate_enabled from public.brand_music_policies p where p.brand_id=b.id) as auto_generate_enabled,
           (select array_length(p.preferred_genres,1) from public.brand_music_policies p where p.brand_id=b.id) as preferred_genre_count,
           (select array_length(p.blocked_genres,1) from public.brand_music_policies p where p.brand_id=b.id) as blocked_genre_count
    from public.brand_accounts b
    where p_include_deleted or b.deleted_at is null
  ) x;
  return v;
end$$;
revoke execute on function public.admin_list_brands(boolean) from public, anon;
grant  execute on function public.admin_list_brands(boolean) to authenticated;

create or replace function public.admin_get_brand(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  select jsonb_build_object(
    'brand', (select row_to_json(b) from (
        select ba.id, ba.name, ba.status, ba.industry_type, ba.description,
               ba.enterprise_account_id,
               (select ea.enterprise_name from public.enterprise_accounts ea where ea.id = ba.enterprise_account_id) as enterprise_name,
               (select ea.store_invite_code from public.enterprise_accounts ea where ea.id = ba.enterprise_account_id) as store_invite_code,
               ba.created_at, ba.updated_at, ba.deleted_at
        from public.brand_accounts ba where ba.id = p_id) b),
    'policy', (select row_to_json(p) from (
        select brand_id, preferred_genres, blocked_genres, preferred_moods, blocked_moods,
               energy_min, energy_max, vocal_policy, daypart_policy, auto_generate_enabled
        from public.brand_music_policies where brand_id = p_id) p),
    'media', (select coalesce(jsonb_agg(row_to_json(m) order by m.sort_order, m.created_at), '[]'::jsonb) from (
        select id, asset_type, title, image_url, display_duration_seconds, sort_order, starts_at, ends_at, status, created_at
        from public.brand_media_assets where brand_id = p_id and deleted_at is null) m)
  ) into v;
  if v->'brand' is null then raise exception 'brand not found'; end if;
  return v;
end$$;
revoke execute on function public.admin_get_brand(uuid) from public, anon;
grant  execute on function public.admin_get_brand(uuid) to authenticated;

-- 6) 신규 플레이어 진입: store_invite_code → enterprise → linked brand → session
create or replace function public.verify_store_code(p_store_code text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_ea public.enterprise_accounts%rowtype; v_brand public.brand_accounts%rowtype; v_token text; v_hash text;
begin
  if coalesce(btrim(p_store_code),'') = '' then
    return jsonb_build_object('success', false, 'error', 'empty_code');
  end if;
  select * into v_ea from public.enterprise_accounts
   where store_invite_code = btrim(p_store_code) and deleted_at is null;
  if not found then
    return jsonb_build_object('success', false, 'error', 'invalid_code');
  end if;

  select * into v_brand from public.brand_accounts
   where enterprise_account_id = v_ea.id and deleted_at is null and status = 'active'
   limit 1;
  if not found then
    -- fallback 금지 — 명확한 미연결 에러
    return jsonb_build_object('success', false, 'error', 'brand_not_linked');
  end if;

  v_token := encode(extensions.gen_random_bytes(24), 'hex');
  v_hash := encode(extensions.digest(v_token::bytea, 'sha256'), 'hex');
  insert into public.brand_player_sessions (brand_id, enterprise_account_id, session_token_hash, user_id, last_seen_at)
  values (v_brand.id, v_ea.id, v_hash, auth.uid(), now());

  perform public._brand_audit(v_brand.id, 'brand.verify_store_ok', jsonb_build_object('enterprise_account_id', v_ea.id, 'user', auth.uid()));
  return jsonb_build_object('success', true, 'brand_id', v_brand.id, 'store_label', v_ea.enterprise_name,
    'session_token', v_token, 'expires_at', (now() + interval '30 days'));
end$$;
revoke execute on function public.verify_store_code(text) from public, anon;
grant  execute on function public.verify_store_code(text) to authenticated;

-- 7) 기존 브랜드코드 진입 deprecate (권한 회수, 함수 보존)
revoke execute on function public.verify_brand_code(text) from authenticated;

-- Diagnostics
do $$
declare v_col boolean; v_fn boolean;
begin
  select exists(select 1 from information_schema.columns where table_schema='public' and table_name='brand_accounts' and column_name='enterprise_account_id') into v_col;
  select exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='verify_store_code') into v_fn;
  raise notice '0407 — enterprise link col: %, verify_store_code: %', v_col, v_fn;
end$$;
