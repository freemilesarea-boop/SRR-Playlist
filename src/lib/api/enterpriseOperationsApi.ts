/**
 * enterpriseOperationsApi — Phase 2-1 (Enterprise Operations Center)
 *
 * Read-only RPC wrapper for `/admin → 운영 관제` 탭.
 * SQL: supabase/migrations/0395_enterprise_operations_center.sql
 *
 * 원칙:
 *   • 4개 신규 admin_enterprise_ops_* RPC 만 호출
 *   • 기존 NOC / policy-automation / now-playing RPC 는 각 도메인 API 를 호출
 *     (여기서는 중복 wrapper 를 만들지 않음)
 *   • 절대 mutation 없음
 *   • 초기 렌더에서 모든 카드가 병렬 fetch — Promise.all 로 묶어 사용 권장
 */
import { supabase } from '@/lib/supabase';

// ============================================================================
// Types — RPC 반환 jsonb shape
// ============================================================================

export interface EnterpriseOpsOverview {
  enterprise_accounts: number;
  hq_users: number;
  total_stores: number;
  online_stores: number;
  offline_stores: number;
  drift_stores: number;
  failed_sync_stores: number;
  noc: {
    critical?: number;
    major?: number;
    minor?: number;
    offline?: number;
    policy_drift?: number;
    playback_error?: number;
    heartbeat_missing?: number;
    device_disconnected?: number;
    version_update_needed?: number;
    [k: string]: unknown;
  };
  now_playing: {
    total?: number;
    online?: number;
    offline?: number;
    error_count?: number;
    [k: string]: unknown;
  };
  last_cron_run_at: string | null;
  overall_status: 'healthy' | 'warning' | 'critical';
  computed_at: string;
}

export interface EnterpriseOpsCronRun {
  id: string | number;
  created_at: string;
  level: string | null;
  status: string | null;
  message: string;
  details: Record<string, unknown> | null;
}

export interface EnterpriseOpsCronStatus {
  last_run_at: string | null;
  runs_1h: number;
  runs_24h: number;
  failed_24h: number;
  last_error: string | null;
  recent_runs: EnterpriseOpsCronRun[];
  computed_at: string;
}

export interface EnterpriseOpsNotificationRecent {
  id: number;
  kind: string;
  severity: 'info' | 'warning' | 'error' | string;
  title: string;
  created_at: string;
  dispatched_at: string | null;
  dispatch_slack_at: string | null;
  dispatch_email_at: string | null;
  dispatch_attempts: number | null;
  dispatch_error: string | null;
}

export interface EnterpriseOpsNotificationsSummary {
  pending: number;
  dispatched: number;
  failed: number;
  slack_sent: number;
  email_sent: number;
  noc_alert_count: number;
  dispatch_error_count: number;
  recent: EnterpriseOpsNotificationRecent[];
  computed_at: string;
}

export type EnterpriseOpsActivityType =
  | 'cron_run'
  | 'notification'
  | 'policy_automation'
  | 'announcement_play'
  | 'settlement_snapshot';

export interface EnterpriseOpsActivityEvent {
  type: EnterpriseOpsActivityType;
  id: string;
  at: string;
  title: string;
  severity: 'info' | 'success' | 'warning' | 'error' | string;
  meta: Record<string, unknown>;
}

export interface EnterpriseOpsActivityFeed {
  events: EnterpriseOpsActivityEvent[];
  limit: number;
  computed_at: string;
}

// ============================================================================
// RPC calls
// ============================================================================

export async function fetchEnterpriseOpsOverview(): Promise<EnterpriseOpsOverview> {
  const { data, error } = await supabase.rpc('admin_enterprise_ops_overview');
  if (error) { console.error('[enterpriseOps] overview failed', error); throw error; }
  return data as EnterpriseOpsOverview;
}

export async function fetchEnterpriseOpsCronStatus(): Promise<EnterpriseOpsCronStatus> {
  const { data, error } = await supabase.rpc('admin_enterprise_ops_cron_status');
  if (error) { console.error('[enterpriseOps] cron status failed', error); throw error; }
  return data as EnterpriseOpsCronStatus;
}

export async function fetchEnterpriseOpsNotificationsSummary(): Promise<EnterpriseOpsNotificationsSummary> {
  const { data, error } = await supabase.rpc('admin_enterprise_ops_notifications_summary');
  if (error) { console.error('[enterpriseOps] notifications summary failed', error); throw error; }
  return data as EnterpriseOpsNotificationsSummary;
}

export async function fetchEnterpriseOpsActivityFeed(limit = 20): Promise<EnterpriseOpsActivityFeed> {
  const { data, error } = await supabase.rpc('admin_enterprise_ops_activity_feed', { p_limit: limit });
  if (error) { console.error('[enterpriseOps] activity feed failed', error); throw error; }
  return data as EnterpriseOpsActivityFeed;
}


// ============================================================================
// Phase 2-2 — Quick Actions (5 activated; Generate Settlement deferred to 2-3)
// ============================================================================

