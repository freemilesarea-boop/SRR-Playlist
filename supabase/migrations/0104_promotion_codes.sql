-- 0104_promotion_codes.sql
-- 프로모션 코드 시스템: 코드 발급/검증/사용기록 + 결제 연동 컬럼
-- 정책: 사용횟수 무제한, 같은 코드 여러 사용자 재사용 가능, soft delete(deleted_at),
--       기존 적용 구독 가격 보존(신규 적용만 차단), 서버에서 가격 재계산(프론트 신뢰 금지)

-- ============================================================
-- 1) 프로모션 코드 테이블
-- ============================================================
create table if not exists public.promotion_codes (
  id              uuid primary key default gen_random_uuid(),
  code            text not null,
  name            text,
  target_plan     text not null default 'all' check (target_plan in ('individual','business','all')),
  discount_type   text not null default 'fixed' check (discount_type in ('fixed','percent')),
  discount_amount integer not null default 0,
  starts_at       timestamptz,
  ends_at         timestamptz,
  is_active       boolean not null default true,
  created_by      uuid,
  created_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  note            text
);

-- 코드는 대소문자 무시 유니크 (살아있는 코드 기준)
create unique index if not exists promotion_codes_code_lower_uidx
  on public.promotion_codes (lower(code))
  where deleted_at is null;

-- ============================================================
-- 2) 프로모션 사용 기록 테이블 (무제한 / 재사용 허용)
-- ============================================================
create table if not exists public.promotion_code_redemptions (
  id                uuid primary key default gen_random_uuid(),
  promotion_code_id uuid not null references public.promotion_codes(id) on delete restrict,
  user_id           uuid,
  payment_order_id  uuid,
  subscription_id   uuid,
  plan_type         text,
  original_amount   integer,
  discount_amount   integer,
  final_amount      integer,
  redeemed_at       timestamptz not null default now()
);

create index if not exists promotion_code_redemptions_code_idx
  on public.promotion_code_redemptions (promotion_code_id);
create index if not exists promotion_code_redemptions_user_idx
  on public.promotion_code_redemptions (user_id);

-- ============================================================
-- 3) 결제/구독 테이블 컬럼 추가 (최소 변경)
-- ============================================================
alter table public.payment_orders
  add column if not exists promotion_code_id uuid,
  add column if not exists discount_amount integer not null default 0,
  add column if not exists original_amount integer,
  add column if not exists final_amount integer;

alter table public.subscriptions
  add column if not exists promotion_code_id uuid,
  add column if not exists discount_amount integer not null default 0,
  add column if not exists original_amount integer,
  add column if not exists current_amount integer;

-- ============================================================
-- 4) RLS: 두 테이블 모두 직접 select 금지 (RPC 경유만 허용)
-- ============================================================
alter table public.promotion_codes enable row level security;
alter table public.promotion_code_redemptions enable row level security;

drop policy if exists promotion_codes_no_select on public.promotion_codes;
create policy promotion_codes_no_select on public.promotion_codes for select using (false);

drop policy if exists promotion_code_redemptions_no_select on public.promotion_code_redemptions;
create policy promotion_code_redemptions_no_select on public.promotion_code_redemptions for select using (false);

-- ============================================================
-- 5) 검증 RPC (anon/authenticated 허용, 민감정보 미노출)
--    서버(EF)에서 가격을 재계산하기 위한 권위 함수
-- ============================================================
create or replace function public.validate_promotion_code(p_code text, p_plan_type text)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  c record;
  v_plan_price int;
  v_discount int;
  v_final int;
