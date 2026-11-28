import { errorMessage } from '@/lib/errorMessage';

/** 서버 오류를 사용자 문구로 — 개발자용 원문(permission denied 등)이 화면에 나오지 않게. */
export function playlistDetailErrorMessage(e: unknown): string {
  const raw = errorMessage(e);
  if (/forbidden/i.test(raw)) return '비공개 플레이리스트라 볼 수 없어요.';
  if (/permission denied|JWT|not authenticated|login_required/i.test(raw)) return '로그인 후 볼 수 있어요.';
  if (/시간|timeout|timed out/i.test(raw)) return '불러오는 데 시간이 오래 걸려요. 잠시 후 다시 시도해 주세요.';
  return '플레이리스트를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.';
}
