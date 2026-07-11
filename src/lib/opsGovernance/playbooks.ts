// WEB-OBS-9 — Operations Playbooks. STATIC, rule-based reference cards keyed by incident type. They are
// investigation guidance only — possible causes, evidence to collect, recommended checks, escalation
// path. No playbook executes anything. Mirrors the WEB-OBS-7 incident taxonomy.

import type { Playbook } from './types';

export const PLAYBOOKS: Record<string, Playbook> = {
  MEDIA_ERROR_SPIKE: {
    incidentType: 'MEDIA_ERROR_SPIKE',
    title: 'Media / Decoder Error Spike',
    possibleCauses: ['특정 트랙 소스/컨테이너 손상', '브라우저/디코더 비호환(DECODE/SRC_NOT_SUPPORTED)', 'CDN/네트워크 오류(MEDIA_ERR_NETWORK)'],
    evidenceToCollect: ['media_code 분포(1~4)', 'browser/os 별 집중도', '특정 release 상관', '영향 store/session 수'],
    recommendedChecks: ['오류 코드가 특정 browser에 집중되는지', '특정 release 이후 급증인지', '소스/컨테이너 포맷 확인'],
    escalationPath: ['Store 확인', 'Brand 공통 여부', 'Enterprise 광범위 시', 'Platform(디코더/CDN) 엔지니어링'],
  },
  PLAYBACK_START_FAILURE_SPIKE: {
    incidentType: 'PLAYBACK_START_FAILURE_SPIKE',
    title: 'Playback Start Failure Spike',
    possibleCauses: ['자동재생 차단(사용자 상호작용 필요)', '초기 미디어 오류', '네트워크 초기 로드 실패'],
    evidenceToCollect: ['start 실패/성공 비율', 'first_progress 미도달 세션 수', 'media_error 선행 여부'],
    recommendedChecks: ['자동재생 정책/사용자 제스처', '초기 로드 네트워크', 'release 상관'],
    escalationPath: ['Store 환경 확인', 'Brand 공통', 'Enterprise', 'Platform'],
  },
  STALL_SPIKE: {
    incidentType: 'STALL_SPIKE',
    title: 'Buffering / Stall Spike',
    possibleCauses: ['매장 네트워크 대역/지연', '버퍼 부족(readyState 낮음)', 'CDN 지연'],
    evidenceToCollect: ['stall 세션 비율', 'networkState/readyState 관측', 'recovery 상관'],
    recommendedChecks: ['매장 회선 상태', '특정 시간대 집중', 'CDN 지역 상관'],
    escalationPath: ['Store 회선', 'Brand', 'Enterprise', 'Platform(CDN)'],
  },
  TTFA_REGRESSION: {
    incidentType: 'TTFA_REGRESSION',
    title: 'TTFA_APPROX Regression',
    possibleCauses: ['release 후 초기 로드 경로 변화', '네트워크 악화', '번들/자산 크기 증가'],
    evidenceToCollect: ['TTFA_APPROX p75 baseline→current', 'release/browser 상관', '표본 수'],
    recommendedChecks: ['특정 release 이후인지', '(TTFA는 요청→최초 진행 근사 — 스피커 출력 증명 아님)'],
    escalationPath: ['Store', 'Brand', 'Enterprise', 'Platform'],
  },
  RECOVERY_FAILURE_SPIKE: {
    incidentType: 'RECOVERY_FAILURE_SPIKE',
    title: 'Recovery Failure Spike',
    possibleCauses: ['반복 media error로 복구 불가', '네트워크 지속 단절', '복구 경로 한계'],
    evidenceToCollect: ['recovery attempted/failed', 'reason 분포', '재발(progressive) 여부'],
    recommendedChecks: ['같은 유형 반복(progressive incident)인지', '근본 원인(media/network)'],
    escalationPath: ['Store', 'Brand', 'Enterprise', 'Platform(Player 엔지니어링)'],
  },
  CROSSFADE_FAILURE_SPIKE: {
    incidentType: 'CROSSFADE_FAILURE_SPIKE',
    title: 'Crossfade Failure Spike',
    possibleCauses: ['fallback/abort 경로 증가', '전환 타이밍 문제'],
    evidenceToCollect: ['fallback/aborted 수', '(business 모드는 crossfade 비활성 — NOT_AVAILABLE)'],
    recommendedChecks: ['개인 사용자 범위인지', '특정 release 상관'],
    escalationPath: ['관측만', 'Platform(Player) 확인'],
  },
  RELEASE_SPECIFIC_QUALITY_REGRESSION: {
    incidentType: 'RELEASE_SPECIFIC_QUALITY_REGRESSION',
    title: 'Release-specific Quality Regression',
    possibleCauses: ['새 release 품질 저하', '특정 환경/브라우저 회귀'],
    evidenceToCollect: ['release별 quality score', '회귀 지표 수', '영향 store/session'],
    recommendedChecks: ['baseline 대비 회귀 폭', 'canary 표본 충분성'],
    escalationPath: ['Release 검토', 'Enterprise', 'Platform'],
  },
};

const FALLBACK: Playbook = {
  incidentType: 'UNKNOWN',
  title: 'General Incident',
  possibleCauses: ['원인 미상 — 추가 신호 필요'],
  evidenceToCollect: ['관련 이벤트 timeline', '영향 범위', 'release 상관'],
  recommendedChecks: ['근거 수집 후 재분류'],
  escalationPath: ['Store', 'Brand', 'Enterprise', 'Platform'],
};

export function getPlaybook(incidentType: string): Playbook {
  return PLAYBOOKS[incidentType] ?? { ...FALLBACK, incidentType };
}

export function allPlaybooks(): Playbook[] { return Object.values(PLAYBOOKS); }
