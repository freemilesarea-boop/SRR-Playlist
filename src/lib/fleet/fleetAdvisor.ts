// WEB-OBS-6 — Fleet Operational Advisor (pure, unit-tested). Reuses the WEB-OBS-5 advisor shape:
// turns a store/fleet state into a single RECOMMENDED next action for the operator, plus urgency, a
// verification checklist and an escalation target. **Nothing is executed** — every action is
// automated=false, requiresApproval=true, and there is NO remote play/stop/reboot/device-change.
// Below the confidence gate the advice is MONITOR_RECOVERY (observe), never a confident action.

import type { Confidence } from '../observability/release';
import type { StoreHealthResult } from './types';
import type { FleetOverview, FleetBlastRadius } from './fleet';
import { ADVISOR_ESCALATE_AFFECTED_STORES, ADVISOR_EXEC_BLAST_STORE_RATE } from './thresholds';

export type FleetActionCategory =
  | 'MONITOR_RECOVERY' | 'VERIFY_STORE_NETWORK' | 'VERIFY_PLAYER_SESSION' | 'VERIFY_AUDIO_OUTPUT'
  | 'VERIFY_QUEUE' | 'VERIFY_SCHEDULER' | 'VERIFY_BROWSER' | 'VERIFY_RELEASE' | 'CONTACT_STORE'
  | 'PREPARE_REMOTE_GUIDE' | 'HOLD_RELEASE' | 'PREPARE_ROLLBACK'
  | 'ESCALATE_PLAYER_ENGINEERING' | 'ESCALATE_INFRA';

export type FleetUrgency = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';
export type FleetEscalationTarget = 'NONE' | 'OPERATOR' | 'STORE_CONTACT' | 'PLAYER_ENGINEERING' | 'INFRA' | 'RELEASE_OWNER' | 'EXECUTIVE';

export interface FleetActionSafety {
  readOnly: boolean;
  requiresApproval: true;   // ALWAYS true
  automated: false;         // ALWAYS false
  remoteControl: false;     // ALWAYS false — no remote play/stop/reboot/device change is ever performed
  productionEffect: boolean;
  riskLevel: 'none' | 'low' | 'medium' | 'high';
}

export function fleetActionSafety(category: FleetActionCategory): FleetActionSafety {
  const guideOnly: FleetActionCategory[] = [
    'MONITOR_RECOVERY', 'VERIFY_STORE_NETWORK', 'VERIFY_PLAYER_SESSION', 'VERIFY_AUDIO_OUTPUT',
    'VERIFY_QUEUE', 'VERIFY_SCHEDULER', 'VERIFY_BROWSER', 'VERIFY_RELEASE', 'CONTACT_STORE', 'PREPARE_REMOTE_GUIDE',
  ];
  if (guideOnly.includes(category)) {
    return { readOnly: true, requiresApproval: true, automated: false, remoteControl: false, productionEffect: false, riskLevel: category === 'CONTACT_STORE' ? 'low' : 'none' };
  }
  if (category === 'ESCALATE_PLAYER_ENGINEERING' || category === 'ESCALATE_INFRA') {
    return { readOnly: true, requiresApproval: true, automated: false, remoteControl: false, productionEffect: false, riskLevel: 'low' };
  }
  // HOLD_RELEASE / PREPARE_ROLLBACK — production-affecting recommendations (still operator-approved, never auto).
  return { readOnly: false, requiresApproval: true, automated: false, remoteControl: false, productionEffect: true, riskLevel: category === 'PREPARE_ROLLBACK' ? 'high' : 'medium' };
}

const CHECKLISTS: Partial<Record<FleetActionCategory, string[]>> = {
  VERIFY_STORE_NETWORK: ['매장 인터넷 회선 상태', 'reconnect 반복 여부', 'online/offline 전환 이력', 'API 실패 동반 여부'],
  VERIFY_PLAYER_SESSION: ['last heartbeat 시각', 'player session 지속 시간', 'visibility 상태(hidden 여부)', 'release/browser 확인'],
  VERIFY_AUDIO_OUTPUT: ['매장에 실제 소리 출력 확인(원격 증명 불가 — 매장 확인 필요)', '볼륨/음소거 상태', '출력 장치 선택', '(브라우저는 시스템 볼륨을 알 수 없음)'],
  VERIFY_QUEUE: ['queue 길이 bucket', 'next track 존재 여부', 'Scheduler 결과', 'Playlist 크기'],
  VERIFY_SCHEDULER: ['playlist 갱신 여부(신호 제한적)', '현재 시간대 슬롯', 'fallback 사용 여부'],
  VERIFY_BROWSER: ['특정 browser 편중 여부', 'browser별 stall/offline 비율', 'device class 분포'],
  VERIFY_RELEASE: ['특정 release 편중 여부', 'release별 매장 상태', 'Release Gate/Root Cause(WEB-OBS-3/4) 확인'],
  CONTACT_STORE: ['매장 담당자 연락(안내만)', '전원/네트워크/볼륨 육안 확인 요청', '(원격 제어 없음 — 안내 스크립트만)'],
  PREPARE_REMOTE_GUIDE: ['매장 안내용 체크리스트 준비(표시만)', '원격 실행 아님'],
  MONITOR_RECOVERY: ['heartbeat 복귀 관측', 'auto refresh로 추세 관찰', '임계 초과 시 재평가'],
  HOLD_RELEASE: ['Release Gate verdict 확인', '승격 대기 릴리스 확인', '(표시만 — 실제 차단 아님)'],
  PREPARE_ROLLBACK: ['이전 안정 release 확인', 'rollback 후 검증 지표 확인', '(권고만 — 실제 rollback 아님)'],
};