export interface QuickActionOutcome {
  ok: boolean;
  status?: number;
  duration_ms?: number;
  detail?: unknown;
  error?: string;
}

/**
 * Server audit helper. RPC 자체 실패해도 mutation 결과에 영향 주지 않도록 silent.
 * (0197 admin_log_operation 은 서버 사이드 게이트 있음 — 일반 사용자는 무시됨.)
 */
async function audit(
  category: string, level: 'success' | 'error', status: 'success' | 'failed',
  message: string, details: Record<string, unknown>, error_message?: string,
): Promise<void> {
  try {
    await supabase.rpc('admin_log_operation', {
      p_source: 'enterprise_operations',
      p_category: category,
      p_level: level,
      p_status: status,
      p_message: message,
      p_details: details,
      ...(error_message ? { p_error_message: error_message } : {}),
    });
  } catch { /* silent — log 실패가 mutation 자체를 실패시키지 않음 */ }
}

/**
 * QA-1: Run Enterprise Cron (via /api/admin/enterprise-ops-run server wrapper).
 * 서버 wrapper 가 CRON_SECRET 부착 + super_admin 검증 + 60s debounce 처리.
 *
 * 응답 body 예시 (실제 서버 스키마):
 *   200: { ok:true,  upstream_status, ran_at, duration_ms, upstream }
 *   429: { error:'debounced', wait_seconds }
 *   403: { error:'forbidden', reason:'not_admin'|'invalid_token'|... }
 *   500: { error:'missing_env', hint } | { ok:false, error }
 *   502: { ok:false, upstream_status, upstream }
 *
 * 요구사항: 사용자에게 'unknown' 을 노출하지 말 것. status + 서버 error 문구를 항상 조합.
 */
