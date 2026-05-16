/**
 * adminLogsApi.ts
 *
 * 운영 로그 (admin_operation_logs) 클라이언트 API.
 */

import { supabase } from './supabase';

export type LogLevel = 'info' | 'success' | 'warning' | 'error';
export type LogCategory = 'payment' | 'webhook' | 'analytics' | 'member' | 'system' | 'rpc';

export interface AdminOperationLog {
  id: string;
  source: string;
  category: string;
  level: LogLevel;
  status: string;
  message: string;
  details: Record<string, unknown>;
  user_id: string | null;
  user_email: string | null;
  related_id: string | null;
  duration_ms: number | null;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
}

export interface OperationLogKpi {
  errors_24h: number;
  warnings_24h: number;
  success_24h: number;
  payment_24h: number;
  total_24h: number;
}

export async function fetchAdminOperationLogs(filters: {
  limit?: number;
  level?: LogLevel | null;
  category?: LogCategory | null;
  source?: string | null;
  search?: string | null;
}): Promise<{ rows: AdminOperationLog[]; error: string | null }> {
  try {
    const { data, error } = await supabase.rpc('list_admin_operation_logs', {
      p_limit: filters.limit ?? 100,
      p_level: filters.level ?? null,
      p_category: filters.category ?? null,
      p_source: filters.source ?? null,
      p_search: filters.search ?? null,
    });
    if (error) {
      if (import.meta.env.DEV) console.error('[fetchAdminOperationLogs]', error);
      return {
        rows: [],
        error: `list_admin_operation_logs [${error.code ?? '?'}] ${error.message}`,
      };
    }
    return { rows: (data ?? []) as AdminOperationLog[], error: null };
  } catch (e) {
    return { rows: [], error: e instanceof Error ? e.message : 'unknown' };
  }
}

export async function fetchAdminOperationLogKpi(): Promise<{
  kpi: OperationLogKpi | null;
  error: string | null;
}> {
  try {
    const { data, error } = await supabase.rpc('admin_operation_log_kpi');
    if (error) {
      if (import.meta.env.DEV) console.error('[fetchAdminOperationLogKpi]', error);
      return { kpi: null, error: error.message };
    }
    return { kpi: data as OperationLogKpi, error: null };
  } catch (e) {
    return { kpi: null, error: e instanceof Error ? e.message : 'unknown' };
  }
}

export async function clearOldAdminOperationLogs(
  days = 30,
): Promise<{ ok: boolean; deleted?: number; error?: string }> {
  try {
    const { data, error } = await supabase.rpc('clear_old_admin_operation_logs', {
      p_days: days,
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true, deleted: typeof data === 'number' ? data : 0 };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'unknown' };
  }
}
