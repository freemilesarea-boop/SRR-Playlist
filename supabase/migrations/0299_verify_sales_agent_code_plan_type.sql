-- 0299 — verify_sales_agent_code 가 plan_type 도 반환 (X6.12 보안)
--
-- 배경: 가입 화면에서 비공개 코드(예: 수강생 전용)가 클라이언트 번들에 노출되는
-- 문제 발견. 해결: 클라이언트는 plan 매핑 테이블을 들고 다니지 않고, 서버가
-- verify_sales_agent_code RPC 결과로 plan_type 까지 직접 알려줌.
--
-- 반환:
--   id / name / code (사용자가 이미 입력한 코드이므로 echo OK)
--   is_active
--   plan_type   — 'general_artist' / 'student_artist' / null
--   plan_label  — '일반 아티스트' / '수강생 아티스트 PRO' 등
--   monthly_quota
--
-- 권한: anon + authenticated (가입 전 호출 가능 유지)

drop function if exists public.verify_sales_agent_code(text);

create or replace function public.verify_sales_agent_code(p_code text)
returns table(
  id uuid,
  name text,
  code text,
  is_active boolean,
  plan_type text,
  plan_label text,
  monthly_quota integer
)
language plpgsql stable security definer set search_path = public as $$
begin
  if p_code is null or length(btrim(p_code)) = 0 then
    return;
  end if;
  return query
  select
    sa.id,
    sa.name,
    sa.code,
    sa.is_active,
    public._plan_type_for_code(sa.code) as plan_type,
    case coalesce(public._plan_type_for_code(sa.code), 'legacy')
      when 'general_artist'  then '일반 아티스트'
      when 'student_artist'  then '수강생 아티스트 PRO'
      when 'legacy_student'  then '기존 아티스트'
      else                        '기본'
    end as plan_label,
    public._plan_monthly_quota(public._plan_type_for_code(sa.code)) as monthly_quota
  from public.sales_agents as sa
  where sa.code = btrim(p_code) and sa.is_active = true
  limit 1;
end; $$;

grant execute on function public.verify_sales_agent_code(text) to anon, authenticated, service_role;