begin
  if p_code is null or length(btrim(p_code)) = 0 then
    return jsonb_build_object('valid', false, 'reason', 'empty');
  end if;
  select * into c from public.promotion_codes
    where lower(code) = lower(btrim(p_code)) and deleted_at is null
    limit 1;
  if c.id is null then
    return jsonb_build_object('valid', false, 'reason', 'invalid');
  end if;
  if not c.is_active then
    return jsonb_build_object('valid', false, 'reason', 'inactive');
  end if;
  if c.starts_at is not null and now() < c.starts_at then
    return jsonb_build_object('valid', false, 'reason', 'not_started');
  end if;
  if c.ends_at is not null and now() > c.ends_at then
    return jsonb_build_object('valid', false, 'reason', 'expired');
  end if;
  if c.target_plan <> 'all' and c.target_plan <> p_plan_type then
    return jsonb_build_object('valid', false, 'reason', 'plan_mismatch');
  end if;

  select price into v_plan_price from public.subscription_plans where plan_type = p_plan_type and is_active = true limit 1;
  if v_plan_price is null then
    return jsonb_build_object('valid', false, 'reason', 'plan_not_found');
  end if;

  if c.discount_type = 'percent' then
    v_discount := round(v_plan_price * (c.discount_amount::numeric / 100));
  else
    v_discount := c.discount_amount;
  end if;
  v_discount := least(greatest(v_discount, 0), v_plan_price);
  v_final := greatest(v_plan_price - v_discount, 0);

  return jsonb_build_object(
    'valid', true, 'reason', 'ok',
    'promotion_code_id', c.id, 'code', c.code, 'name', c.name,
    'discount_type', c.discount_type,
    'original_amount', v_plan_price,
    'discount_amount', v_discount,
    'final_amount', v_final
  );
end;
$function$;

grant execute on function public.validate_promotion_code(text, text) to anon, authenticated;

-- ============================================================
-- 6) 관리자 RPC (admin 전용)
-- ============================================================
create or replace function public.admin_create_promotion_code(
  p_code text, p_name text, p_target_plan text, p_discount_type text,
  p_discount_amount integer, p_starts_at timestamptz, p_ends_at timestamptz, p_note text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_id uuid;
begin
  if not _internal_is_admin_caller() then raise exception 'admin only'; end if;
  if p_code is null or length(btrim(p_code)) = 0 then raise exception 'code required'; end if;
  if p_target_plan not in ('individual','business','all') then raise exception 'bad target_plan'; end if;
  if p_discount_type not in ('fixed','percent') then raise exception 'bad discount_type'; end if;
  insert into public.promotion_codes (code, name, target_plan, discount_type, discount_amount, starts_at, ends_at, note, created_by)
  values (btrim(p_code), p_name, p_target_plan, p_discount_type, greatest(coalesce(p_discount_amount,0),0), p_starts_at, p_ends_at, p_note, auth.uid())
  returning id into v_id;
  begin perform admin_log_operation('promotion','content','info','completed', format('create promo %s', p_code), jsonb_build_object('id', v_id), auth.uid(), v_id::text, null, null, null); exception when others then null; end;
  return v_id;
end; $function$;

create or replace function public.admin_set_promotion_active(p_id uuid, p_active boolean)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not _internal_is_admin_caller() then raise exception 'admin only'; end if;
  update public.promotion_codes set is_active = p_active where id = p_id and deleted_at is null;
  return jsonb_build_object('ok', true, 'is_active', p_active);
end; $function$;

create or replace function public.admin_delete_promotion_code(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not _internal_is_admin_caller() then raise exception 'admin only'; end if;
  update public.promotion_codes set deleted_at = now(), is_active = false where id = p_id;
  return jsonb_build_object('ok', true);
end; $function$;

create or replace function public.admin_list_promotion_codes()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_result jsonb;
begin
  if not _internal_is_admin_caller() then raise exception 'admin only'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', pc.id, 'code', pc.code, 'name', pc.name, 'target_plan', pc.target_plan,
    'discount_type', pc.discount_type, 'discount_amount', pc.discount_amount,
    'starts_at', pc.starts_at, 'ends_at', pc.ends_at, 'is_active', pc.is_active,
    'deleted_at', pc.deleted_at, 'note', pc.note, 'created_at', pc.created_at,
    'redemption_count', coalesce((select count(*) from public.promotion_code_redemptions r where r.promotion_code_id = pc.id), 0),
    'total_discount', coalesce((select sum(r.discount_amount) from public.promotion_code_redemptions r where r.promotion_code_id = pc.id), 0)
  ) order by pc.created_at desc), '[]'::jsonb)
  into v_result from public.promotion_codes pc;
  return v_result;
end; $function$;
