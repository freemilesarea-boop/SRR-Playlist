-- ============================================================================
-- HOTFIX-C ROLLBACK — cafe Guardrail Seed 제거
-- ============================================================================
-- HOTFIX-C 로 삽입한 cafe 규칙 10건만 제거. 다른 store_key / 기존 규칙 무관.
-- 마커: store_key='cafe' AND reason like 'HOTFIX-C cafe seed%'
-- (study_cafe 는 애초에 미적용이므로 대상 아님)
-- ============================================================================

begin;

delete from public.store_guardrails
 where store_key = 'cafe'
   and reason like 'HOTFIX-C cafe seed%';

commit;

-- 확인: cafe 규칙 0건 기대 (기존에 순수 'cafe' 키 규칙은 없었음)
select count(*) as remaining_cafe_rules
from public.store_guardrails
where store_key = 'cafe';
