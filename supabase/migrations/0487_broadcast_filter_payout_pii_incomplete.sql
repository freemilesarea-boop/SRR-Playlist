-- ============================================================================
-- 0487_broadcast_filter_payout_pii_incomplete.sql
-- 회원 메일 발송에 "정산 정보 미완비 아티스트" 수신자 필터 추가.
--
-- 배경: 계좌 인증(verification_status='verified')과 지급 요건(실명·주민등록번호·
--   원천징수 동의)이 별개라, 구 폼으로 계좌만 등록한 사용자는 verified 이면서도
--   정산금 지급이 보류된다. 실측 102건 중 24건이 이 상태이고 전부
--   2026-05-17~06-01 등록자(v2 PII 폼 도입 전)로 6월부터 방치돼 있었다.
--
--   이들에게 보완 안내 메일을 보내려면 수신자를 특정해야 하는데, 기존 필터는
--   search/plan/role/status 뿐이라 이 조건을 표현할 수 없었다. 24명을 회원
--   선택기에서 손으로 찾는 것은 현실적이지 않고 재현도 안 된다.
--
-- 조치: p_filter 에 payout_pii_incomplete=true 키를 추가한다.
--   정산 계좌는 있으나 artist_payout_account_ready() 가 false 인 회원으로 한정.
--   기존 필터 키(search/plan/role/status)와 함께 쓸 수 있고, 키가 없으면 무동작이라
--   기존 발송 동작은 완전히 그대로다.
--
-- 안전: 함수 1개 교체(additive 키). 발송 자체·수신거부·이력 로직 무변경.
-- ============================================================================

create or replace function public.admin_resolve_broadcast_recipients(
  p_recipient_mode text,
  p_filter jsonb default '{}'::jsonb,
  p_selected_user_ids uuid[] default '{}'::uuid[],
  p_email_kind text default 'notice'::text
)
returns table(user_id uuid, email text, nickname text)
language plpgsql stable security definer set search_path to 'public'
as $function$
begin
  if not exists (select 1 from public.users u where u.id = auth.uid() and u.role='admin') then
    raise exception 'admin only';
  end if;
  return query
  with base as (
    select m.id, m.email, m.nickname, m.withdrawn_at, m.disabled_at, m.pii_masked_at
    from public.admin_member_list(1000000, 0,
      case when p_recipient_mode='filter' then nullif(p_filter->>'search','') else null end,
      case when p_recipient_mode='filter' then nullif(p_filter->>'plan','') else null end,
      case when p_recipient_mode='filter' then nullif(p_filter->>'role','') else null end,
      case when p_recipient_mode='filter' then nullif(p_filter->>'status','') else null end) m
  ), eligible as (
    select b.id, b.email, b.nickname from base b
    where b.email is not null and b.withdrawn_at is null and b.disabled_at is null and b.pii_masked_at is null
      and (p_recipient_mode <> 'selected' or b.id = any (coalesce(p_selected_user_ids, '{}'::uuid[])))
      -- 0487: 정산 정보 미완비 아티스트 한정 (계좌는 있으나 지급 요건 미충족)
      and (
        p_recipient_mode <> 'filter'
        or coalesce(p_filter->>'payout_pii_incomplete','') <> 'true'
        or exists (
          select 1 from public.artist_payout_accounts pa
          where pa.user_id = b.id
            and not public.artist_payout_account_ready(pa.user_id)
        )
      )
  )
  select e.id, e.email, e.nickname from eligible e
  where p_email_kind <> 'ad' or not exists (
    select 1 from public.email_unsubscribes u where lower(u.email)=lower(e.email) and u.scope in ('ad','all'));
end; $function$;
