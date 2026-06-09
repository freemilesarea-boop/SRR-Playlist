-- 0326 — payment_orders 에 settlement_period_month + paid_at_source 추가 (X6.44)
--
-- 분석 보고서 Tier 2.3:
--   _internal_apply_payapp_paid_event 가 `paid_at = coalesce(po.paid_at,
--   p_paid_at)` 로 첫 값 보존 → 월말 결제 + 다음달 webhook 도착 시 KST
--   월 경계 모호. admin_generate_monthly_settlement 도
--   `coalesce(paid_at, created_at)` 로 비교 → paid_at NULL 시 created_at
--   (= INSERT 시각) 사용 → 다른 달로 갈 risk.
--
--   운영 데이터: 41건 paid 중 30건 (73%) 이 paid_at vs created_at 1분 이상
--   차이. 현재까지 KST 월 다른 케이스 0건이지만 webhook 지연 폭증 시 위험.
--
-- 조치:
--   1) payment_orders.settlement_period_month (date) — KST 기준 결제월
--      - trigger 로 BEFORE INSERT/UPDATE 시점에 자동 계산
--      - paid_at 기준만 사용 (NULL 이면 NULL — 정산 generate 에서 제외됨)
--      - 인덱스 (status, settlement_period_month)
--   2) payment_orders.paid_at_source (text) — audit 출처 식별
--      - 'payapp_webhook' / 'admin_force' / 'manual_sync' / 'unknown'
--   3) backfill — 기존 41건 paid row 자동 채움
--
-- 정책 보존:
--   - paid_at 컬럼은 그대로 (immutable after first set)
--   - admin_generate_monthly_settlement 의 변경은 별도 마이그레이션 (0327)

alter table public.payment_orders
  add column if not exists settlement_period_month date,
  add column if not exists paid_at_source text;

-- trigger: BEFORE INSERT/UPDATE 시 settlement_period_month 자동 계산
create or replace function public._set_payment_settlement_period_month()
returns trigger language plpgsql set search_path = public as $$
begin
  -- paid_at 기준 KST 월 (NULL safe)
  if NEW.paid_at is not null then
    NEW.settlement_period_month :=
      (date_trunc('month', NEW.paid_at at time zone 'Asia/Seoul'))::date;
  else
    NEW.settlement_period_month := null;
  end if;
  -- paid_at_source default
  if NEW.paid_at is not null and NEW.paid_at_source is null then
    NEW.paid_at_source := 'unknown';
  end if;
  return NEW;
end; $$;

drop trigger if exists trg_payment_orders_settlement_period_month on public.payment_orders;
create trigger trg_payment_orders_settlement_period_month
before insert or update of paid_at, paid_at_source
on public.payment_orders
for each row execute function public._set_payment_settlement_period_month();

create index if not exists payment_orders_settlement_period_idx
  on public.payment_orders (status, settlement_period_month)
  where status = 'paid';

-- backfill (trigger 가 paid_at UPDATE 시에만 작동하므로 명시적 backfill)
-- paid_at_source 는 기존 row 모두 'webhook_backfill' 로 표시 (감사 추적용)
update public.payment_orders
set settlement_period_month =
      (date_trunc('month', paid_at at time zone 'Asia/Seoul'))::date,
    paid_at_source = case
      when raw_response->>'source' = 'webhook' then 'payapp_webhook'
      when raw_response->>'force_activated' = 'true' then 'admin_force'
      else 'webhook_backfill'
    end
where status = 'paid' and paid_at is not null and settlement_period_month is null;
