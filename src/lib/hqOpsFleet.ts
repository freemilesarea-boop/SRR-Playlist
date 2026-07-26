/**
 * hqOpsFleet — ENTERPRISE-HQ-OPS-1
 *
 * 본사(HQ) Franchise Operations Center 순수 표시 유틸 + 타입.
 * Supabase/DOM 비의존 (vitest node 환경 단위 테스트 대상).
 *
 * 원칙:
 *   - 상태(operational status)는 서버가 판정한다. 여기서는 재계산하지 않고 표시만 한다.
 *   - 실제 데이터가 없는 항목은 '미지원' / '데이터 없음' / '수집 전' 로 명확히 표기한다.
 */

// ── 서버 표준 상태 값 ──────────────────────────────────────────
export type OperationalStatus = 'HEALTHY' | 'WARNING' | 'CRITICAL' | 'OFFLINE' | 'UNKNOWN';
export type HeartbeatState = 'ONLINE' | 'DEGRADED' | 'STALE' | 'OFFLINE' | 'UNKNOWN';

/** 서버 _store_operational_status 반환 형태 */
export interface StoreOperationalStatus {
  status: OperationalStatus;
  reasons: string[];
}

export const OPERATIONAL_STATUS_LABEL: Record<OperationalStatus, string> = {
  HEALTHY: '정상',
  WARNING: '경고',
  CRITICAL: '심각',
  OFFLINE: '오프라인',
  UNKNOWN: '수집 전',
};

/** UI tone (badge 색상 키) */
export type StatusTone = 'green' | 'amber' | 'red' | 'gray';

export const OPERATIONAL_STATUS_TONE: Record<OperationalStatus, StatusTone> = {
  HEALTHY: 'green',
  WARNING: 'amber',
  CRITICAL: 'red',
  OFFLINE: 'red',
  UNKNOWN: 'gray',
};

export const HEARTBEAT_STATE_LABEL: Record<HeartbeatState, string> = {
  ONLINE: '온라인',
  DEGRADED: '불안정',
  STALE: '지연',
  OFFLINE: '오프라인',
  UNKNOWN: '수집 전',
};

export const HEARTBEAT_STATE_TONE: Record<HeartbeatState, StatusTone> = {
  ONLINE: 'green',
  DEGRADED: 'amber',
  STALE: 'amber',
  OFFLINE: 'red',
  UNKNOWN: 'gray',
};

// ── 데이터 부재 표기 표준 ──────────────────────────────────────
export type AbsentReason = '미지원' | '데이터 없음' | '수집 전';

/**
 * 값이 없으면 표준 부재 문구를 반환. 가짜 값으로 채우지 않는다.
 * @param absent 부재 사유 (기본 '데이터 없음')
 */
export function fieldOrAbsent(
  value: string | number | null | undefined,
  absent: AbsentReason = '데이터 없음',
): string {
  if (value === null || value === undefined) return absent;
  if (typeof value === 'string' && value.trim() === '') return absent;
  return String(value);
}

/** 계약 만료 D-Day 표기 (음수=경과, 0=D-Day, 양수=D-n) */
export function formatDDay(daysToEnd: number | null | undefined): string {
  if (daysToEnd === null || daysToEnd === undefined) return '데이터 없음';
  if (daysToEnd < 0) return `만료 ${Math.abs(daysToEnd)}일 경과`;
  if (daysToEnd === 0) return 'D-Day';
  return `D-${daysToEnd}`;
}

const OPERATIONAL_STATUS_VALUES: OperationalStatus[] = [
  'HEALTHY',
  'WARNING',
  'CRITICAL',
  'OFFLINE',
  'UNKNOWN',
];

/**
 * 서버가 준 operational 값을 안전하게 정규화한다.
 * 서버 값을 신뢰하되, 누락/오염 시 UNKNOWN 으로 폴백 (클라이언트 재계산 아님).
 */
export function normalizeOperationalStatus(raw: unknown): StoreOperationalStatus {
  const obj = (raw ?? {}) as { status?: unknown; reasons?: unknown };
  const status =
    typeof obj.status === 'string' && OPERATIONAL_STATUS_VALUES.includes(obj.status as OperationalStatus)
      ? (obj.status as OperationalStatus)
      : 'UNKNOWN';
  const reasons = Array.isArray(obj.reasons)
    ? obj.reasons.filter((r): r is string => typeof r === 'string')
    : [];
  return { status, reasons };
}

/** heartbeat_state 정규화 */
export function normalizeHeartbeatState(raw: unknown): HeartbeatState {
  const values: HeartbeatState[] = ['ONLINE', 'DEGRADED', 'STALE', 'OFFLINE', 'UNKNOWN'];
  return typeof raw === 'string' && values.includes(raw as HeartbeatState)
    ? (raw as HeartbeatState)
    : 'UNKNOWN';
}

/** '수 분 전' 상대시간 (표시용) — null 이면 '수집 전' */
export function formatRelativeTime(
  iso: string | null | undefined,
  nowMs: number = Date.now(),
): string {
  if (!iso) return '수집 전';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '데이터 없음';
  const diffSec = Math.floor((nowMs - t) / 1000);
  if (diffSec < 0) return '방금';
  if (diffSec < 60) return `${diffSec}초 전`;
  const min = Math.floor(diffSec / 60);
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  const day = Math.floor(hr / 24);
  return `${day}일 전`;
}