export interface FleetAdvice {
  recommendedAction: FleetActionCategory;
  urgency: FleetUrgency;
  reason: string;
  evidence: string[];
  verificationSteps: string[];
  escalationTarget: FleetEscalationTarget;
  safety: FleetActionSafety;
  safetyWarning: string;
  confidence: Confidence;
}

const SAFETY_WARNING = '권고이며 자동 실행되지 않습니다. 원격 재생/정지/새로고침/재부팅/장치변경/알림전송은 수행되지 않습니다(운영자 확인 필요).';

function build(category: FleetActionCategory, urgency: FleetUrgency, reason: string, evidence: string[], escalation: FleetEscalationTarget, confidence: Confidence): FleetAdvice {
  return {
    recommendedAction: category, urgency, reason, evidence,
    verificationSteps: CHECKLISTS[category] ?? CHECKLISTS.MONITOR_RECOVERY ?? [],
    escalationTarget: escalation, safety: fleetActionSafety(category), safetyWarning: SAFETY_WARNING, confidence,
  };
}

/** Per-store recommendation from its health result. */
export function computeStoreAdvice(store: StoreHealthResult): FleetAdvice {
  if (store.confidence === 'INSUFFICIENT') {
    return build('MONITOR_RECOVERY', 'LOW', '표본이 부족하여 확정 조치를 권고하지 않습니다.', [`confidence INSUFFICIENT`], 'NONE', store.confidence);
  }
  if (store.liveness === 'OFFLINE') {
    return build('CONTACT_STORE', 'CRITICAL', '매장 Offline(heartbeat 장기 미수신) — 매장 네트워크/전원 확인 안내.', [`last seen ${store.lastSeenAgeSec ?? '?'}s`], 'STORE_CONTACT', store.confidence);
  }
  if (store.playback === 'SILENCE_SUSPECTED') {
    return build('VERIFY_AUDIO_OUTPUT', 'HIGH', '재생 상태이나 진행 정체 — 실제 소리 출력 확인 필요(확정 아님).', ['frozen progress while playing'], 'STORE_CONTACT', store.confidence);
  }
  if (store.playback === 'STALLED') {
    return build('VERIFY_PLAYER_SESSION', 'HIGH', '재생 정체 — 플레이어 세션/네트워크 확인.', ['stall 신호'], 'OPERATOR', store.confidence);
  }
  if (store.network === 'DISCONNECTED' || store.network === 'DEGRADED') {
    return build('VERIFY_STORE_NETWORK', 'MEDIUM', '네트워크 불안정/오프라인 — 회선 확인 안내.', [`network ${store.network}`], 'STORE_CONTACT', store.confidence);
  }
  if (store.queue === 'EMPTY') {
    return build('VERIFY_QUEUE', 'MEDIUM', 'Queue 비어 있음 — Scheduler/Queue 상태 확인.', ['queue empty'], 'OPERATOR', store.confidence);
  }
  if (store.repetition === 'REPEAT_ANOMALY') {
    return build('VERIFY_SCHEDULER', 'LOW', '동일 곡 비정상 반복 — Playlist/Scheduler 확인.', ['repeat anomaly'], 'OPERATOR', store.confidence);
  }
  if (store.liveness === 'STALE') {
    return build('MONITOR_RECOVERY', 'LOW', '플레이어 STALE — Offline 여부 재평가(단일 누락으로 확정 금지).', [`last seen ${store.lastSeenAgeSec ?? '?'}s`], 'NONE', store.confidence);
  }
  return build('MONITOR_RECOVERY', 'NONE', '임계 초과 신호 없음 — 관찰 유지.', [], 'NONE', store.confidence);
}

/** Fleet-level recommendation from the overview + incidents concentration + blast radius. */
export function computeFleetAdvice(overview: FleetOverview, blast: FleetBlastRadius): FleetAdvice {
  if (overview.insufficientData || overview.confidence === 'INSUFFICIENT') {
    return build('MONITOR_RECOVERY', 'LOW', 'Fleet 표본 부족 — 관측 지속.', [overview.reason], 'NONE', overview.confidence);
  }
  const widespread = blast.level === 'WIDESPREAD' || blast.level === 'CRITICAL';
  const releaseScoped = blast.primaryScope?.startsWith('release ');
  if (widespread && releaseScoped) {
    return build('HOLD_RELEASE', 'CRITICAL', '광범위 장애가 특정 release에 집중 — 승격 보류/롤백 검토 권고.', [blast.reason, blast.primaryScope ?? ''], 'RELEASE_OWNER', blast.confidence);
  }
  if (widespread) {
    const escalation: FleetEscalationTarget = blast.affectedStoreRate != null && blast.affectedStoreRate >= ADVISOR_EXEC_BLAST_STORE_RATE ? 'EXECUTIVE' : 'PLAYER_ENGINEERING';
    return build('ESCALATE_PLAYER_ENGINEERING', 'CRITICAL', '광범위 매장 장애 — 플레이어 엔지니어링 에스컬레이션 권고.', [blast.reason], escalation, blast.confidence);
  }
  if (blast.affectedStores >= ADVISOR_ESCALATE_AFFECTED_STORES) {
    return build('ESCALATE_INFRA', 'HIGH', '다수 매장 영향 — 회선/인프라 공통 원인 조사 권고.', [blast.reason], 'INFRA', blast.confidence);
  }
  if (overview.status === 'CRITICAL' || overview.status === 'DEGRADED') {
    return build('VERIFY_STORE_NETWORK', 'HIGH', 'Fleet 상태 저하 — 상위 영향 매장부터 확인.', [overview.reason], 'OPERATOR', overview.confidence);
  }
  return build('MONITOR_RECOVERY', 'LOW', 'Fleet 정상 범위 — 관찰 유지.', [overview.reason], 'NONE', overview.confidence);
}
