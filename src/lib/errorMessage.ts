/**
 * 다양한 error 형태 (Error / PostgrestError / 일반 객체 / 문자열) 를 사용자 친화 메시지로 변환.
 *
 * 배경: Supabase PostgrestError 는 `instanceof Error === false` 인 plain 객체라
 * `String(err)` 시 "[object Object]" 가 노출됨. 모든 admin 영역 toast 에서 동일 패턴 방지.
 */
export function errorMessage(err: unknown): string {
  if (err == null) return '알 수 없는 오류';
  if (err instanceof Error) return err.message || err.toString();
  if (typeof err === 'string') return err;
  if (typeof err === 'object') {
    const obj = err as Record<string, unknown>;
    // Supabase PostgrestError
    if (typeof obj.message === 'string' && obj.message) return obj.message;
    // OAuth / fetch 에러
    if (typeof obj.error_description === 'string') return obj.error_description as string;
    if (typeof obj.error === 'string') return obj.error as string;
    if (typeof obj.detail === 'string') return obj.detail as string;
    // 마지막 fallback — JSON stringify
    try {
      return JSON.stringify(err);
    } catch {
      return '[unknown error]';
    }
  }
  return String(err);
}
