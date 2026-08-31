-- ============================================================================
-- 0474_payapp_state_label_clarify.sql  (P1)
-- PayApp state=4 라벨 정합화 — 표시 전용, 분기 로직 무영향.
--
-- 배경: PayApp state=4 는 raw_payload에 pay_date + 승인번호(payauthcode) + 카드정보를
--   모두 가진 "실제 카드 결제완료" 건이다(0050/0052/0053에서 이미 paid 로 취급).
--   그런데 라벨이 '승인대기'로 표기돼 운영/CS가 미결제로 오독한다(이번 진단 때 실제
--   발생). '결제완료'로 정정한다.
--
-- 안전: 코드의 모든 상태 분기는 숫자 pay_state(4/64) 또는 order status('paid') 기준이며,
--   '승인대기'/'승인완료' 문자열에 분기하는 로직은 없다(전수 확인). 라벨은 표시 전용.
--   64('승인완료')는 의미 논쟁 여지가 있어 이번 범위에서 건드리지 않는다(4만 정정).
-- ============================================================================

create or replace function public._payapp_state_label(p_state integer)
returns text
language sql
immutable
set search_path to 'public'
as $$
  select case p_state
    when 1  then '요청수신'
    when 4  then '결제완료'      -- 정정: '승인대기' → '결제완료' (실결제)
    when 8  then '요청취소'
    when 9  then '승인취소'
    when 10 then '입금대기'
    when 32 then '요청취소'
    when 64 then '승인완료'
    when 70 then '환불'
    when 71 then '환불'
    else 'unknown'
  end;
$$;

-- 기존 저장 라벨도 정합화(표시 전용). state=4 이면서 옛 라벨('승인대기')인 것만.
-- payapp_webhook_events 에는 UPDATE 트리거가 없어 안전. (0049 등은 state=64 라벨만 참조)
update public.payapp_webhook_events
   set state_label = '결제완료'
 where pay_state = 4 and state_label = '승인대기';
