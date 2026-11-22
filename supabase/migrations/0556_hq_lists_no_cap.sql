-- 0556_hq_lists_no_cap.sql
--
-- 본사(HQ)·매장이 "전부 봐야 하는" 목록의 서버 상한을 푼다.
--
-- 왜
--   아티스트 음원 관리가 최신 200곡만 보여줘 오래된 발매곡이 사라져 보였다(#617).
--   같은 기준으로 본사 화면을 점검하니 서버 함수에 개수 상한이 박혀 있었다:
--     get_my_enterprise_incidents / notifications / ops_alerts      200
--     get_my_enterprise_ops_now_playing / intel_risk_stores         100
--     hq_get_my_brand_content 의 요청 내역                           100
--     _announcement_status_core 의 오늘 송출 결과                    200
--   매장이 늘면 장애·경고·지금 재생 중·위험 매장이 목록에서 조용히 빠진다.
--
-- 바뀌는 것
--   · 위 p_limit 상한을 10000 으로 (본사 1곳의 매장·장애가 그 이상일 일은 없다 — 사실상 전부)
--   · 요청 내역 · 오늘 송출 결과는 limit 자체를 뺀다
--   함수 본문은 그대로 두고 상한 부분만 바꾼다. 바꿀 문구가 없으면 실패한다(조용히 넘어가지 않게).

do $$
declare
  r record;
  v_def text;
  v_new text;
begin
  for r in
    select * from (values
      ('get_my_enterprise_incidents',        'least(greatest(coalesce(p_limit, 50), 1), 200)',  'least(greatest(coalesce(p_limit, 50), 1), 10000)'),
      ('get_my_enterprise_notifications',    'least(greatest(coalesce(p_limit, 50), 1), 200)',  'least(greatest(coalesce(p_limit, 50), 1), 10000)'),
      ('get_my_enterprise_ops_alerts',       'least(greatest(coalesce(p_limit, 50), 1), 200)',  'least(greatest(coalesce(p_limit, 50), 1), 10000)'),
      ('get_my_enterprise_ops_now_playing',  'least(greatest(coalesce(p_limit, 30), 1), 100)',  'least(greatest(coalesce(p_limit, 30), 1), 10000)'),
      ('get_my_enterprise_intel_risk_stores','least(greatest(coalesce(p_limit, 20), 1), 100)',  'least(greatest(coalesce(p_limit, 20), 1), 10000)'),
      ('hq_get_my_brand_content',            'limit 100) r',                                    ') r'),
      ('_announcement_status_core',          'limit 200) l',                                    ') l')
    ) as t(fn, old_txt, new_txt)
  loop
    select pg_get_functiondef(p.oid) into v_def
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = r.fn;
    if v_def is null then
      raise exception '0556: function % not found', r.fn;
    end if;
    if position(r.old_txt in v_def) = 0 then
      -- 이미 적용된 경우(재실행)는 통과
      if position(r.new_txt in v_def) > 0 then
        continue;
      end if;
      raise exception '0556: % 에서 바꿀 문구를 찾지 못했다: %', r.fn, r.old_txt;
    end if;
    v_new := replace(v_def, r.old_txt, r.new_txt);
    execute v_new;
  end loop;
end;
$$;
