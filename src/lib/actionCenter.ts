/**
 * actionCenter — Operations Action Center 순수 로직 (카탈로그·권한·큐·상태).
 *
 * Action Center 는 운영 실행 계층이다. 실행 자체는 기존 admin RPC 를 재사용하며,
 * 여기서는 Action 표준화(카탈로그)·권한(Role 매트릭스)·큐 도출·상태 표시 등 순수
 * 로직만 둔다(단위 테스트 대상). 새 실행 로직 없음.
 */
import type { ActionCommandStatus } from './adminApi';

/* ── Role 모델 (오름차순) ─────────────────────────────────────────── */
export type Role = 'viewer' | 'operator' | 'manager' | 'admin' | 'super_admin';
export const ROLE_ORDER: Role[] = ['viewer', 'operator', 'manager', 'admin', 'super_admin'];
export const ROLE_LABEL: Record<Role, string> = {
  viewer: 'Viewer', operator: 'Operator', manager: 'Manager', admin: 'Admin', super_admin: 'Super Admin',
};

export function roleRank(role: Role): number { return ROLE_ORDER.indexOf(role); }

/* ── Action 카탈로그 (실행=기존 RPC 재사용 or 미지원 링크) ─────────── */
export type ActionReuse =
  | { kind: 'rpc'; ref: string }        // 기존 admin RPC 재사용
  | { kind: 'link'; ref: string }       // 관련 Dashboard 이동(실행 RPC 없음 = 미지원)
  | { kind: 'unsupported' };            // 실행/링크 모두 없음

export interface ActionDef {
  id: string;
  label: string;
  targetType: 'store' | 'user' | 'business' | 'qc' | 'policy' | 'artist' | 'system';
  danger: boolean;          // Danger Zone / 확인 문구 필수
  minRole: Role;            // 실행 최소 권한
  bulk: boolean;            // Bulk 지원
  reuse: ActionReuse;       // 실행 방식
  impact: string;           // 영향도
  requiresApproval: boolean;
}

export const ACTION_CATALOG: ActionDef[] = [
  { id: 'store_resync',   label: '매장 재동기화 (Cache/Player)', targetType: 'store',   danger: false, minRole: 'operator', bulk: true,  reuse: { kind: 'rpc', ref: 'admin_force_store_resync' }, impact: '해당 매장 정책/재생 강제 재동기화', requiresApproval: false },
  { id: 'qc_retry',       label: 'QC 대기 재처리',               targetType: 'qc',      danger: false, minRole: 'operator', bulk: false, reuse: { kind: 'rpc', ref: 'admin_retry_pending_qc' }, impact: '대기 중 QC 항목 재큐잉', requiresApproval: false },
  { id: 'qc_bulk_approve',label: 'QC 일괄 승인',                 targetType: 'qc',      danger: false, minRole: 'manager',  bulk: true,  reuse: { kind: 'rpc', ref: 'admin_bulk_approve_tracks' }, impact: '선택 음원 일괄 승인(유통 가능)', requiresApproval: true },
  { id: 'qc_bulk_reject', label: 'QC 일괄 반려',                 targetType: 'qc',      danger: true,  minRole: 'admin',    bulk: true,  reuse: { kind: 'rpc', ref: 'admin_bulk_reject_tracks' }, impact: '선택 음원 일괄 반려', requiresApproval: true },
  { id: 'policy_retry',   label: '정책 배포 재시도',             targetType: 'policy',  danger: false, minRole: 'operator', bulk: false, reuse: { kind: 'rpc', ref: 'admin_request_policy_retry' }, impact: '실패한 정책 배포 재시도', requiresApproval: false },
  { id: 'user_enable',    label: '사용자/사업자 활성화',         targetType: 'user',    danger: false, minRole: 'manager',  bulk: false, reuse: { kind: 'rpc', ref: 'admin_enable_user' }, impact: '정지 해제 → 서비스 재개', requiresApproval: false },
  { id: 'force_signout',  label: '강제 로그아웃',                targetType: 'user',    danger: false, minRole: 'manager',  bulk: false, reuse: { kind: 'rpc', ref: 'admin_force_sign_out_user' }, impact: '모든 세션 토큰 무효화', requiresApproval: false },
  { id: 'grant_curator',  label: '큐레이터 권한 부여',           targetType: 'user',    danger: false, minRole: 'manager',  bulk: false, reuse: { kind: 'rpc', ref: 'admin_grant_curator' }, impact: '큐레이터 권한 부여', requiresApproval: false },
  { id: 'user_disable',   label: '사업자/사용자 정지 (Suspend)', targetType: 'user',    danger: true,  minRole: 'admin',    bulk: false, reuse: { kind: 'rpc', ref: 'admin_disable_user' }, impact: '계정 정지 + 활성 구독 취소', requiresApproval: true },
  { id: 'user_withdraw',  label: '회원 탈퇴 처리',               targetType: 'user',    danger: true,  minRole: 'super_admin', bulk: false, reuse: { kind: 'rpc', ref: 'admin_withdraw_user' }, impact: '탈퇴 + PII 마스킹 + 구독 취소', requiresApproval: true },
  // 실행 RPC 부재 → 미지원(관련 Dashboard 이동만; 실행 로직 임의 생성 금지)
  { id: 'queue_rebuild',      label: 'Queue Rebuild',        targetType: 'system', danger: false, minRole: 'operator', bulk: false, reuse: { kind: 'unsupported' }, impact: '큐 재구성 실행 RPC 없음', requiresApproval: false },
  { id: 'settlement_generate',label: 'Settlement Generate',  targetType: 'artist', danger: true,  minRole: 'admin',    bulk: true,  reuse: { kind: 'link', ref: 'artist' }, impact: '정산 생성 — 정산 Dashboard 에서 수행', requiresApproval: true },
  { id: 'settlement_approve', label: 'Settlement Approve',   targetType: 'artist', danger: true,  minRole: 'super_admin', bulk: false, reuse: { kind: 'link', ref: 'artist' }, impact: '정산 승인/지급 — 정산 Dashboard 에서 수행', requiresApproval: true },
  { id: 'distribution_retry', label: 'Distribution Retry',   targetType: 'artist', danger: false, minRole: 'operator', bulk: false, reuse: { kind: 'unsupported' }, impact: '유통 재시도 실행 RPC 없음', requiresApproval: false },
  { id: 'player_reset',       label: 'Player Reset',         targetType: 'store',  danger: true,  minRole: 'admin',    bulk: false, reuse: { kind: 'unsupported' }, impact: 'Player 리셋 실행 RPC 없음', requiresApproval: true },
  { id: 'playlist_refresh',   label: 'Playlist Refresh',     targetType: 'system', danger: false, minRole: 'operator', bulk: false, reuse: { kind: 'unsupported' }, impact: '플레이리스트 갱신 실행 RPC 없음', requiresApproval: false },
];

