-- 0517: 운영자 본인 계정을 매장 장애 감시에서 제외
--
-- freemilesarea@gmail.com 은 실매장이 아니라 운영자 본인 계정이라
-- 상시 재생하지 않는다. 감시 대상에 남겨두면 오프라인 오탐이 계속 열린다.
-- (프로덕션에는 이미 적용돼 있고, 이 파일은 마이그레이션 이력을 맞추기 위한 것)

insert into public.brand_player_monitoring_exempt (store_user_id, label, reason)
select u.id, 'freemilesarea@gmail.com',
       '운영자 본인 계정 — 실매장 아님, 상시 재생하지 않음'
  from auth.users u
 where u.email = 'freemilesarea@gmail.com'
on conflict (store_user_id) do update
  set label = excluded.label, reason = excluded.reason;
