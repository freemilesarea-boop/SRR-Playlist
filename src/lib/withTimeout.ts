/**
 * Promise 에 클라이언트 측 hard timeout 부착.
 *
 * supabase global fetch timeout(25s) 이 못 잡는 케이스(예: auth 토큰 refresh
 * deadlock, gotrue 자체 fetch) 까지 페이지 레벨에서 한 번 더 방어.
 * 초과 시 reject → 페이지 catch/finally 동작 → 무한 로딩 차단.
 */
export function withTimeout<T>(promise: Promise<T>, ms = 12_000, label = 'request'): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`시간이 초과됐어요 (${label}). 네트워크를 확인하고 다시 시도해주세요.`));
    }, ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}
