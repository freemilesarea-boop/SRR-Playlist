-- 0573 — 아티스트 계약서 자동 발행·음원 발매 신청 게이트를 중앙 결제 판정과 맞춘다.
--
-- 2026-11-28 사례: 아티스트 승인 후 요금제 화면에서 매장(business) 이용권을 결제한 회원.
--   artist_has_paid_access() = true, 대시보드도 '결제 완료' 로 표시하는데
--   ensure_artist_contract_for_user 는 membership_tier = 'individual' 만 받아
--   'not paid (tier=business)' → "계약서 자동 발행 실패" 로 막혔다.
--   submit_artist_release 도 같은 조건이라 계약 뒤 발매 신청에서 다시 막힌다.
--   (관리자 발행 admin_create_artist_contract 는 이미 individual/business 를 받는다)
--
-- 결제 여부는 artist_has_paid_access(uid) 를 기준으로 하고, 기존 조건(tier=individual)도 그대로 통과시킨다.

do $$
declare
  v_def text;
  v_new text;
begin
  -- 1) 계약서 자동 발행
  v_def := pg_get_functiondef('public.ensure_artist_contract_for_user()'::regprocedure);
  if v_def not like '%artist_has_paid_access(v_uid)%' then
    v_new := replace(v_def,
      $o$if coalesce(v_tier, 'free') <> 'individual' then$o$,
      $n$if coalesce(v_tier, 'free') <> 'individual' and not public.artist_has_paid_access(v_uid) then$n$);
    if v_new = v_def then raise exception '0573: ensure_artist_contract_for_user tier check not found'; end if;
    execute v_new;
  end if;

  -- 2) 음원 발매 신청
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'submit_artist_release';
  if v_def is null then raise exception '0573: submit_artist_release not found'; end if;
  if v_def not like '%artist_has_paid_access(u.id)%' then
    v_new := replace(v_def,
      $o$and u.membership_tier = 'individual' and u.contract_status = 'signed'$o$,
      $n$and (u.membership_tier = 'individual' or public.artist_has_paid_access(u.id)) and u.contract_status = 'signed'$n$);
    if v_new = v_def then raise exception '0573: submit_artist_release tier check not found'; end if;
    execute v_new;
  end if;
end $$;
