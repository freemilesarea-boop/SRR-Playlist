-- ============================================
-- 0529_business_schedule_overnight.sql
-- 매장 플레이어 24시간 / 자정 넘김 운영 지원
-- ============================================
--
-- 배경:
--   0007 에서 business_music_schedules 에 `check (start_time < end_time)` 를 걸어
--   자정을 넘는 슬롯(22:00~02:00)과 24시간 운영을 DB 레벨에서 원천 차단하고 있었다.
--   브랜드/프랜차이즈 쪽(franchise_music_policy_slots + get_store_active_music_policy)은
--   이미 자정 넘김을 지원하는데 매장 플레이어만 막혀 있던 비대칭을 해소한다.
--
-- 새 규칙 (클라이언트 businessScheduleTime.ts 와 동일):
--   start_time <  end_time  → [start, end)                  일반
--   start_time >  end_time  → [start, 24:00) ∪ [00:00, end)  자정 넘김
--   start_time =  end_time  → 금지 (길이 0 인지 24시간인지 구분 불가)
--
-- 24시간 운영은 빈틈 없는 슬롯 3개로 표현한다:
--   00:00~08:00 / 08:00~16:00 / 16:00~00:00
--   (마지막 슬롯은 start > end 이므로 자정 넘김으로 해석 → 실질 16:00~24:00)

-- 1) 0007 의 익명 check 제약 제거.
--    인라인 `check (...)` 라 이름이 자동 생성(business_music_schedules_check 등)되어
--    환경마다 다를 수 있으므로, 정의를 보고 찾아서 지운다.
do $$
declare
  r record;
begin
  for r in
    select con.conname
      from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
      join pg_namespace ns on ns.oid = rel.relnamespace
     where ns.nspname = 'public'
       and rel.relname = 'business_music_schedules'
       and con.contype = 'c'
       and pg_get_constraintdef(con.oid) ilike '%start_time%<%end_time%'
       and pg_get_constraintdef(con.oid) not ilike '%<>%'
  loop
    execute format(
      'alter table public.business_music_schedules drop constraint %I',
      r.conname
    );
  end loop;
end $$;

-- 2) 새 제약 — 시작과 종료가 같은 것만 막는다. (재실행 안전)
alter table public.business_music_schedules
  drop constraint if exists business_music_schedules_time_range_chk;

alter table public.business_music_schedules
  add constraint business_music_schedules_time_range_chk
  check (start_time <> end_time);

comment on constraint business_music_schedules_time_range_chk
  on public.business_music_schedules is
  'start_time > end_time 는 자정 넘김 슬롯(22:00~02:00)으로 해석한다. 같은 값만 금지.';
