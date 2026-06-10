-- 0334 — 음압(LUFS) PASS 밴드 = -15..-9. 밴드 밖 음원은 업로드 단계에서 탈락(reject).
--
-- 배경: 0210 게이트 완화로 음압 미달이 reject→warning 이 되어 마스터링 안 된 음원이 유통됨.
-- 정책: PASS 밴드(LUFS -15..-9) 를 벗어난 음원은 warning 이 아니라 REJECT.
--   - 너무 작음(LUFS < -15) / 너무 큼(LUFS > -9) → 업로드 차단.
--   - 하한을 -14 → -15 로 0.x~1 LUFS 여유를 둬, 경계선 정상곡은 통과시키고 진짜 음압 미달만 탈락.
--   - 남는 WARNING 은 '음압 정상 + True Peak 0..+0.3 dBTP' 한 가지뿐.
-- 효과 전파: 프론트 evaluateQuality 는 audio_quality_config.lufs_min(-15) 을 읽어 차단하고,
--   서버 판정 compute_quality_grade 는 동일 밴드를 하드코딩 — 두 경로를 -15 로 일치시킨다.
-- additive: CREATE OR REPLACE + config 행 UPDATE 만. 트랙 데이터 UPDATE 없음.
--   release_status/stream_events/정산 무접근.

-- 1) 서버 판정 함수 — 음압 밴드 밖 = reject (하한 -15).
create or replace function public.compute_quality_grade(
  p_lufs numeric, p_tp numeric, p_clipping boolean, p_block_on_clipping boolean default null
) returns text language sql immutable
set search_path to 'public' as $$
  select case
    when p_lufs is null then 'reject'
    when coalesce(p_block_on_clipping, true) and coalesce(p_clipping, false) then 'reject'
    when p_tp is not null and p_tp > 0.3 then 'reject'
    -- 0334: 음압(볼륨) 미달/초과 = 업로드 차단. 하한 -15(경계 여유).
    when p_lufs < -15 or p_lufs > -9 then 'reject'
    when p_tp is null or p_tp <= 0.0 then 'pass'
    else 'warning'   -- 음압 정상(-15..-9) + TP 0..+0.3
  end;
$$;
grant execute on function public.compute_quality_grade(numeric, numeric, boolean, boolean) to anon, authenticated;

-- 2) 프론트 업로드 게이트가 읽는 config 하한값도 -15 로 정렬.
update public.audio_quality_config
  set lufs_min = -15, updated_at = now()
  where id = 1;
