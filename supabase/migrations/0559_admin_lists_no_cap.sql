-- 0559_admin_lists_no_cap.sql
--
-- 관리자 화면의 "전부 봐야 하는" 목록 서버 상한을 푼다 (0556 본사 목록과 같은 기준).
--
-- 왜
--   관리자 목록·선택 목록(본사 계정·지역·안내방송 소재·배포 정책 등)이 서버에서 200~1000 개로
--   잘려, 그 뒤의 본사·지역·매장이 드롭다운과 목록에서 조용히 빠질 수 있었다.
--   NOC 경고·매장 건강·무료체험·본사 콘텐츠 요청·업로드 점검(고아 파일·변환 실패·장기 대기)·
--   긴급 방송 대상 매장·곡 소유자 목록도 마찬가지.
--
-- 바뀌는 것
--   · p_limit 상한 → 10000 (페이지 이동이 있는 목록은 클라이언트가 그대로 페이지 단위로 부른다)
--   · 고정 limit(긴급 방송 대상 500, 곡 소유자 500, 업로드 점검 100, 브랜드 큐 30) 제거
--   · list_admin_tracks_with_ai: 페이지로 나눠 받으므로 정렬에 id 를 더해 순서를 고정
--   함수 본문은 그대로 두고 해당 부분만 바꾼다. 바꿀 문구가 없으면 실패한다.

do $$
declare
  r record;
  v_def text;
  v_new text;
begin
  for r in
    select * from (values
      ('admin_list_announcement_assets',                'least\(greatest\(coalesce\(p_limit, 50\), 1\), 200\)', 'least(greatest(coalesce(p_limit, 50), 1), 10000)'),
      ('admin_list_announcement_schedules',             'least\(greatest\(coalesce\(p_limit, 50\), 1\), 200\)', 'least(greatest(coalesce(p_limit, 50), 1), 10000)'),
      ('admin_list_available_playlists_for_deployment', 'least\(greatest\(coalesce\(p_limit, 50\), 1\), 200\)', 'least(greatest(coalesce(p_limit, 50), 1), 10000)'),
      ('admin_list_deployable_policies',                'least\(greatest\(coalesce\(p_limit, 50\), 1\), 200\)', 'least(greatest(coalesce(p_limit, 50), 1), 10000)'),
      ('admin_list_emergency_broadcasts',               'least\(greatest\(coalesce\(p_limit, 50\), 1\), 200\)', 'least(greatest(coalesce(p_limit, 50), 1), 10000)'),
      ('admin_list_enterprise_accounts',                'least\(greatest\(coalesce\(p_limit, 50\), 1\), 200\)', 'least(greatest(coalesce(p_limit, 50), 1), 10000)'),
      ('admin_list_enterprise_billing_invoices',        'least\(greatest\(coalesce\(p_limit, 50\), 1\), 200\)', 'least(greatest(coalesce(p_limit, 50), 1), 10000)'),
      ('admin_list_enterprise_contracts',               'least\(greatest\(coalesce\(p_limit, 50\), 1\), 200\)', 'least(greatest(coalesce(p_limit, 50), 1), 10000)'),
      ('admin_list_enterprise_regions',                 'least\(greatest\(coalesce\(p_limit, 50\), 1\), 200\)', 'least(greatest(coalesce(p_limit, 50), 1), 10000)'),
      ('admin_list_policy_deployments',                 'least\(greatest\(coalesce\(p_limit, 50\), 1\), 200\)', 'least(greatest(coalesce(p_limit, 50), 1), 10000)'),
      ('admin_list_store_monitoring',                   'least\(greatest\(coalesce\(p_limit, 50\), 1\), 200\)', 'least(greatest(coalesce(p_limit, 50), 1), 10000)'),
      ('admin_now_playing_list',                        'least\(greatest\(coalesce\(p_limit, 50\), 1\), 500\)', 'least(greatest(coalesce(p_limit, 50), 1), 10000)'),
      ('admin_noc_active_alerts',                       'least\(greatest\(coalesce\(p_limit, 50\), 1\), 200\)', 'least(greatest(coalesce(p_limit, 50), 1), 10000)'),
      ('admin_noc_store_health_list',                   'least\(greatest\(coalesce\(p_limit, 100\), 1\), 500\)', 'least(greatest(coalesce(p_limit, 100), 1), 10000)'),
      ('admin_list_free_trials',                        'least\(coalesce\(p_limit, 200\), 1000\)',               'least(coalesce(p_limit, 200), 10000)'),
      ('admin_list_hq_content_requests',                'least\(coalesce\(p_limit, 100\), 300\)',                'least(coalesce(p_limit, 100), 10000)'),
      ('admin_get_emergency_broadcast_detail',          '\s+limit 500\M',                                        ''),
      ('admin_list_track_artist_owners',                '\s+limit 500;',                                         ';'),
      ('admin_upload_audit',                            ' limit 100\)',                                          ')'),
      ('admin_list_brand_queues',                       '\s+limit 30;',                                          ';'),
      ('list_admin_tracks_with_ai',                     'order by t\.created_at desc\s+limit p_limit;',          'order by t.created_at desc, t.id
  limit p_limit;')
    ) as t(fn, pat, rep)
  loop
    select pg_get_functiondef(p.oid) into v_def
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = r.fn;
    if v_def is null then
      raise exception '0559: function % not found', r.fn;
    end if;
    v_new := regexp_replace(v_def, r.pat, r.rep, 'g');
    if v_new = v_def then
      -- 이미 적용된 경우(재실행)는 통과: 바뀐 문구가 들어 있는지로 판단
      if r.rep <> '' and r.rep <> ';' and r.rep <> ')' and position(r.rep in v_def) > 0 then
        continue;
      end if;
      if r.rep in ('', ';', ')') then
        continue; -- 제거형 패턴은 이미 없으면 적용된 것
      end if;
      raise exception '0559: % 에서 바꿀 문구를 찾지 못했다: %', r.fn, r.pat;
    end if;
    execute v_new;
  end loop;
end;
$$;
