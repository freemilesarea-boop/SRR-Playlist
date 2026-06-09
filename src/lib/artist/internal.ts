// Artist API shared helpers (X6.50 — extracted from artistApi.ts)
// timeout / retry / friendly upload error / fast auth lookup.
// artistApi.ts 와 ./upload.ts 양쪽에서 사용 — 순환 의존성 회피 목적.
import { supabase } from '../supabase';
import { useAuthStore } from '@/store/authStore';

export async function withTimeout<T>(
  promise: Promise<T> | PromiseLike<T>,
  ms: number,
  timeoutMessage: string,
): Promise<T> {
  return await new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(timeoutMessage)), ms);
    Promise.resolve(promise).then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

/**
 * 일시적 지연/네트워크 오류로 실패하면 1회(기본 2회 시도) 재시도.
 * 마지막 시도까지 실패하면 마지막 에러를 그대로 throw (friendly 메시지 유지).
 */
export async function withRetry<T>(fn: () => Promise<T>, attempts = 2, delayMs = 800): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/**
 * 업로드 단계 raw 에러를 사용자 친화 메시지로 변환.
 * AbortError / "signal is aborted without reason" / 네트워크 오류가
 * 사용자에게 그대로 노출되지 않도록 한다.
 */
export function friendlyUploadError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e ?? '');
  const lower = raw.toLowerCase();
  const name = e instanceof Error ? e.name : '';
  if (name === 'AbortError' || lower.includes('aborted') || lower.includes('abort')) {
    return '업로드 연결이 중단됐어요. 다시 시도해주세요.';
  }
  if (
    lower.includes('failed to fetch') ||
    lower.includes('networkerror') ||
    lower.includes('network error') ||
    lower.includes('load failed') ||
    lower.includes('err_network') ||
    lower.includes('connection')
  ) {
    return '네트워크 상태를 확인해주세요. 업로드 연결이 불안정합니다.';
  }
  if (lower.includes('초과') || lower.includes('timeout') || lower.includes('오래')) {
    return '업로드 시간이 오래 걸리고 있어요. 잠시 후 네트워크가 안정되면 다시 시도해주세요.';
  }
  if (
    (lower.includes('exceeded') && (lower.includes('maximum') || lower.includes('size'))) ||
    lower.includes('too large') ||
    lower.includes('payload too large') ||
    lower.includes('413')
  ) {
    return '파일 용량이 업로드 한도를 초과했어요. (현재 플랜의 곡당 업로드 한도를 확인해주세요)';
  }
  if (lower.includes('invalid key') || lower.includes('invalid_key') || lower.includes('key is not valid')) {
    return '파일 업로드에 실패했어요. 잠시 후 다시 시도해주세요.';
  }
  return raw.trim() ? `업로드 실패: ${raw}` : '파일 업로드에 실패했어요. 다시 시도해주세요.';
}

/**
 * 0077-hotfix — 업로드/저장 등 user.id 만 필요한 액션에서 사용할 빠른 user 조회.
 *
 * `supabase.auth.getSession()` 이 토큰 refresh / 네트워크 지연으로 무한 pending 되면
 * 업로드 전체가 막힘. 다음 순서로 fallback:
 *   1) authStore 캐시 user (즉시, 동기)
 *   2) supabase.auth.getUser() — 5초 timeout (서버 검증 포함)
 *   3) supabase.auth.getSession() — 5초 timeout (refresh 가능)
 */
export async function getCurrentUserFast(): Promise<{ id: string; email: string | null } | null> {
  const log = (msg: string, extra?: Record<string, unknown>) =>
    console.info('[auth-fast]', msg, extra ?? '');

  try {
    const cached = useAuthStore.getState().user;
    if (cached?.id) {
      log('cache hit', { uid: cached.id.slice(0, 8) + '…' });
      return { id: cached.id, email: cached.email ?? null };
    }
  } catch (e) {
    log('cache read failed', { err: e instanceof Error ? e.message : String(e) });
  }

  try {
    const { data, error } = await withTimeout(
      supabase.auth.getUser(),
      5_000,
      'auth.getUser timeout',
    );
    if (!error && data.user?.id) {
      log('getUser ok', { uid: data.user.id.slice(0, 8) + '…' });
      return { id: data.user.id, email: data.user.email ?? null };
    }
    log('getUser empty', { err: error?.message });
  } catch (e) {
    log('getUser timeout/fail', { err: e instanceof Error ? e.message : String(e) });
  }

  try {
    const { data } = await withTimeout(
      supabase.auth.getSession(),
      5_000,
      'auth.getSession timeout',
    );
    const u = data.session?.user;
    if (u?.id) {
      log('getSession ok', { uid: u.id.slice(0, 8) + '…' });
      return { id: u.id, email: u.email ?? null };
    }
    log('getSession empty');
  } catch (e) {
    log('getSession timeout/fail', { err: e instanceof Error ? e.message : String(e) });
  }

  log('ALL fallbacks failed');
  return null;
}
