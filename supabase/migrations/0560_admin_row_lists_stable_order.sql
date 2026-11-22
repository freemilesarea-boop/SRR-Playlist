-- 0560_admin_row_lists_stable_order.sql
--
-- 관리자 대기 목록(행 목록 RPC)을 1000건 넘게 받기 위한 정렬 고정.
--
-- 왜
--   행 목록(SETOF / RETURNS TABLE)을 돌려주는 RPC 는 PostgREST 응답 상한 1000행에서 잘린다.
--   클라이언트(fetchAllRpcRows)가 range() 로 500행씩 나눠 받도록 바꿨는데, 정렬 값이 같은 행이
--   있으면 페이지마다 순서가 달라져 행이 겹치거나 빠질 수 있다.
--
-- 바뀌는 것
--   마지막 정렬 기준에 고유 열(각 함수의 id 열)을 더한다. 걸러내는 조건·정렬 우선순위는 그대로.

do $$
declare
  r record;
  v_def text;
  v_new text;
begin
  for r in
    select * from (values
      ('admin_list_curators',                  'c\.created_at desc(\s+limit greatest\(p_limit, 1\))',  'c.created_at desc, c.user_id\1'),
      ('admin_list_payout_intake',             's\.created_at desc(\s+limit greatest\(p_limit, 1\);)', 's.created_at desc, s.id\1'),
      ('admin_list_placement_risks',           'order by f\.detected_at desc(\s+limit p_limit;)',      'order by f.detected_at desc, f.id\1'),
      ('admin_list_sales_partner_applications','order by created_at desc(\s+limit greatest\(1, p_limit\);)', 'order by created_at desc, id\1'),
      ('admin_list_track_artist_owners',       'order by track_count desc;',                            'order by track_count desc, t.owner_user_id;'),
      ('list_admin_qc_review_queue',           't\.submitted_at desc nulls last(\s+limit p_limit;)',    't.submitted_at desc nulls last, t.id\1'),
      ('list_pending_ai_predictions',          'p\.created_at desc(\s+limit p_limit;)',                 'p.created_at desc, p.id\1'),
      ('list_pending_payout_accounts',         'pa\.created_at desc(\s+limit greatest\(1, p_limit\);)', 'pa.created_at desc, pa.id\1'),
      ('list_severe_metadata_mismatches',      'order by p\.energy_confidence desc nulls last(\s+limit p_limit;)', 'order by p.energy_confidence desc nulls last, p.id\1')
    ) as t(fn, pat, rep)
  loop
    select pg_get_functiondef(p.oid) into v_def
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = r.fn;
    if v_def is null then
      raise exception '0560: function % not found', r.fn;
    end if;
    -- 이미 적용됨(재실행): 고유 열이 붙은 정렬이 있으면 통과
    if position(split_part(replace(r.rep, '\1', ''), ';', 1) in v_def) > 0 then
      continue;
    end if;
    v_new := regexp_replace(v_def, r.pat, r.rep);
    if v_new = v_def then
      raise exception '0560: % 에서 바꿀 정렬을 찾지 못했다: %', r.fn, r.pat;
    end if;
    execute v_new;
  end loop;
end;
$$;

-- curator_profiles 의 키는 user_id — 위에서 c.id 로 붙었던 경우 바로잡는다(운영 적용 중 발견).
do $$
declare v_def text;
begin
  select pg_get_functiondef('public.admin_list_curators'::regproc) into v_def;
  if position('c.created_at desc, c.id' in v_def) > 0 then
    execute replace(v_def, 'c.created_at desc, c.id', 'c.created_at desc, c.user_id');
  end if;
end;
$$;
