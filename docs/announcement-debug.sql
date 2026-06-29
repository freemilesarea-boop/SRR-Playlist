-- ============================================================================
-- Announcement Scheduler V1 디버그 SQL
-- ============================================================================
-- 안내/광고 음원이 매장 플레이어에서 재생되지 않을 때 단계별 진단.
-- read-only — 운영 데이터 변경 없음.
--
-- 사용:
--   :store_id  변수를 매장 (users.id) 으로 치환 후 §1 부터 순서대로 실행.
--   Supabase SQL Editor 에서는 직접 UUID 를 inline 으로 붙여넣으면 됨.
-- ============================================================================

-- 테스트 대상 매장 ID (UUID) — 실제 매장 ID 로 교체
-- 예: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'


-- ============================================================================
-- §1. 0386 hotfix 적용 여부 (due window = 15min)
-- ============================================================================
select case when prosrc ilike '%interval ''15 minutes''%' then '✓ 0386 applied (15min window)'
            when prosrc ilike '%interval ''5 minutes''%'  then '✗ 0386 NOT applied (5min window — 운영 적용 필요)'
            else '? unknown state'
       end as status
  from pg_proc where proname='_announcement_is_due_now';


-- ============================================================================
-- §2. 활성 schedule + asset 상태
-- ============================================================================
select s.id           as schedule_id,
       s.name         as schedule_name,
       s.status,
       s.scope_type,
       s.recurrence_rule,
       s.timezone,
       s.starts_at, s.ends_at,
       s.max_plays_per_day,
       s.play_mode,
       s.last_triggered_at,
       a.id           as asset_id,
       a.title        as asset_title,
       a.status       as asset_status,
       a.deleted_at   as asset_deleted_at,
       a.duration_seconds,
       a.file_url     is not null as asset_has_url
  from public.enterprise_announcement_schedules s
  join public.enterprise_announcement_assets a on a.id = s.asset_id
 where s.deleted_at is null
   and s.status = 'active'
 order by s.created_at desc;
-- ✅ 조회되면 schedule + asset 정상.
-- ✗ 비어있으면 schedule 비활성 / asset deleted / status='active' 아님.


-- ============================================================================
-- §3. 현재 시각 & 타임존
-- ============================================================================
select now()                             as utc_now,
       now() at time zone 'Asia/Seoul'   as kst_now,
       (now() at time zone 'Asia/Seoul')::date as kst_today,
       extract(dow from now() at time zone 'Asia/Seoul')::int as kst_dow_0sun;
-- KST 기준 시각 / 요일 확인. recurrence_rule HH:MM 와 비교.


-- ============================================================================
-- §4. recurrence_rule 파싱 결과 (각 active schedule 별)
-- ============================================================================
select s.name,
       s.recurrence_rule,
       public._announcement_is_due_now(
         s.recurrence_rule, s.starts_at, s.ends_at,
         now(), coalesce(s.timezone, 'Asia/Seoul')
       ) as is_due_now
  from public.enterprise_announcement_schedules s
 where s.deleted_at is null and s.status = 'active';
-- is_due_now = true  → 서버는 due 인 상태.
-- is_due_now = false → window 밖 또는 starts_at/ends_at 조건 미달.


-- ============================================================================
-- §5. 매장 sync_status 확인 (scope=region 경우 필수)
--     ':STORE_ID' 를 실제 UUID 로 치환
-- ============================================================================
select store_id,
       enterprise_region_id,
       last_seen_at,
       last_heartbeat_at,
       app_version
  from public.store_policy_sync_status
 where store_id = ':STORE_ID'::uuid;


-- ============================================================================
-- §6. 매장 ↔ franchise/enterprise 연결 확인
-- ============================================================================
select fs.store_id,
       fs.franchise_id, fs.status as fs_status,
       ef.enterprise_account_id, ef.role as ef_role, ef.deleted_at as ef_deleted_at,
       ea.enterprise_name
  from public.franchise_stores fs
  left join public.enterprise_franchises ef on ef.franchise_id = fs.franchise_id and ef.deleted_at is null
  left join public.enterprise_accounts ea  on ea.id = ef.enterprise_account_id
 where fs.store_id = ':STORE_ID'::uuid;


-- ============================================================================
-- §7. 오늘 play_logs (중복 방지 조건 확인)
-- ============================================================================
select pl.id,
       pl.schedule_id, s.name as schedule_name,
       pl.status, pl.played_at, pl.error_message
  from public.enterprise_announcement_play_logs pl
  left join public.enterprise_announcement_schedules s on s.id = pl.schedule_id
 where pl.store_id = ':STORE_ID'::uuid
   and pl.created_at >= ((now() at time zone 'Asia/Seoul')::date)::timestamp at time zone 'Asia/Seoul'
 order by pl.created_at desc;
-- 오늘 played 가 max_plays_per_day 초과면 due 가 반환되지 않음.
-- played_at 이 최근 5분 이내면 debounce 로 제외됨.


-- ============================================================================
-- §8. store_get_due_announcements 직접 호출
-- ============================================================================
select jsonb_pretty(public.store_get_due_announcements(':STORE_ID'::uuid)) as result;
-- data 배열이 비어있으면 다음 중 하나:
--   1) is_due_now=false (§4 확인)
--   2) scope 미일치 (region 인데 sync_status.enterprise_region_id 매핑 없음 등)
--   3) today_count >= max_plays_per_day (§7 확인)
--   4) last_played_at 가 5분 이내 (§7 확인)
-- data 가 1건 이상이면 서버는 due 정상 → 매장 player overlay 문제.


-- ============================================================================
-- §9. AnnouncementOverlay 동작 점검 (브라우저)
-- ============================================================================
-- /store 페이지 console 에서:
--   1) localStorage.setItem('debug', 'announcement-overlay')  // 디버그 로그 활성화
--   2) page reload
--   3) 5초 후부터 console 에 '[announcement-overlay] poll'  로그 확인
--   4) due 가 반환되어도 '곡 변경 감지' 가 안 일어나면 BGM 트랙이 계속 재생 중 →
--      0386 (15min window) 적용 후 다음 트랙 종료 시 자동 삽입됨


-- ============================================================================
-- §10. 빠른 진단 시나리오 (테스트 schedule 생성)
-- ============================================================================
-- 운영 admin 으로:
--   1) /admin → 안내/광고 음원 → 음원 1개 active 상태 확인
--   2) 예약 재생 만들기 → 매일 + 현재 분+1 (예: 지금 15:30 이면 daily:15:31)
--   3) 범위 본사 전체 + 활성 저장
--   4) /store 키오스크 페이지 진입 → 트랙이 종료될 때 안내음 삽입 확인
--   5) §8 직접 호출로 서버 측 due 여부 동시 확인


-- ============================================================================
-- END
-- ============================================================================
