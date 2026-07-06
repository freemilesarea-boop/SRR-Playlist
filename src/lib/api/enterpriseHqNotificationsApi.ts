/**
 * enterpriseHqNotificationsApi — Phase 3-5
 *
 * HQ 알림/장애 관리 (/enterprise/notifications) 전용 wrapper.
 * super admin admin_* 무변경 · HQ scope RPC 만 호출.
 *
 * SQL: supabase/migrations/0403_enterprise_hq_notification_center.sql
 */
import { supabase } from '@/lib/supabase';

// =============================================================================
// Types
// =============================================================================

export type IncidentType =
  | 'store_offline' | 'heartbeat_stale' | 'policy_sync_stale' | 'playback_error'
  | 'now_playing_missing' | 'carryover_created' | 'settlement_paid_blocked';

export type IncidentSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';
export type IncidentStatus = 'open' | 'acknowledged' | 'resolved';

export interface HqIncidentKpi {
  open: number;
  acknowledged: number;
  critical_open: number;
  resolved_today: number;
  unread_notifications: number;
  computed_at: string;
}

export interface HqIncident {
  id: string;
  enterprise_account_id: string;
  store_id: string | null;
  store_name: string | null;
  incident_type: IncidentType;
  severity: IncidentSeverity;
  status: IncidentStatus;
  title: string;
  message: string | null;
  source: string;
  source_ref_id: string | null;
  detected_at: string;
  last_seen_at: string;
  occurrence_count: number;
  acknowledged_at: string | null;
  resolved_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface HqIncidentListInput {
  status?: IncidentStatus | null;
  severity?: IncidentSeverity | null;
  type?: IncidentType | null;
  limit?: number;
  offset?: number;
}

export interface HqIncidentListResult {
  success: boolean;
  data: HqIncident[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
    has_more: boolean;
  };
}

export type IncidentEventType =
  | 'created' | 'acknowledged' | 'resolved' | 'recurrence'
  | 'scan_updated' | 'notification_sent' | 'metadata_updated';

export interface HqIncidentEvent {
  id: string;
  event_type: IncidentEventType;
  message: string | null;
  actor_user_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface HqIncidentDetail {
  success: boolean;
  incident: HqIncident & {
    acknowledged_by: string | null;
    resolved_by: string | null;
  };
  events: HqIncidentEvent[];
}

export interface HqNotification {
  id: string;
  enterprise_account_id: string;
  incident_id: string | null;
  target_type: 'user' | 'role' | 'region';
  target_id: string | null;
  recipient_user_id: string;
  notification_type: string;
  title: string;
  message: string;
  severity: IncidentSeverity;
  status: 'unread' | 'read';
  read_at: string | null;
  action_url: string | null;
  delivery_channels: Record<string, unknown>;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface HqNotificationListResult {
  success: boolean;
  data: HqNotification[];
  unread_count: number;
  pagination: {
    total: number;
    limit: number;
    offset: number;
    has_more: boolean;
  };
}

export interface HqNotificationPolicy {
  id: string;
  enterprise_account_id: string;
  scope_type: 'brand' | 'region' | 'franchise' | 'store';
  scope_id: string | null;
  incident_type: IncidentType;
  enabled: boolean;
  severity: IncidentSeverity;
  threshold_minutes: number;
  cooldown_minutes: number;
  channels: Record<string, boolean>;
  created_at: string;
  updated_at: string;
}

export interface HqPolicyUpdateInput {
  incident_type: IncidentType;
  enabled: boolean;
  severity: IncidentSeverity;
  threshold_minutes: number;
  cooldown_minutes: number;
  channels?: Record<string, boolean>;
}

export interface HqScanResult {
  success: boolean;
  scan_started_at: string;
  scan_finished_at: string;
  duration_ms: number;
  scanned_store_count: number;
  created_count: number;
  updated_count: number;
  notification_created_count: number;
  skipped_count: number;
  skipped_reasons: Record<string, number>;
  by_type: Record<string, number>;
}

// =============================================================================
// RPC wrappers
// =============================================================================

export async function getMyEnterpriseIncidentKpi(): Promise<HqIncidentKpi> {
  const { data, error } = await supabase.rpc('get_my_enterprise_incident_kpi');
  if (error) {
    console.error('[hq-notif] kpi failed', error);
    throw new Error(error.message || 'KPI 조회 실패');
  }
  return data as HqIncidentKpi;
}

export async function getMyEnterpriseIncidents(
  input: HqIncidentListInput = {},
): Promise<HqIncidentListResult> {
  const { data, error } = await supabase.rpc('get_my_enterprise_incidents', {
    p_status: input.status ?? null,
    p_severity: input.severity ?? null,
    p_type: input.type ?? null,
    p_limit: input.limit ?? 50,
    p_offset: input.offset ?? 0,
  });
  if (error) {
    console.error('[hq-notif] incidents failed', error);
    throw new Error(error.message || 'Incident 목록 조회 실패');
  }
  return data as HqIncidentListResult;
}

export async function getMyEnterpriseIncidentDetail(incidentId: string): Promise<HqIncidentDetail> {
  const { data, error } = await supabase.rpc('get_my_enterprise_incident_detail', {
    p_incident_id: incidentId,
  });
  if (error) {
    console.error('[hq-notif] incident detail failed', error);
    throw new Error(error.message || 'Incident 상세 조회 실패');
  }
  return data as HqIncidentDetail;
}

export async function acknowledgeMyEnterpriseIncident(incidentId: string): Promise<{ success: boolean; incident_id: string; status: 'acknowledged' }> {
  const { data, error } = await supabase.rpc('acknowledge_my_enterprise_incident', {
    p_incident_id: incidentId,
  });
  if (error) {
    console.error('[hq-notif] acknowledge failed', error);
    throw new Error(error.message || 'Ack 처리 실패');
  }
  return data as { success: boolean; incident_id: string; status: 'acknowledged' };
}

export async function resolveMyEnterpriseIncident(incidentId: string): Promise<{ success: boolean; incident_id: string; status: 'resolved' }> {
  const { data, error } = await supabase.rpc('resolve_my_enterprise_incident', {
    p_incident_id: incidentId,
  });
  if (error) {
    console.error('[hq-notif] resolve failed', error);
    throw new Error(error.message || 'Resolve 처리 실패');
  }
  return data as { success: boolean; incident_id: string; status: 'resolved' };
}

export async function getMyEnterpriseNotifications(
  limit = 50,
  offset = 0,
  unreadOnly = false,
): Promise<HqNotificationListResult> {
  const { data, error } = await supabase.rpc('get_my_enterprise_notifications', {
    p_limit: limit,
    p_offset: offset,
    p_unread_only: unreadOnly,
  });
  if (error) {
    console.error('[hq-notif] notifications failed', error);
    throw new Error(error.message || '알림 조회 실패');
  }
  return data as HqNotificationListResult;
}

export async function markMyEnterpriseNotificationRead(id: string): Promise<{ success: boolean; updated: number }> {
  const { data, error } = await supabase.rpc('mark_my_enterprise_notification_read', {
    p_notification_id: id,
  });
  if (error) {
    console.error('[hq-notif] mark read failed', error);
    throw new Error(error.message || '읽음 처리 실패');
  }
  return data as { success: boolean; updated: number };
}

export async function markAllMyEnterpriseNotificationsRead(): Promise<{ success: boolean; updated: number }> {
  const { data, error } = await supabase.rpc('mark_all_my_enterprise_notifications_read');
  if (error) {
    console.error('[hq-notif] mark all failed', error);
    throw new Error(error.message || '전체 읽음 처리 실패');
  }
  return data as { success: boolean; updated: number };
}

export async function getMyEnterpriseNotificationPolicies(): Promise<{ success: boolean; data: HqNotificationPolicy[] }> {
  const { data, error } = await supabase.rpc('get_my_enterprise_notification_policies');
  if (error) {
    console.error('[hq-notif] policies failed', error);
    throw new Error(error.message || '정책 조회 실패');
  }
  return data as { success: boolean; data: HqNotificationPolicy[] };
}

export async function updateMyEnterpriseNotificationPolicy(
  input: HqPolicyUpdateInput,
): Promise<{ success: boolean; policy: HqNotificationPolicy }> {
  const { data, error } = await supabase.rpc('update_my_enterprise_notification_policy', {
    p_incident_type: input.incident_type,
    p_enabled: input.enabled,
    p_severity: input.severity,
    p_threshold_minutes: input.threshold_minutes,
    p_cooldown_minutes: input.cooldown_minutes,
    p_channels: input.channels ?? null,
  });
  if (error) {
    console.error('[hq-notif] policy update failed', error);
    throw new Error(error.message || '정책 업데이트 실패');
  }
  return data as { success: boolean; policy: HqNotificationPolicy };
}

export async function runMyEnterpriseIncidentScan(): Promise<HqScanResult> {
  const { data, error } = await supabase.rpc('run_my_enterprise_incident_scan');
  if (error) {
    console.error('[hq-notif] scan failed', error);
    throw new Error(error.message || '스캔 실행 실패');
  }
  return data as HqScanResult;
}

// =============================================================================
// UI helpers
// =============================================================================

export const INCIDENT_TYPE_LABEL: Record<IncidentType, string> = {
  store_offline: '오프라인 매장',
  heartbeat_stale: 'Heartbeat 지연',
  policy_sync_stale: '정책 sync 지연',
  playback_error: '재생 오류',
  now_playing_missing: '재생 정보 없음',
  carryover_created: 'Carryover 발생',
  settlement_paid_blocked: '지급 차단',
};

export const INCIDENT_SEVERITY_LABEL: Record<IncidentSeverity, string> = {
  critical: '위험',
  high: '높음',
  medium: '보통',
  low: '낮음',
  info: '정보',
};

export const INCIDENT_STATUS_LABEL: Record<IncidentStatus, string> = {
  open: '열림',
  acknowledged: '확인됨',
  resolved: '해결됨',
};

/**
 * AI Recommendation — rule-based (GPT 호출 없음).
 * 규칙 매치 시 문구 반환. 매치 없음이면 null.
 */
export function getIncidentAiRecommendation(type: IncidentType): string {
  switch (type) {
    case 'store_offline':
      return '매장 네트워크·전원·브라우저 실행 상태를 순서대로 확인해주세요. 재접속되면 자동으로 해제됩니다.';
    case 'heartbeat_stale':
      return '매장 PC 또는 플레이어 실행 상태를 먼저 확인하세요. 이후 운영 관제에서 정책 재동기화를 실행해보세요.';
    case 'policy_sync_stale':
      return '운영 관제에서 정책 재동기화를 실행하고, 5분 뒤 동기화 시간을 다시 확인하세요.';
    case 'playback_error':
      return '오디오 출력 장치와 플레이어 상태를 확인해주세요. 재생이 정상 복구되면 해제됩니다.';
    case 'now_playing_missing':
      return '매장은 온라인이지만 재생 정보가 수신되지 않았어요. 플레이어가 정상 재생 중인지 매장에 확인해주세요.';
    case 'carryover_created':
      return '최소정산금 미달로 이월되었어요. 다음 달 누적 지급 조건을 확인해주세요.';
    case 'settlement_paid_blocked':
      return '지급 조건 또는 이월 chain 상태를 확인한 뒤 정산센터에서 재검토하세요.';
  }
}
