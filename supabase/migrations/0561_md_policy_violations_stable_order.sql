-- 0561_md_policy_violations_stable_order.sql
--
-- 매장 장르 정책(MD) 탭의 위반 곡 목록을 전부 보이게.
--
-- 왜
--   admin_list_md_policy_violations 는 화면에서 500건만 받아, 지금 위반 1639건 중 1139건이 안 보였다.
--   클라이언트가 range() 로 끝까지 나눠 받도록 바꿨는데, 이 함수에는 정렬이 없어 페이지마다
--   순서가 달라질 수 있다 — 플레이리스트·곡 순으로 정렬을 고정한다.
--   (옛 v1 탭 · 0258 함수들은 0268 MD 정책으로 대체돼 운영 DB 에 없었다 — v1 탭은 화면에서 제거)

do $$
declare v_def text; v_new text;
begin
  select pg_get_functiondef('public.admin_list_md_policy_violations'::regproc) into v_def;
  if position('order by pl.title, pt.playlist_id, pt.track_id' in v_def) > 0 then
    return; -- 이미 적용됨
  end if;
  v_new := regexp_replace(v_def, '(\s+)limit coalesce\(p_limit, 200\);',
                          '\1order by pl.title, pt.playlist_id, pt.track_id\1limit coalesce(p_limit, 200);');
  if v_new = v_def then
    raise exception '0561: admin_list_md_policy_violations 에서 limit 문구를 찾지 못했다';
  end if;
  execute v_new;
end;
$$;
