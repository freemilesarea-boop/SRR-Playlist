-- 0557_fix_store_name_columns.sql
--
-- 본사 화면 목록이 통째로 실패하던 문제 — 없는 컬럼 참조 수정.
--
-- 왜
--   0556(본사 목록 상한 해제)을 점검하며 실제로 호출해 보니, 본사용 RPC 여러 개가
--   매번 "column u.business_name does not exist" 로 실패하고 있었다. users 에는
--   business_name 컬럼이 없다(매장명은 franchise_stores / business_profiles 쪽). plpgsql 은
--   실행할 때에야 컬럼을 확인하므로 배포 때는 드러나지 않았다.
--     본사 장애 목록·상세 · 위험 매장 · 매장 순위 · 월간 리포트 · 운영 경고 · 매장 목록 ·
--     장애 스캔 · (영업 수수료 목록 2종: u.email 도 없는 컬럼)
--   또 '지금 재생 중'과 장애 스캔은 store_now_playing 뷰에 없는 current_track_started_at 을
--   읽어 실패했다(뷰의 컬럼 이름은 started_at).
--
-- 바뀌는 것 (함수 본문은 그대로, 문제 문구만 교체 — 못 찾으면 실패)
--   u.business_name → public._announcement_store_label(u.id, null)
--       (가맹 매장명 → 브랜드 기기 이름 → 계정 이름 순, 0555)
--   u.email (영업 수수료 목록) → auth.users 에서 조회
--   np.current_track_started_at → np.started_at

do $$
declare
  r record;
  v_def text;
  v_new text;
begin
  for r in
    select * from (values
      ('get_my_enterprise_incidents',            'u.business_name', 'public._announcement_store_label(u.id, null)'),
      ('get_my_enterprise_incident_detail',      'u.business_name', 'public._announcement_store_label(u.id, null)'),
      ('get_my_enterprise_intel_monthly_report', 'u.business_name', 'public._announcement_store_label(u.id, null)'),
      ('get_my_enterprise_intel_risk_stores',    'u.business_name', 'public._announcement_store_label(u.id, null)'),
      ('get_my_enterprise_intel_store_ranking',  'u.business_name', 'public._announcement_store_label(u.id, null)'),
      ('get_my_enterprise_ops_alerts',           'u.business_name', 'public._announcement_store_label(u.id, null)'),
      ('get_my_enterprise_ops_stores',           'u.business_name', 'public._announcement_store_label(u.id, null)'),
      ('run_my_enterprise_incident_scan',        'u.business_name', 'public._announcement_store_label(u.id, null)'),
      ('admin_sales_commission_list',            'u.business_name', 'public._announcement_store_label(u.id, null)'),
      ('my_sales_commission_list',               'u.business_name', 'public._announcement_store_label(u.id, null)'),
      ('admin_sales_commission_list',            'u.email,',        '(select au.email::text from auth.users au where au.id = u.id),'),
      ('get_my_enterprise_ops_now_playing',      'np.current_track_started_at', 'np.started_at'),
      ('run_my_enterprise_incident_scan',        'np.current_track_started_at', 'np.started_at')
    ) as t(fn, old_txt, new_txt)
  loop
    select pg_get_functiondef(p.oid) into v_def
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = r.fn;
    if v_def is null then
      raise exception '0557: function % not found', r.fn;
    end if;
    if position(r.old_txt in v_def) = 0 then
      if position(r.new_txt in v_def) > 0 then
        continue; -- 이미 적용됨
      end if;
      raise exception '0557: % 에서 바꿀 문구를 찾지 못했다: %', r.fn, r.old_txt;
    end if;
    v_new := replace(v_def, r.old_txt, r.new_txt);
    execute v_new;
  end loop;
end;
$$;
