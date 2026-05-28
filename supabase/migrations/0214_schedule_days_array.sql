-- 매장 스케줄 모델 변경 — 한 행이 여러 요일에 적용되도록 days_of_week int[] 추가.
-- 기존 day_of_week 컬럼은 호환성을 위해 유지 (additive-only). 새 코드는 days_of_week 기준으로 동작.

-- 1) days_of_week 컬럼 추가
ALTER TABLE business_music_schedules
  ADD COLUMN IF NOT EXISTS days_of_week int[];

-- 2) 기존 행 백필 — day_of_week 단일 값을 배열로 변환
UPDATE business_music_schedules
SET days_of_week = ARRAY[day_of_week]
WHERE days_of_week IS NULL;

-- 3) NOT NULL + CHECK 제약 (0~6 사이의 정수만 허용)
ALTER TABLE business_music_schedules
  ALTER COLUMN days_of_week SET NOT NULL;

ALTER TABLE business_music_schedules
  DROP CONSTRAINT IF EXISTS business_music_schedules_days_of_week_valid;
ALTER TABLE business_music_schedules
  ADD CONSTRAINT business_music_schedules_days_of_week_valid
  CHECK (
    array_length(days_of_week, 1) >= 1
    AND array_length(days_of_week, 1) <= 7
    AND days_of_week <@ ARRAY[0,1,2,3,4,5,6]
  );

-- 4) GIN 인덱스 — days_of_week ARRAY 매칭 (오늘 요일이 배열에 포함되는지) 빠른 조회
CREATE INDEX IF NOT EXISTS business_music_schedules_days_gin
  ON business_music_schedules USING GIN (days_of_week);

-- 5) day_of_week 는 호환을 위해 유지하되 NOT NULL 제거 — 미래에 days_of_week[0] 으로 자동 채울 예정
ALTER TABLE business_music_schedules
  ALTER COLUMN day_of_week DROP NOT NULL;

-- 6) 중복 정리 헬퍼 RPC — 동일 (slot_name, start_time, end_time, playlist_id, is_active) 행을
--    하나로 병합하고 days_of_week 를 합집합으로 갱신. 사용자가 명시적으로 호출.
CREATE OR REPLACE FUNCTION public.consolidate_business_schedules()
RETURNS TABLE(merged_count int, kept_count int)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_merged int := 0;
  v_kept int := 0;
  rec record;
  group_ids uuid[];
  keeper uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION '로그인이 필요합니다.';
  END IF;

  FOR rec IN
    SELECT
      slot_name, start_time, end_time,
      COALESCE(playlist_id::text, '') AS plid_key,
      is_active,
      array_agg(id ORDER BY created_at ASC) AS ids,
      (
        SELECT array_agg(DISTINCT d ORDER BY d)
        FROM (
          SELECT unnest(days_of_week) AS d
          FROM business_music_schedules s2
          WHERE s2.user_id = v_uid
            AND s2.slot_name = sub.slot_name
            AND s2.start_time = sub.start_time
            AND s2.end_time = sub.end_time
            AND COALESCE(s2.playlist_id::text, '') = COALESCE(sub.playlist_id::text, '')
            AND s2.is_active = sub.is_active
        ) u
      ) AS union_days
    FROM business_music_schedules sub
    WHERE user_id = v_uid
    GROUP BY slot_name, start_time, end_time, plid_key, is_active, playlist_id
    HAVING count(*) > 1
  LOOP
    group_ids := rec.ids;
    keeper := group_ids[1];
    -- 첫 번째 행에 합쳐진 요일 적용
    UPDATE business_music_schedules
      SET days_of_week = rec.union_days,
          day_of_week = rec.union_days[1]
      WHERE id = keeper;
    -- 나머지 삭제
    DELETE FROM business_music_schedules
      WHERE id = ANY(group_ids[2:])
        AND user_id = v_uid;
    v_merged := v_merged + (array_length(group_ids, 1) - 1);
    v_kept := v_kept + 1;
  END LOOP;

  RETURN QUERY SELECT v_merged, v_kept;
END;
$$;

GRANT EXECUTE ON FUNCTION public.consolidate_business_schedules() TO authenticated;
