/**
 * Supabase RPC / 테이블 에러 분류 헬퍼.
 *
 * 가장 흔한 케이스:
 * - PGRST202: function not found (마이그레이션 미적용)
 * - PGRST205: table not found
 * - 42501  : permission denied
 * - 42P01  : relation does not exist
 * - 42702  : column reference is ambiguous (SQL 버그)
 * - 기타 PG 코드: 함수 본문 버그 → 'unknown' 으로 분류, 원본 메시지 그대로 노출
 *
 * 주의: PostgREST 가 4xx 응답을 줄 때도 fetch 자체는 성공하므로 'network' 로
 *       분류하지 말 것. SQL 버그를 'Supabase 에 연결할 수 없어요' 로 뭉개지 않음.
 */

export type AdminErrorKind =
  | 'migration_missing'
  | 'permission'
  | 'network'
  | 'unknown';

export interface AdminError {
  kind: AdminErrorKind;
  raw: unknown;
  message: string;
}

interface PgLike {
  code?: string;
  message?: string;
  status?: number;
  hint?: string;
  details?: string;
}

function fullMessage(e: PgLike): string {
  const parts: string[] = [];
  if (e.message) parts.push(e.message);
  if (e.details && e.details !== e.message) parts.push(`details: ${e.details}`);
  if (e.hint) parts.push(`hint: ${e.hint}`);
  if (e.code) parts.push(`code: ${e.code}`);
  return parts.length > 0 ? parts.join('\n') : String(e);
}

export function classifyAdminError(err: unknown): AdminError {
  const e = (err ?? {}) as PgLike;
  const code = e.code ?? '';
  const msg = e.message ?? String(err);
  const status = e.status ?? 0;

  // migration_missing: 함수/테이블/관계 누락
  if (
    code === 'PGRST202' ||
    code === 'PGRST205' ||
    code === '42883' || // undefined_function
    code === '42P01' || // undefined_table
    /could not find the function/i.test(msg) ||
    /relation .* does not exist/i.test(msg) ||
    /function .* does not exist/i.test(msg) ||
    status === 404
  ) {
    return { kind: 'migration_missing', raw: err, message: fullMessage(e) };
  }

  // permission
  if (code === '42501' || /permission denied/i.test(msg) || status === 401 || status === 403) {
    return { kind: 'permission', raw: err, message: fullMessage(e) };
  }

  // SQL 함수 본문 버그 (ambiguous / syntax / type mismatch 등) → 'unknown' 으로
  // 분류해 원본 메시지를 그대로 노출. 'network' 로 뭉개지 않음.
  if (code && /^[0-9A-Z]{5}$/.test(code)) {
    return { kind: 'unknown', raw: err, message: fullMessage(e) };
  }

  // 진짜 네트워크 오류만 'network' — fetch 실패 메시지 정확히 매칭.
  if (
    status === 0 ||
    /^TypeError: (Failed to fetch|NetworkError)/i.test(msg) ||
    /^Failed to fetch$/i.test(msg)
  ) {
    return { kind: 'network', raw: err, message: fullMessage(e) };
  }

  return { kind: 'unknown', raw: err, message: fullMessage(e) };
}