export async function runEnterpriseOpsCron(): Promise<QuickActionOutcome> {
  const t0 = performance.now();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { ok: false, error: '세션 없음 — 다시 로그인 후 시도하세요.' };
  try {
    const r = await fetch('/api/admin/enterprise-ops-run', {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.access_token}`, 'content-type': 'application/json' },
    });
    const raw = await r.text().catch(() => '');
    let body: unknown = raw;
    try { body = raw ? JSON.parse(raw) : raw; } catch { /* raw 유지 */ }
    const durMs = Math.round(performance.now() - t0);
    if (r.ok) {
      return { ok: true, status: r.status, duration_ms: durMs, detail: body };
    }
    return {
      ok: false, status: r.status, duration_ms: durMs, detail: body,
      error: summarizeHttpError(r.status, body),
    };
  } catch (e) {
    return { ok: false, error: (e as Error).message, duration_ms: Math.round(performance.now() - t0) };
  }
}

/**
 * HTTP 실패 응답 body 에서 사람이 읽을 수 있는 요약 문구를 만든다.
 * status + 알려진 필드(error/reason/message/hint/wait_seconds/upstream) 를 조합.
 * 알아볼 필드가 없으면 body JSON 앞 240자를 그대로 노출.
 * 절대 'unknown' 반환 금지.
 */
function summarizeHttpError(status: number, body: unknown): string {
  if (body && typeof body === 'object') {
    const b = body as Record<string, unknown>;
    const parts: string[] = [];
    if (typeof b.error === 'string' && b.error.trim()) parts.push(b.error.trim());
    if (typeof b.reason === 'string' && b.reason.trim()) parts.push(`(${b.reason.trim()})`);
    if (typeof b.message === 'string' && b.message.trim() && b.message !== b.error) parts.push(b.message.trim());
    if (typeof b.wait_seconds === 'number') parts.push(`${b.wait_seconds}s 후 재시도`);
    if (typeof b.hint === 'string' && b.hint.trim()) parts.push(`hint: ${b.hint.trim()}`);
    if (parts.length === 0 && b.upstream !== undefined) {
      const u = typeof b.upstream === 'string' ? b.upstream : JSON.stringify(b.upstream);
      parts.push(`upstream: ${u.slice(0, 200)}`);
    }
    if (parts.length > 0) return `HTTP ${status} — ${parts.join(' ')}`;
    const dump = JSON.stringify(b).slice(0, 240);
    return `HTTP ${status} — ${dump}`;
  }
  if (typeof body === 'string' && body.trim()) return `HTTP ${status} — ${body.trim().slice(0, 240)}`;
  return `HTTP ${status}`;
}

/**
 * QA-2: Dispatch Pending Notifications (dispatch-admin-notifications edge function).
 * 0392 dispatch 멱등 (dispatched_at IS NULL 만 처리) 을 재사용.
 */
export async function dispatchPendingNotifications(): Promise<QuickActionOutcome> {
  const t0 = performance.now();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { ok: false, error: 'no_session' };
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  try {
    const { data, error } = await supabase.functions.invoke('dispatch-admin-notifications', {
      body: { since_ts: since, limit: 50 },
    });
    const durMs = Math.round(performance.now() - t0);
    if (error) {
      await audit('quick_action.dispatch_pending', 'error', 'failed',
        'admin quick action: dispatch pending', { since_ts: since }, error.message);
      return { ok: false, error: error.message, duration_ms: durMs };
    }
    await audit('quick_action.dispatch_pending', 'success', 'success',
      'admin quick action: dispatch pending', { since_ts: since, result: data ?? null, duration_ms: durMs });
    return { ok: true, duration_ms: durMs, detail: data };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/**
 * QA-3: Recalculate NOC (admin_noc_sync_alerts_to_notifications).
 * 0393 감시 워커 를 즉시 1회 실행. 6h cooldown + dedup index 가 내장.
 */
export async function recalculateNoc(): Promise<QuickActionOutcome> {
  const t0 = performance.now();
  try {
    const { data, error } = await supabase.rpc('admin_noc_sync_alerts_to_notifications', { p_cooldown_hours: 6 });
    const durMs = Math.round(performance.now() - t0);
    if (error) {
      await audit('quick_action.recalculate_noc', 'error', 'failed',
        'admin quick action: recalculate NOC', {}, error.message);
      return { ok: false, error: error.message, duration_ms: durMs };
    }
    await audit('quick_action.recalculate_noc', 'success', 'success',
      'admin quick action: recalculate NOC', { result: data ?? null, duration_ms: durMs });
    return { ok: true, duration_ms: durMs, detail: data };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/**
 * QA-4: Refresh Policy Automation (admin_evaluate_policy_automation_rules, p_dry_run=false).
 * 0378 자동화 엔진 — due 규칙만 처리 + next_run_at 전진 (중복 실행 내장 방지).
 */
export async function refreshPolicyAutomation(): Promise<QuickActionOutcome> {
  const t0 = performance.now();
  try {
    const { data, error } = await supabase.rpc('admin_evaluate_policy_automation_rules', { p_dry_run: false });
    const durMs = Math.round(performance.now() - t0);
    if (error) {
      await audit('quick_action.refresh_policy', 'error', 'failed',
        'admin quick action: refresh policy automation', {}, error.message);
      return { ok: false, error: error.message, duration_ms: durMs };
    }
    await audit('quick_action.refresh_policy', 'success', 'success',
      'admin quick action: refresh policy automation', { result: data ?? null, duration_ms: durMs });
    return { ok: true, duration_ms: durMs, detail: data };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export interface ExportLogsResult {
  success: true;
  source: string;
  category: string | null;
  days: number;
  from_at: string;
  to_at: string;
  row_count: number;
  row_limit: number;
  truncated: boolean;
  rows: Array<{
    id: string; source: string; category: string; level: string; status: string;
    message: string; details: Record<string, unknown>; user_id: string | null;
    related_id: string | null; duration_ms: number | null; error_code: string | null;
    error_message: string | null; created_at: string;
  }>;
  computed_at: string;
}

/**
 * QA-6: Export Logs (admin_enterprise_ops_export_logs, LIMIT 10000).
 * source 기본 'cron', category null. CSV 변환은 client 에서 처리 (browser download).
 */
export async function exportCronLogs(opts: {
  days?: number; source?: string; category?: string | null; limit?: number;
} = {}): Promise<QuickActionOutcome & { data?: ExportLogsResult }> {
  const t0 = performance.now();
  try {
    const { data, error } = await supabase.rpc('admin_enterprise_ops_export_logs', {
      p_days: opts.days ?? 30,
      p_source: opts.source ?? 'cron',
      p_category: opts.category ?? null,
      p_limit: opts.limit ?? 5000,
    });
    const durMs = Math.round(performance.now() - t0);
    if (error) {
      await audit('quick_action.export_logs', 'error', 'failed',
        'admin quick action: export cron logs', { opts }, error.message);
      return { ok: false, error: error.message, duration_ms: durMs };
    }
    const result = data as ExportLogsResult;
    await audit('quick_action.export_logs', 'success', 'success',
      'admin quick action: export cron logs',
      { opts, row_count: result?.row_count ?? 0, truncated: result?.truncated ?? false, duration_ms: durMs });
    return { ok: true, duration_ms: durMs, data: result };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/**
 * Client-side CSV 변환 + browser download 트리거.
 */
export function downloadLogsAsCsv(res: ExportLogsResult, filename?: string): void {
  const headers = ['id', 'source', 'category', 'level', 'status', 'message', 'duration_ms', 'user_id', 'related_id', 'error_code', 'error_message', 'created_at'];
  const escape = (v: unknown): string => {
    if (v === null || v === undefined) return '';
    const s = String(v).replace(/"/g, '""');
    return /[",\n]/.test(s) ? `"${s}"` : s;
  };
  const lines = [headers.join(',')];
  for (const r of res.rows) {
    lines.push(headers.map((h) => escape((r as unknown as Record<string, unknown>)[h])).join(','));
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename ?? `enterprise-ops-logs-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
