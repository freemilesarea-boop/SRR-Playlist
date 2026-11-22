-- 0562_md_policy_rule_toggle_priority.sql
--
-- 매장 장르 정책(MD) 규칙 켜기·끄기 + 우선순위 변경.
--
-- 왜
--   MD 탭은 규칙을 보기만 할 수 있었다. 규칙 하나를 잠시 빼거나(끄기) 어떤 규칙이 먼저
--   적용될지(우선순위) 바꾸려면 DB 를 직접 고쳐야 했다.
--
-- 판정 방식(0268, 그대로 유지)
--   매장의 규칙 중 장르·보컬이 맞는 것 하나를 고른다 — priority 가 낮을수록 먼저,
--   같으면 차단 규칙(is_allowed=false)이 먼저. 고른 규칙이 허용이면 통과, 차단이면 차단,
--   맞는 규칙이 없으면 md_policy_no_match.
--
-- 바뀌는 것
--   · store_genre_placement_rules.is_enabled (기본 true — 기존 규칙 동작 그대로)
--   · _check_store_genre_placement: 꺼진 규칙은 매칭에서 제외.
--     '이 매장에 정책이 있는가'도 켜진 규칙 기준 — 매장 규칙을 전부 끄면 정책 미정의 매장으로 본다.
--   · admin_md_policy_summary: 켜진 규칙 수(enabled_rules) 추가
--   · admin_set_md_policy_rule_enabled / admin_set_md_policy_rule_priority (관리자 전용, 운영 로그 기록)

alter table public.store_genre_placement_rules
  add column if not exists is_enabled boolean not null default true;

-- ---- 판정 함수: 꺼진 규칙 제외 ----
do $$
declare v_def text; v_new text;
begin
  select pg_get_functiondef('public._check_store_genre_placement'::regproc) into v_def;
  if position('and is_enabled) as ok' in v_def) > 0 then
    return; -- 이미 적용됨
  end if;
  v_new := replace(v_def,
    'where store_type = p_store_slug) as ok',
    'where store_type = p_store_slug and is_enabled) as ok');
  v_new := replace(v_new,
    'where r.store_type = p_store_slug',
    'where r.store_type = p_store_slug and r.is_enabled');
  if v_new = v_def
     or position('and is_enabled) as ok' in v_new) = 0
     or position('r.store_type = p_store_slug and r.is_enabled' in v_new) = 0 then
    raise exception '0562: _check_store_genre_placement 에서 바꿀 문구를 찾지 못했다';
  end if;
  execute v_new;
end;
$$;

-- ---- 요약: 켜진 규칙 수 ----
do $$
declare v_def text; v_new text;
begin
  select pg_get_functiondef('public.admin_md_policy_summary'::regproc) into v_def;
  if position('''enabled_rules''' in v_def) > 0 then
    return;
  end if;
  v_new := replace(v_def,
    '''total_rules'', (select count(*) from public.store_genre_placement_rules),',
    '''total_rules'', (select count(*) from public.store_genre_placement_rules),
    ''enabled_rules'', (select count(*) from public.store_genre_placement_rules where is_enabled),');
  if v_new = v_def then
    raise exception '0562: admin_md_policy_summary 에서 바꿀 문구를 찾지 못했다';
  end if;
  execute v_new;
end;
$$;

-- ---- 규칙 켜기·끄기 ----
create or replace function public.admin_set_md_policy_rule_enabled(p_id uuid, p_enabled boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := auth.uid();
  v_rule public.store_genre_placement_rules;
begin
  if not exists (select 1 from public.users u where u.id = v_admin and u.role = 'admin') then
    raise exception 'unauthorized';
  end if;
  if p_enabled is null then
    raise exception 'validation: p_enabled 가 비었다';
  end if;

  update public.store_genre_placement_rules
     set is_enabled = p_enabled, updated_at = now()
   where id = p_id
  returning * into v_rule;
  if v_rule.id is null then
    raise exception 'not_found: 규칙을 찾을 수 없다';
  end if;

  insert into public.admin_operation_logs(source, category, level, status, message, details, user_id, related_id)
  values ('md_policy', 'md_policy.rule.toggle', 'info', case when p_enabled then 'enabled' else 'disabled' end,
          format('장르 정책 규칙 %s — %s / %s / %s', case when p_enabled then '켬' else '끔' end,
                 v_rule.store_type, v_rule.genre, v_rule.vocal_policy),
          jsonb_build_object('rule_id', v_rule.id, 'store_type', v_rule.store_type, 'genre', v_rule.genre,
                             'vocal_policy', v_rule.vocal_policy, 'is_enabled', p_enabled),
          v_admin, v_rule.id::text);

  return jsonb_build_object('ok', true, 'id', v_rule.id, 'is_enabled', v_rule.is_enabled);
end;
$$;

revoke all on function public.admin_set_md_policy_rule_enabled(uuid, boolean) from public, anon;
grant execute on function public.admin_set_md_policy_rule_enabled(uuid, boolean) to authenticated, service_role;

-- ---- 우선순위 변경 (1~100, 낮을수록 먼저) ----
create or replace function public.admin_set_md_policy_rule_priority(p_id uuid, p_priority int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := auth.uid();
  v_old int;
  v_rule public.store_genre_placement_rules;
begin
  if not exists (select 1 from public.users u where u.id = v_admin and u.role = 'admin') then
    raise exception 'unauthorized';
  end if;
  if p_priority is null or p_priority < 1 or p_priority > 100 then
    raise exception 'validation: 우선순위는 1~100 (낮을수록 먼저 적용)';
  end if;

  select priority into v_old from public.store_genre_placement_rules where id = p_id;
  update public.store_genre_placement_rules
     set priority = p_priority, updated_at = now()
   where id = p_id
  returning * into v_rule;
  if v_rule.id is null then
    raise exception 'not_found: 규칙을 찾을 수 없다';
  end if;

  insert into public.admin_operation_logs(source, category, level, status, message, details, user_id, related_id)
  values ('md_policy', 'md_policy.rule.priority', 'info', 'updated',
          format('장르 정책 규칙 우선순위 %s → %s — %s / %s / %s', v_old, p_priority,
                 v_rule.store_type, v_rule.genre, v_rule.vocal_policy),
          jsonb_build_object('rule_id', v_rule.id, 'store_type', v_rule.store_type, 'genre', v_rule.genre,
                             'vocal_policy', v_rule.vocal_policy, 'old_priority', v_old, 'priority', p_priority),
          v_admin, v_rule.id::text);

  return jsonb_build_object('ok', true, 'id', v_rule.id, 'priority', v_rule.priority);
end;
$$;

revoke all on function public.admin_set_md_policy_rule_priority(uuid, int) from public, anon;
grant execute on function public.admin_set_md_policy_rule_priority(uuid, int) to authenticated, service_role;
