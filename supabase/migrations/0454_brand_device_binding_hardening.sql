-- 0454 — BRAND-PLAYER-PREVIEW-QA-1 · Trusted Store Device Binding 하드닝 (Test 전용, 미적용 상태)
--
-- 상태: 이 마이그레이션은 아직 어떤 DB 에도 적용되지 않았다(Test 포함). 적용 + RLS/RPC 인증은
--       Test Supabase 접근이 가능한 환경에서 수행해야 한다. Production 적용 금지.
--
-- 배경: 브랜드 플레이어 세션은 이미 brand_player_sessions(0407)에 존재한다 —
--   session_token(원문)의 sha256 hash 만 저장, user_id=auth.uid() 로 발급, brand/enterprise 연결.
--   현재 클라이언트는 이 토큰을 sessionStorage 에 두어 브라우저 재실행 시 소멸 → 매장 코드 재입력.
--
-- 보안 결함(영구화 전 반드시 교정):
--   1) get_brand_player_config 가 user_id=auth.uid() 를 검증하지 않음 → 토큰이 임의의 인증
--      사용자에게 동작(다른 User Binding 사용 가능).
--   2) revoke(연결 해제) 불가 — revoked_at 컬럼 없음.
--   3) 30일 만료가 반환만 되고 강제되지 않음 — expires_at 컬럼 없음.
--
-- 방침(저위험): 기존 brand_player_sessions 를 재사용(중복 테이블 금지). 기존 핵심 RPC
--   (verify_store_code / get_brand_player_config)를 blind 로 재작성하지 않고, 엄격 검증을 수행하는
--   ADDITIVE RPC(verify_brand_device_binding)를 추가한다. 클라이언트는 자동 진입 전 이 함수로
--   재검증한다. 컬럼(revoked_at/revoked_by/expires_at/device_label)만 additive 로 추가한다.
--   (get_brand_player_config 자체의 user_id 강제 검증은 현재 함수 본문 최신 상태를 Test 에서 확인한
--    뒤 별도 후속 마이그레이션으로 반영 — blind create-or-replace 로 최신 로직을 되돌리지 않기 위함.)

-- ── 컬럼 (additive; 스키마 drift 안전) ─────────────────────────────────────────
alter table public.brand_player_sessions add column if not exists revoked_at   timestamptz;
alter table public.brand_player_sessions add column if not exists revoked_by   uuid references auth.users(id) on delete set null;
alter table public.brand_player_sessions add column if not exists expires_at   timestamptz;
alter table public.brand_player_sessions add column if not exists device_label text;

create index if not exists idx_brand_sessions_user_active
  on public.brand_player_sessions (user_id, brand_id)
  where revoked_at is null;

-- ── 엄격 재검증 RPC (additive) ────────────────────────────────────────────────
-- 자동 진입 전 클라이언트가 호출. 토큰 원문 → hash 비교 + 소유자(auth.uid) + 미폐기 + 미만료 +
-- 브랜드 활성 검증. 성공 시 비민감 표시정보만 반환(내부 UUID/토큰/hash 미노출). last_seen 갱신.
create or replace function public.verify_brand_device_binding(p_brand_id uuid, p_session_token text)
 returns jsonb language plpgsql security definer set search_path = public, extensions
as $function$
declare v_hash text; v_row public.brand_player_sessions%rowtype; v_brand public.brand_accounts%rowtype;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;
  if coalesce(btrim(p_session_token), '') = '' then
    return jsonb_build_object('ok', false, 'reason', 'no_binding');
  end if;
  v_hash := encode(extensions.digest(p_session_token::bytea, 'sha256'), 'hex');
  select * into v_row from public.brand_player_sessions
   where brand_id = p_brand_id and session_token_hash = v_hash
   limit 1;
  if not found then return jsonb_build_object('ok', false, 'reason', 'invalid_binding'); end if;
  -- 소유자 검증: 현재 로그인 사용자의 binding 이어야 한다.
  if v_row.user_id is distinct from auth.uid() then
    return jsonb_build_object('ok', false, 'reason', 'not_owner');
  end if;
  if v_row.revoked_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'revoked');
  end if;
  if v_row.expires_at is not null and v_row.expires_at <= now() then
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;
  select * into v_brand from public.brand_accounts where id = p_brand_id and deleted_at is null and status = 'active';
  if not found then return jsonb_build_object('ok', false, 'reason', 'store_inactive'); end if;

  update public.brand_player_sessions set last_seen_at = now() where id = v_row.id;
  -- 비민감 표시정보만.
  return jsonb_build_object('ok', true,
    'brand_name', v_brand.name,
    'device_label', v_row.device_label,
    'expires_at', v_row.expires_at);
end;
$function$;

-- ── 자기 기기 연결 해제 (self-revoke) ─────────────────────────────────────────
-- 클라이언트는 세션 id 를 모르므로 토큰으로 폐기. 반드시 소유자 본인 binding 만 폐기.
create or replace function public.revoke_brand_device_by_token(p_brand_id uuid, p_session_token text)
 returns jsonb language plpgsql security definer set search_path = public, extensions
as $function$
declare v_hash text; v_id uuid;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'reason', 'not_authenticated'); end if;
  if coalesce(btrim(p_session_token), '') = '' then return jsonb_build_object('ok', false, 'reason', 'no_binding'); end if;
  v_hash := encode(extensions.digest(p_session_token::bytea, 'sha256'), 'hex');
  update public.brand_player_sessions
     set revoked_at = now(), revoked_by = auth.uid()
   where brand_id = p_brand_id and session_token_hash = v_hash and user_id = auth.uid() and revoked_at is null
   returning id into v_id;
  if v_id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  return jsonb_build_object('ok', true);
end;
$function$;

-- ── 내 기기 목록 (self) — 비민감 표시정보만 ───────────────────────────────────
create or replace function public.list_my_brand_devices()
 returns table(device_label text, brand_name text, last_seen_at timestamptz, created_at timestamptz, expires_at timestamptz, revoked boolean)
 language plpgsql stable security definer set search_path = public
as $function$
begin
  if auth.uid() is null then raise exception 'unauthorized'; end if;
  return query
  select s.device_label, b.name, s.last_seen_at, s.created_at, s.expires_at, (s.revoked_at is not null)
  from public.brand_player_sessions s
  join public.brand_accounts b on b.id = s.brand_id
  where s.user_id = auth.uid()
  order by s.last_seen_at desc nulls last, s.created_at desc;
end;
$function$;

-- ── Grants (fail-closed: revoke public/anon, authenticated 만) ─────────────────
revoke all on function public.verify_brand_device_binding(uuid, text) from public, anon;
revoke all on function public.revoke_brand_device_by_token(uuid, text) from public, anon;
revoke all on function public.list_my_brand_devices() from public, anon;
grant execute on function public.verify_brand_device_binding(uuid, text) to authenticated;
grant execute on function public.revoke_brand_device_by_token(uuid, text) to authenticated;
grant execute on function public.list_my_brand_devices() to authenticated;

comment on function public.verify_brand_device_binding(uuid, text) is 'BRAND-PLAYER-PREVIEW-QA-1: strict binding re-verification (owner + not-revoked + not-expired + active brand). Test-only, pending apply+certification.';
