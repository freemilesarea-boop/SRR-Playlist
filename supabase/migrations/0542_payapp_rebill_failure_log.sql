-- 정기결제 2회차+ 승인 실패를 기록한다.
--
-- PayApp 은 정기결제 등록 시 받은 failurl 로 승인 실패를 통보한다(pay_state=99).
-- 그런데 우리는 failurl 을 React 화면(/payment/fail)으로 걸어놔서, PayApp 이 POST 해도
-- HTML 이 돌아갔다. 문서상 HTTP 200 + 본문 'SUCCESS' 가 아니면 재통보 후 포기이므로,
-- 실패가 한 건도 기록되지 않았다. 회원 16명이 "성공도 실패도 없이" 조용히 끊긴 이유다.
--
-- 결제 webhook(payapp_webhook_events)에 합치지 않는 이유:
--   그 테이블엔 트리거 3개가 걸려 있고 그중 _tg_payapp_ensure_payment_order 가
--   결제 주문을 만든다. 실패 건을 결제 파이프라인에 태우면 매출이 오염된다.
--
-- 적용 기록: 원격에 payapp_rebill_failure_log 로 적용 완료.
create table if not exists public.payapp_rebill_failures (
  id uuid primary key default gen_random_uuid(),
  -- 같은 실패가 재통보돼도 1행만 남긴다.
  event_key text not null unique,
  rebill_no text,
  mul_no text,
  pay_state int,
  -- PayApp 이 주는 실패 사유 문자열(ResultMsg 등).
  result_msg text,
  price int,
  goodname text,
  -- 가맹점 검증(userid/linkval)이 통과한 건만 true. 위조 노티를 구분한다.
  verified boolean not null default false,
  -- rebill_no 로 역추적한 구독/회원. 못 찾으면 null 로 두고 raw 로 조사한다.
  subscription_id uuid references public.subscriptions(id) on delete set null,
  user_id uuid references public.users(id) on delete set null,
  raw_payload jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_payapp_rebill_failures_rebill_no
  on public.payapp_rebill_failures (rebill_no);
create index if not exists idx_payapp_rebill_failures_subscription
  on public.payapp_rebill_failures (subscription_id, created_at desc);
create index if not exists idx_payapp_rebill_failures_created
  on public.payapp_rebill_failures (created_at desc);

-- service_role 만 접근한다(엣지 함수가 기록, 관리자 RPC 가 조회).
alter table public.payapp_rebill_failures enable row level security;
revoke all on public.payapp_rebill_failures from anon, authenticated;
