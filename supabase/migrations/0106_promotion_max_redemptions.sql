-- 0106_promotion_max_redemptions.sql
-- 프로모션 코드 선착순 N명 제한
--   - promotion_codes.max_redemptions (null=무제한)
--   - validate_promotion_code: 사용횟수 >= max 이면 usage_limit_reached, remaining 반환
--   - redeem_promotion_code: row lock 으로 동시 결제 race condition 직렬화 + insert
--   - admin RPC: 생성 시 max_redemptions 입력, 목록에 max_redemptions 노출
-- 정책: 이미 사용한 회원 기록 유지. max 를 사용 수보다 작게 줄여도 신규 사용만 차단.

alter table public.promotion_codes
  add column if not exists max_redemptions integer;

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
  v_count int;
  v_remaining int;
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

  -- 선착순 제한 — 서버 기준 count (프론트 신뢰 X)
  v_remaining := null;
  if c.max_redemptions is not null then
    select count(*) into v_count from public.promotion_code_redemptions r where r.promotion_code_id = c.id;
    if v_count >= c.max_redemptions then
      return jsonb_build_object('valid', false, 'reason', 'usage_limit_reached');
    end if;
    v_remaining := greatest(c.max_redemptions - v_count, 0);
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
    'final_amount', v_final,
    'max_redemptions', c.max_redemptions,
    'remaining', v_remaining
  );
end;
$function$;

grant execute on function public.validate_promotion_code(text, text) to anon, authenticated;

-- 동시성 안전 슬롯 예약 + 사용기록 insert (service_role/EF 전용; anon/authenticated 미부여)
create or replace function public.redeem_promotion_code(
  p_promotion_code_id uuid,
  p_user_id uuid,
  p_plan_type text,
  p_original_amount integer,
  p_discount_amount integer,
  p_final_amount integer)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_max int;
  v_deleted timestamptz;
  v_active boolean;
  v_count int;
  v_id uuid;
begin
  -- 코드 row 잠금으로 동시 결제 race condition 직렬화
  select max_redemptions, deleted_at, is_active
    into v_max, v_deleted, v_active
    from public.promotion_codes
    where id = p_promotion_code_id
    for update;
  if not found or v_deleted is not null or v_active is not true then
    return null;
  end if;
  if v_max is not null then
    select count(*) into v_count from public.promotion_code_redemptions
      where promotion_code_id = p_promotion_code_id;
    if v_count >= v_max then
      return null;
    end if;
  end if;
  insert into public.promotion_code_redemptions
    (promotion_code_id, user_id, plan_type, original_amount, discount_amount, final_amount)
  values
    (p_promotion_code_id, p_user_id, p_plan_type, p_original_amount, p_discount_amount, p_final_amount)
  returning id into v_id;
  return v_id;
end;
$function$;

drop function if exists public.admin_create_promotion_code(text, text, text, text, integer, timestamptz, timestamptz, text);

create or replace function public.admin_create_promotion_code(
  p_code text, p_name text, p_target_plan text, p_discount_type text,
  p_discount_amount integer, p_starts_at timestamptz, p_ends_at timestamptz,
  p_note text, p_max_redemptions integer default null)
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
  if p_max_redemptions is not null and p_max_redemptions <= 0 then raise exception 'bad max_redemptions'; end if;
  insert into public.promotion_codes (code, name, target_plan, discount_type, discount_amount, starts_at, ends_at, note, max_redemptions, created_by)
  values (btrim(p_code), p_name, p_target_plan, p_discount_type, greatest(coalesce(p_discount_amount,0),0), p_starts_at, p_ends_at, p_note, p_max_redemptions, auth.uid())
  returning id into v_id;
  begin perform admin_log_operation('promotion','content','info','completed', format('create promo %s', p_code), jsonb_build_object('id', v_id), auth.uid(), v_id::text, null, null, null); exception when others then null; end;
  return v_id;
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
    'max_redemptions', pc.max_redemptions,
    'redemption_count', coalesce((select count(*) from public.promotion_code_redemptions r where r.promotion_code_id = pc.id), 0),
    'total_discount', coalesce((select sum(r.discount_amount) from public.promotion_code_redemptions r where r.promotion_code_id = pc.id), 0)
  ) order by pc.created_at desc), '[]'::jsonb)
  into v_result from public.promotion_codes pc;
  return v_result;
end; $function$;