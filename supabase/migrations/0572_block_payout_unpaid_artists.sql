-- 0572 — 요금 미납 아티스트에게는 정산을 지급하지 않는다.
--
-- 운영 결정(2026-11-28): "요금 미납으로 아티스트 음원 등록 및 정산을 받을 수 없습니다."
--   발매 음원은 계속 서비스되고 정산 금액도 평소처럼 계산·이월된다. 다만 미납 상태인 동안에는
--   어떤 경로(관리자 지급 처리·일괄 처리·직접 수정)로도 '지급 완료(paid)' 로 바꿀 수 없다.
--   미납분을 결제하면(0571 복구 트리거가 artist_unpaid_downgrades.restored_at 을 채움) 바로 다시 지급할 수 있다.
--
-- "미납" 의 기준은 0571 과 같다 — 결제가 끊겨 무료로 전환된 기록이 열려 있는 아티스트.

create or replace function public.artist_is_unpaid(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $function$
  select exists (
    select 1 from public.artist_unpaid_downgrades d
     where d.user_id = p_user_id and d.restored_at is null
  );
$function$;
revoke all on function public.artist_is_unpaid(uuid) from public, anon;
grant execute on function public.artist_is_unpaid(uuid) to authenticated;

create or replace function public._block_payout_unpaid_artist()
returns trigger
language plpgsql
set search_path = public
as $function$
begin
  if NEW.status = 'paid' and OLD.status is distinct from 'paid'
     and public.artist_is_unpaid(NEW.artist_user_id) then
    raise exception '요금 미납 아티스트에게는 정산을 지급할 수 없습니다 (settlement=%)', NEW.id
      using errcode = '42501', hint = 'artist_unpaid';
  end if;
  return NEW;
end;
$function$;

drop trigger if exists trg_block_payout_unpaid_artist on public.artist_settlements;
create trigger trg_block_payout_unpaid_artist
  before update of status on public.artist_settlements
  for each row execute function public._block_payout_unpaid_artist();
