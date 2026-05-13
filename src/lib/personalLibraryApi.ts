/**
 * personalLibraryApi.ts
 *
 * 개인 라이브러리(좋아요/최근/이어듣기) 공개 API 진입점.
 * 실제 구현은 libraryApi.ts 에 있으며, 이 파일은 호출 측에서 한 곳에서
 * import 할 수 있게 큐레이션한 재노출 모듈.
 *
 * 사용:
 *   import {
 *     fetchLikedTracks, likeTrack, unlikeTrack, toggleTrackLike, isTrackLiked,
 *     pushRecentlyPlayed, fetchRecentlyPlayed,
 *     saveContinueListening, fetchContinueListening, clearContinueListening,
 *     mergePersonalLibrary,
 *   } from '@/lib/personalLibraryApi';
 *
 * 동작:
 *   - 로그인 user 가 있으면 Supabase DB 사용
 *   - 미로그인 / DB 미적용 / RLS 실패 시 localStorage 폴백 (조용히)
 *   - 콘솔 에러 폭주 없음
 */

export {
  // 좋아요
  fetchLikedTracks,
  fetchLikedTrackIds,
  likeTrack,
  unlikeTrack,
  toggleTrackLike,
  isTrackLiked,
  type LikeResult,
  // 최근 재생
  pushRecentlyPlayed,
  fetchRecentlyPlayedTracks as fetchRecentlyPlayed,
  // 이어듣기 (full state)
  saveContinueListening,
  saveContinueListeningFull,
  fetchContinueListening,
  clearContinueListening,
  type ContinueListening,
  type ContinueListeningFullPayload,
  // 라이브러리 통합 뷰
  fetchLibraryOverview,
  type LibraryOverview,
  // 로그인 시 localStorage → DB 머지
  mergeLocalToDb as mergePersonalLibrary,
} from './libraryApi';
