-- 0077 — 공개 노출 트랙 audio_url 가드 + 깨진 데이터 정리
--
-- 정책: 공개 (visibility='approved') 트랙은 반드시 audio_url 이 있고 비어있지 않아야 함.
-- - 빈 audio_url 트랙은 공개 RLS 정책에서 자동 제외
-- - 현재 잘못 박힌 admin_upload 데이터는 visibility='hidden' 으로 정리

-- 1) 깨진 트랙 정리 — visibility='hidden' (release_status='draft' 유지)
--    artist guard trigger 우회 위해 session_replication_role=replica
SET LOCAL session_replication_role = replica;
UPDATE public.tracks
SET visibility_status='hidden'
WHERE visibility_status='approved'
  AND (audio_url IS NULL OR length(btrim(audio_url)) = 0);
RESET session_replication_role;

-- 2) tracks_public_select RLS 정책 — audio_url 가드 추가
DROP POLICY IF EXISTS tracks_public_select ON public.tracks;
CREATE POLICY tracks_public_select ON public.tracks
  FOR SELECT TO anon, authenticated
  USING (
    visibility_status = 'approved'
    AND (
      release_status = 'released'
      OR source_type = 'admin_upload'  -- admin upload 는 release_status='draft' 으로 공개 (legacy)
    )
    AND audio_url IS NOT NULL
    AND length(btrim(audio_url)) > 0
  );

DROP POLICY IF EXISTS tracks_public_select_approved ON public.tracks;

NOTIFY pgrst, 'reload schema';