export function getAction(id: string): ActionDef | undefined {
  return ACTION_CATALOG.find((a) => a.id === id);
}

/** 실행 가능(권한 충족 + 실행 RPC 존재)? */
export function canExecute(action: ActionDef, role: Role): boolean {
  if (action.reuse.kind !== 'rpc') return false;
  return roleRank(role) >= roleRank(action.minRole);
}

/** 권한만 충족(RPC 유무 무관) — 버튼 활성/비활성 판단. */
export function hasPermission(action: ActionDef, role: Role): boolean {
  return roleRank(role) >= roleRank(action.minRole);
}

export function isSupported(action: ActionDef): boolean {
  return action.reuse.kind === 'rpc';
}

/* ── Action Queue 도출 (기존 KPI 재사용, 실행 가능한 작업만) ─────────── */
export interface QueueInputs {
  offlinePlayers?: number | null; offlineStores?: number | null;
  qcPending?: number | null; settlementPending?: number | null; todayIncidents?: number | null;
}
export interface QueueItem {
  severity: 'critical' | 'warning' | 'info';
  reason: string;       // 원인
  actionId: string;     // 추천 Action
  count: number;        // 대상 규모
}

/** Mission Control 에서 발견한 문제 → 실행 가능한 Action 큐. 실제 KPI 만 사용. */
export function deriveQueue(x: QueueInputs): QueueItem[] {
  const q: QueueItem[] = [];
  if ((x.todayIncidents ?? 0) > 0) q.push({ severity: 'critical', reason: `오늘 Incident ${x.todayIncidents}건`, actionId: 'store_resync', count: x.todayIncidents as number });
  if ((x.offlinePlayers ?? 0) > 0) q.push({ severity: 'warning', reason: `오프라인 Player ${x.offlinePlayers}대`, actionId: 'store_resync', count: x.offlinePlayers as number });
  if ((x.offlineStores ?? 0) > 0) q.push({ severity: 'warning', reason: `오프라인 Store ${x.offlineStores}개`, actionId: 'store_resync', count: x.offlineStores as number });
  if ((x.qcPending ?? 0) > 0) q.push({ severity: 'warning', reason: `QC 대기 ${x.qcPending}건`, actionId: 'qc_retry', count: x.qcPending as number });
  if ((x.settlementPending ?? 0) > 0) q.push({ severity: 'info', reason: `정산 예정 ${x.settlementPending}건`, actionId: 'settlement_generate', count: x.settlementPending as number });
  const order = { critical: 0, warning: 1, info: 2 };
  return q.sort((a, b) => order[a.severity] - order[b.severity]);
}

/* ── Command 상태 표시 ────────────────────────────────────────────── */
export const STATUS_LABEL: Record<ActionCommandStatus, string> = {
  pending: '대기', running: '실행중', success: '성공', failed: '실패', canceled: '취소',
};
export const STATUS_TONE: Record<ActionCommandStatus, 'success' | 'warning' | 'danger' | 'neutral' | 'info'> = {
  pending: 'neutral', running: 'info', success: 'success', failed: 'danger', canceled: 'neutral',
};

export const SEVERITY_TONE: Record<QueueItem['severity'], 'danger' | 'warning' | 'info'> = {
  critical: 'danger', warning: 'warning', info: 'info',
};
