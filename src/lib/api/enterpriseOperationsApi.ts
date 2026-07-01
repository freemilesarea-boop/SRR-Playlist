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
