/**
 * Supabase RPC / 테이블 에러 분류 헬퍼.
 *
 * 가장 흔한 케이스:
 * - PGRST202: function not found (마이그레이션 미적용)
 * - PGRST205: table not found
 * - 42501  : permission denied
 * - 42P01  : relation does not exist
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
}

export function classifyAdminError(err: unknown): AdminError {
  const e = (err ?? {}) as PgLike;
  const code = e.code ?? '';
  const msg = e.message ?? String(err);
  const status = e.status ?? 0;

  if (
    code === 'PGRST202' ||
    code === 'PGRST205' ||
    code === '42883' ||
    code === '42P01' ||
    /could not find the function/i.test(msg) ||
    /does not exist/i.test(msg) ||
    status === 404
  ) {
    return {
      kind: 'migration_missing',
      raw: err,
      message: msg,
    };
  }

  if (code === '42501' || /permission denied/i.test(msg) || status === 401 || status === 403) {
    return { kind: 'permission', raw: err, message: msg };
  }

  if (/fetch|network|failed to fetch/i.test(msg) || status === 0) {
    return { kind: 'network', raw: err, message: msg };
  }

  return { kind: 'unknown', raw: err, message: msg };
}
