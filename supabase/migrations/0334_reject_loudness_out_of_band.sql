-- 0334 — 음압(LUFS) 밴드 밖 = REJECT 로 강화. 업로드 단계에서 볼륨 미달/초과 음원 탈락.
--
-- 배경: 0210 게이트 완화로 음압 미달이 reject→warning 이 되어 마스터링 안 된 음원이 유통됨.
-- 정책 변경: PASS 밴드(LUFS -14..-9) 를 벗어난 음원은 warning 이 아니라 REJECT.
--   - 너무 작음(LUFS < -14) / 너무 큼(LUFS > -9) → 업로드 차단 (클라 evaluateQuality 와 동일).
--   - 남는 WARNING 은 '음압 정상 + True Peak 0..+0.3 dBTP' 한 가지뿐.
-- 효과 전파: compute_quality_grade 한 곳만 바꾸면 record_audio_quality(passed_quality_check),
--   _rereview_reflag_track / admin_finalize_rereview(quality_review_required), admin_rereview_queue,
--   admin_list_audio_quality 등 이를 호출하는 모든 경로가 새 정책을 따른다.
-- additive: CREATE OR REPLACE 만. 트랙 데이터 UPDATE 없음. release_status/stream_events/정산 무접근.

create or replace function public.compute_quality_grade(
  p_lufs numeric, p_tp numeric, p_clipping boolean, p_block_on_clipping boolean default null
) returns text language sql immutable
set search_path to 'public' as $$
  select case
    when p_lufs is null then 'reject'
    when coalesce(p_block_on_clipping, true) and coalesce(p_clipping, false) then 'reject'
    when p_tp is not null and p_tp > 0.3 then 'reject'
    -- 0334: 음압(볼륨) 미달/초과 = 업로드 차단.
    when p_lufs < -14 or p_lufs > -9 then 'reject'
    when p_tp is null or p_tp <= 0.0 then 'pass'
    else 'warning'   -- 음압 정상(-14..-9) + TP 0..+0.3
  end;
$$;
grant execute on function public.compute_quality_grade(numeric, numeric, boolean, boolean) to anon, authenticated;
