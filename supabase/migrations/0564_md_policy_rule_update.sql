-- 0564_md_policy_rule_update.sql
--
-- 매장 장르 정책(MD) 규칙 수정.
--
-- 왜
--   켜기·끄기·우선순위(0562), 추가·삭제(0563)는 생겼지만, 장르 오타나 허용↔차단을 바꾸려면
--   지우고 다시 만들어야 했다 — 그러면 규칙 이력이 끊긴다.
--
-- 바뀌는 것
--   · admin_update_md_policy_rule(id, store_type, genre, vocal_policy, is_allowed, priority)
--       추가(0563)와 같은 검사: 표기 정리, 매장 종류는 쓰이는 값만, 우선순위 1~100,
--       같은 매장·보컬에 정규화 기준 같은 장르가 '다른 규칙'으로 있으면 거부.
--       켜짐/꺼짐은 그대로 둔다(0562 버튼으로). 바뀐 전/후를 운영 로그에 남긴다.

create or replace function public.admin_update_md_policy_rule(
  p_id           uuid,
  p_store_type   text,
  p_genre        text,
  p_vocal_policy text,
  p_is_allowed   boolean,
  p_priority     int
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := auth.uid();
  v_store text := lower(btrim(coalesce(p_store_type, '')));
  v_genre text := public._md_policy_genre_slug(p_genre);
  v_old   public.store_genre_placement_rules;
  v_dup   public.store_genre_placement_rules;
  v_rule  public.store_genre_placement_rules;
begin
  if not exists (select 1 from public.users u where u.id = v_admin and u.role = 'admin') then
    raise exception 'unauthorized';
  end if;

  select * into v_old from public.store_genre_placement_rules where id = p_id for update;
  if v_old.id is null then
    raise exception 'not_found: 규칙을 찾을 수 없다';
  end if;

  if v_store = '' then
    raise exception 'validation: 매장 종류를 골라 주세요';
  end if;
  if not exists (select 1 from public.store_genre_placement_rules r where r.store_type = v_store)
     and not exists (select 1 from public.playlists pl
                      where pl.business_category is not null
                        and public.normalize_store_label(pl.business_category) = v_store) then
    raise exception 'validation: 알 수 없는 매장 종류 "%" — 목록에 있는 매장 종류를 골라 주세요', v_store;
  end if;
  if v_genre is null then
    raise exception 'validation: 장르를 입력해 주세요';
  end if;
  if p_vocal_policy is null or p_vocal_policy not in ('vocal', 'instrumental') then
    raise exception 'validation: 보컬 구분은 vocal 또는 instrumental';
  end if;
  if p_is_allowed is null then
    raise exception 'validation: 허용/차단을 골라 주세요';
  end if;
  if p_priority is null or p_priority < 1 or p_priority > 100 then
    raise exception 'validation: 우선순위는 1~100 (낮을수록 먼저 적용)';
  end if;

  select * into v_dup from public.store_genre_placement_rules r
   where r.id <> p_id
     and r.store_type = v_store and r.vocal_policy = p_vocal_policy
     and public._normalize_genre_for_md(r.genre) = public._normalize_genre_for_md(v_genre)
   limit 1;
  if v_dup.id is not null then
    raise exception 'duplicate: 이미 같은 규칙이 있다 — % / % / % (%, 우선순위 %)',
      v_dup.store_type, v_dup.genre, v_dup.vocal_policy,
      case when v_dup.is_allowed then '허용' else '차단' end, v_dup.priority;
  end if;

  update public.store_genre_placement_rules
     set store_type = v_store, genre = v_genre, vocal_policy = p_vocal_policy,
         is_allowed = p_is_allowed, priority = p_priority, updated_at = now()
   where id = p_id
  returning * into v_rule;

  if (v_old.store_type, v_old.genre, v_old.vocal_policy, v_old.is_allowed, v_old.priority)
     is distinct from (v_rule.store_type, v_rule.genre, v_rule.vocal_policy, v_rule.is_allowed, v_rule.priority) then
    insert into public.admin_operation_logs(source, category, level, status, message, details, user_id, related_id)
    values ('md_policy', 'md_policy.rule.update', 'info', 'updated',
            format('장르 정책 규칙 수정 — %s / %s / %s (%s, %s) → %s / %s / %s (%s, %s)',
                   v_old.store_type, v_old.genre, v_old.vocal_policy,
                   case when v_old.is_allowed then '허용' else '차단' end, v_old.priority,
                   v_rule.store_type, v_rule.genre, v_rule.vocal_policy,
                   case when v_rule.is_allowed then '허용' else '차단' end, v_rule.priority),
            jsonb_build_object('before', to_jsonb(v_old), 'after', to_jsonb(v_rule)),
            v_admin, v_rule.id::text);
  end if;

  return jsonb_build_object('ok', true, 'rule', to_jsonb(v_rule));
end;
$$;

revoke all on function public.admin_update_md_policy_rule(uuid, text, text, text, boolean, int) from public, anon;
grant execute on function public.admin_update_md_policy_rule(uuid, text, text, text, boolean, int) to authenticated, service_role;

-- ---- 위반 목록에 '차단 규칙에 걸린 곡'도 ----
-- 0268 의 위반 목록은 '맞는 규칙 없음'·'정책 미정의 매장'만 모았다 — 그때는 허용 규칙만 있었기
-- 때문. 이제 차단 규칙을 만들 수 있으므로(0563·0564) 차단에 걸린 곡(md_policy_explicit_block)도
-- 위반으로 보여 준다. 일괄 적용(admin_backfill_store_genre_policy_review)은 원래 allowed=false 전체를
-- 대상으로 해서 이미 포함돼 있었다.
do $$
declare v_def text; v_new text;
begin
  select pg_get_functiondef('public.admin_list_md_policy_violations'::regproc) into v_def;
  if position('md_policy_explicit_block' in v_def) > 0 then
    return;
  end if;
  v_new := replace(v_def, 'in (''md_policy_no_match'',''md_policy_undefined_store'')',
                          'in (''md_policy_no_match'',''md_policy_undefined_store'',''md_policy_explicit_block'')');
  if v_new = v_def then
    raise exception '0564: admin_list_md_policy_violations 에서 위반 사유 목록을 찾지 못했다';
  end if;
  execute v_new;
end;
$$;
