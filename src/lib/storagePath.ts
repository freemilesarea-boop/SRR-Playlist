/**
 * storagePath.ts — Supabase Storage object key(path) 생성 유틸.
 *
 * Storage key 는 URL-safe ASCII 만 안전하다. 한국어/일본어/공백/특수문자/emoji/URL
 * reserved 문자가 들어가면 "Invalid key" 오류로 업로드가 실패한다.
 * 따라서 사용자 곡 제목/원본 파일명은 DB(title 등)로만 관리하고, 실제 storage path 는
 * UUID 기반으로 안전하게 생성한다. (path 에는 사용자 입력 문자열을 절대 넣지 않는다.)
 *
 * 허용 문자: [a-zA-Z0-9-_./]
 */

const SAFE_TOKEN_RE = /[^a-zA-Z0-9\-_]/g;
const SAFE_EXT_RE = /^[a-z0-9]{1,8}$/;

/** 파일명에서 확장자만 안전하게 추출 (소문자 영숫자만, 미상/이상 시 fallback). */
export function safeExtension(fileName: string | undefined | null, fallback = 'bin'): string {
  const ext = (fileName ?? '').split('.').pop()?.toLowerCase().trim() ?? '';
  return SAFE_EXT_RE.test(ext) ? ext : fallback;
}

/**
 * 임의 문자열을 storage-safe 토큰으로 변환한다.
 * 허용되지 않는 문자(한국어/공백/특수문자/emoji 등)는 모두 제거. 비면 fallback.
 */
export function sanitizeStorageKey(input: string | undefined | null, fallback = ''): string {
  const cleaned = (input ?? '')
    .normalize('NFKD')
    .replace(SAFE_TOKEN_RE, '')
    .slice(0, 64);
  return cleaned || fallback;
}

/**
 * 업로드용 안전 storage path 생성.
 * 형식: {prefix}/{userId}/{uuid}.{ext}  또는  {prefix}/{userId}/{uuid}_{suffix}.{ext}
 * 사용자 파일명/제목은 절대 포함하지 않는다.
 */
export function generateSafeStoragePath(opts: {
  prefix: string;
  userId: string;
  ext: string;
  suffix?: string;
}): string {
  const prefix = sanitizeStorageKey(opts.prefix, 'uploads');
  const userId = sanitizeStorageKey(opts.userId, 'unknown');
  const ext = SAFE_EXT_RE.test(opts.ext) ? opts.ext : 'bin';
  const id = crypto.randomUUID();
  const base = opts.suffix ? `${id}_${sanitizeStorageKey(opts.suffix, 'x')}` : id;
  return `${prefix}/${userId}/${base}.${ext}`;
}
