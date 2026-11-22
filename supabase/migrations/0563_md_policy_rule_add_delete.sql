-- 0563_md_policy_rule_add_delete.sql
--
-- 매장 장르 정책(MD) 규칙 추가·삭제.
--
-- 왜
--   0562 로 켜기·끄기와 우선순위는 화면에서 바꿀 수 있게 됐지만, 규칙을 새로 넣거나 빼려면
--   여전히 DB 를 직접 고쳐야 했다.
--
-- 바뀌는 것
--   · admin_md_policy_rule_options() — 추가 폼에 띄울 매장 종류·장르 후보
--       매장: 규칙이 있는 매장 + 플레이리스트에 쓰이는 매장 종류 (normalize_store_label 기준)
--       장르: 규칙 장르 + 곡 main_genre (규칙 표기 형식으로)
--   · admin_add_md_policy_rule(store_type, genre, vocal_policy, is_allowed, priority)
--       표기를 소문자·밑줄로 맞춰 저장. 같은 매장·보컬에 정규화하면 같은 장르가 이미 있으면 거부
--       (판정은 _normalize_genre_for_md 로 비교하므로 'K-POP' 과 'kpop' 은 같은 규칙이다).
--       매장 종류는 후보 목록(규칙이 있는 매장 · 플레이리스트 매장 종류)에 있는 값만 받는다 —
--       판정에서 쓰이지 않을 오타 매장으로 규칙이 들어가지 않게.
--   · admin_delete_md_policy_rule(id) — 삭제. 지운 규칙 내용 전체를 운영 로그에 남겨 되살릴 수 있게.

create or replace function public._md_policy_genre_slug(p text)
returns text
language sql
immutable
as $$
  select nullif(btrim(regexp_replace(lower(btrim(coalesce(p, ''))), '[\s\-]+', '_', 'g'), '_'), '');
$$;

create or replace function public.admin_md_policy_rule_options()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_admin uuid := auth.uid();
begin
  if not exists (select 1 from public.users u where u.id = v_admin and u.role = 'admin') then
    raise exception 'unauthorized';
  end if;
  return jsonb_build_object(
    'store_types', (
      select coalesce(jsonb_agg(s order by s), '[]'::jsonb) from (
        select store_type as s from public.store_genre_placement_rules
        union
        select public.normalize_store_label(pl.business_category)
          from public.playlists pl
         where pl.business_category is not null
      ) x where s is not null and s <> ''),
    'genres', (
      select coalesce(jsonb_agg(g order by g), '[]'::jsonb) from (
        select genre as g from public.store_genre_placement_rules
        union
        select public._md_policy_genre_slug(t.main_genre) from public.tracks t
         where t.main_genre is not null
      ) x where g is not null)
  );
end;
$$;

revoke all on function public.admin_md_policy_rule_options() from public, anon;
grant execute on function public.admin_md_policy_rule_options() to authenticated, service_role;

create or replace function public.admin_add_md_policy_rule(
  p_store_type   text,
  p_genre        text,
  p_vocal_policy text,
  p_is_allowed   boolean default true,
  p_priority     int     default 50
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
  v_dup   public.store_genre_placement_rules;
  v_rule  public.store_genre_placement_rules;
begin
  if not exists (select 1 from public.users u where u.id = v_admin and u.role = 'admin') then
    raise exception 'unauthorized';
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
   where r.store_type = v_store and r.vocal_policy = p_vocal_policy
     and public._normalize_genre_for_md(r.genre) = public._normalize_genre_for_md(v_genre)
   limit 1;
  if v_dup.id is not null then
    raise exception 'duplicate: 이미 같은 규칙이 있다 — % / % / % (%, 우선순위 %)',
      v_dup.store_type, v_dup.genre, v_dup.vocal_policy,
      case when v_dup.is_allowed then '허용' else '차단' end, v_dup.priority;
  end if;

  insert into public.store_genre_placement_rules
    (store_type, genre, vocal_policy, is_allowed, priority, source, is_enabled)
  values (v_store, v_genre, p_vocal_policy, p_is_allowed, p_priority, 'admin_ui', true)
  returning * into v_rule;

  insert into public.admin_operation_logs(source, category, level, status, message, details, user_id, related_id)
  values ('md_policy', 'md_policy.rule.create', 'info', 'created',
          format('장르 정책 규칙 추가 — %s / %s / %s (%s, 우선순위 %s)', v_rule.store_type, v_rule.genre,
                 v_rule.vocal_policy, case when v_rule.is_allowed then '허용' else '차단' end, v_rule.priority),
          to_jsonb(v_rule), v_admin, v_rule.id::text);

  return jsonb_build_object('ok', true, 'rule', to_jsonb(v_rule));
end;
$$;

revoke all on function public.admin_add_md_policy_rule(text, text, text, boolean, int) from public, anon;
grant execute on function public.admin_add_md_policy_rule(text, text, text, boolean, int) to authenticated, service_role;

create or replace function public.admin_delete_md_policy_rule(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := auth.uid();
  v_rule  public.store_genre_placement_rules;
begin
  if not exists (select 1 from public.users u where u.id = v_admin and u.role = 'admin') then
    raise exception 'unauthorized';
  end if;

  delete from public.store_genre_placement_rules where id = p_id
  returning * into v_rule;
  if v_rule.id is null then
    raise exception 'not_found: 규칙을 찾을 수 없다';
  end if;

  insert into public.admin_operation_logs(source, category, level, status, message, details, user_id, related_id)
  values ('md_policy', 'md_policy.rule.delete', 'warning', 'deleted',
          format('장르 정책 규칙 삭제 — %s / %s / %s (%s, 우선순위 %s)', v_rule.store_type, v_rule.genre,
                 v_rule.vocal_policy, case when v_rule.is_allowed then '허용' else '차단' end, v_rule.priority),
          to_jsonb(v_rule), v_admin, v_rule.id::text);

  return jsonb_build_object('ok', true, 'deleted', to_jsonb(v_rule));
end;
$$;

revoke all on function public.admin_delete_md_policy_rule(uuid) from public, anon;
grant execute on function public.admin_delete_md_policy_rule(uuid) to authenticated, service_role;
