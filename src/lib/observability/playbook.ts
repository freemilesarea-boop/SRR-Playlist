// WEB-OBS-5 — Incident Playbooks (pure, unit-tested, static — NO ML, NO guessing).
//
// Per-incident-type, ordered, human-executable checklists. Every step is READ-ONLY guidance for an
// operator: destructive=false and automated=false on ALL steps — this module NEVER runs a command,
// deploy, rollback, or notification. Unsupported incident types fall back to a GENERIC playbook (no
// speculative steps invented). Step status is UI-only display state.

import type { IncidentType } from './incident';

export type PlaybookStepStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED' | 'SKIPPED' | 'BLOCKED';

export interface PlaybookStep {
  stepOrder: number;
  title: string;
  description: string;
  purpose: string;
  requiredEvidence: string;
  expectedResult: string;
  stopCondition: string;
  escalationCondition: string;
  destructive: false;
  automated: false;
  status: PlaybookStepStatus;
}

export type PlaybookKey =
  | 'ERROR_SPIKE' | 'CHUNK_FAILURE_SPIKE' | 'HYDRATION_ERROR_SPIKE' | 'API_REGRESSION'
  | 'WEB_VITAL_REGRESSION' | 'MEMORY_RISK' | 'BOOT_RECOVERY_FAILURE' | 'GENERIC';

export interface Playbook {
  key: PlaybookKey;
  incidentType: IncidentType | 'GENERIC';
  title: string;
  steps: PlaybookStep[];
}

function step(
  order: number, title: string, description: string, purpose: string,
  requiredEvidence: string, expectedResult: string, stopCondition: string, escalationCondition: string,
): PlaybookStep {
  return { stepOrder: order, title, description, purpose, requiredEvidence, expectedResult, stopCondition, escalationCondition, destructive: false, automated: false, status: 'NOT_STARTED' };
}

const PLAYBOOKS: Record<PlaybookKey, Omit<Playbook, 'key'>> = {
  ERROR_SPIKE: {
    incidentType: 'ERROR_SPIKE', title: 'Error Spike 대응',
    steps: [
      step(1, '영향 Release 확인', 'Root Cause의 candidate release와 timeline을 확인', '어느 배포에서 시작됐는지 특정', 'candidate/baseline release, first-seen', '오류 시작 릴리스 식별', '릴리스 미상이면 중단하고 재조사', '릴리스 특정 불가 + 지속 상승'),
      step(2, 'Error Fingerprint 확인', 'Errors 탭에서 상위 fingerprint 그룹 확인', '단일 결함인지 다발 결함인지 구분', 'fingerprint별 count/sessions', '주요 오류 유형 파악', '표본 부족이면 중단', 'critical severity 다수'),
      step(3, 'Route 집중도 확인', 'by-route 분포로 특정 라우트 집중 여부 확인', '전역 vs 특정 화면 장애 판단', 'route별 error sessions 비율', '집중 라우트 또는 분산 확인', '집중 없음 + 저표본', '/player 집중 시 Player 팀'),
      step(4, 'Browser 집중도 확인', 'by-browser 분포로 특정 브라우저 편중 확인', '호환성 회귀 여부 판단', 'browser별 error rate vs 전체', '편중 브라우저 또는 균등 확인', '표본 부족', '단일 브라우저 100% 편중'),
      step(5, '이전 Release 비교', 'Release Gate/Root Cause로 baseline과 비교', '회귀 규모 정량화', 'error rate baseline→current', '회귀 확정 또는 반증', 'baseline 없음', '회귀 confidence HIGH'),
      step(6, 'Release 보류 판단', 'Release Gate verdict 확인 후 승격 보류 여부 판단(표시만)', '추가 확산 방지', 'gate verdict, pending 여부', 'HOLD/PROCEED 결정(권고)', 'gate INSUFFICIENT_DATA', 'BLOCK verdict'),
      step(7, '수정 후 Error Rate 재검증', 'Recovery 탭으로 관측 창에서 error rate 회복 확인', '실제 복구 확인', 'recovery status, recurrence', 'RECOVERED(운영자 확인)', 'INSUFFICIENT_DATA', '재발(REGRESSED)'),
    ],
  },
  CHUNK_FAILURE_SPIKE: {
    incidentType: 'CHUNK_FAILURE_SPIKE', title: 'Chunk Failure 대응',
    steps: [
      step(1, '영향 Release 확인', 'chunk-load 오류가 시작된 candidate release 확인', '배포 자산 불일치 시점 특정', 'chunk sessions by release', '오류 릴리스 식별', '릴리스 미상', '지속 확산'),
      step(2, 'Browser별 Chunk Failure 비교', 'by-browser chunk 분포 확인', '브라우저 캐시/버전 편중 확인', 'browser별 chunk sessions', '편중/균등 확인', '표본 부족', '특정 브라우저 급증'),
      step(3, 'Build mismatch 확인', 'release(build id) 전환과 오류 타이밍 상관 확인(내용 미조회)', '구버전 index.html 서빙 의심 확인', 'timeline first-seen vs deploy', 'mismatch 의심/반증', '데이터 부족', 'mismatch 강함'),
      step(4, 'Cache/CDN 설정 변경 여부 확인', '최근 캐시/CDN 변경 이력 점검(표시만, 변경 금지)', '자산 캐싱 회귀 여부 확인', '운영 변경 이력(외부)', '원인 후보 확정/제외', '정보 없음', 'CDN 원인 의심'),
      step(5, 'Boot Recovery 성공률 확인', 'chunk 오류 후 자동 복구 신호 관측(관측 전용)', '사용자 자동 회복 여부 확인', 'chunk 세션 후속 정상 세션', '복구 여부 확인', 'boot recovery 채널 없음 → NO DATA', '복구 실패 다수'),
      step(6, 'Rollback 권고 판단', 'Rollback Advisor 상태 확인(표시만)', '롤백 필요성 판단', 'rollback status, chunk rate', 'ROLLBACK/HOLD 권고', 'INSUFFICIENT_DATA', 'BLOCK_RELEASE'),
      step(7, '새 Release에서 재검증', '수정 배포 후 chunk failure rate 재관측', '재발 방지 확인', 'recovery status', 'RECOVERED', 'INSUFFICIENT_DATA', '재발'),
    ],
  },
  HYDRATION_ERROR_SPIKE: {
    incidentType: 'HYDRATION_ERROR_SPIKE', title: 'Hydration Error 대응',
    steps: [
      step(1, '영향 Route 확인', 'hydration 오류의 by-route 분포 확인', '특정 화면 SSR/CSR 불일치 확인', 'route별 hydration sessions', '집중 라우트 파악', '표본 부족', '핵심 라우트 집중'),
      step(2, 'Browser/Device 비교', 'browser/device별 hydration 분포 확인', '환경 특이성 확인', 'browser/device 분포', '편중/균등 확인', '표본 부족', '특정 환경 편중'),
      step(3, 'Release 비교', 'baseline 대비 hydration 증가 확인', '회귀 규모 확인', 'hydration sessions baseline→current', '회귀 확정', 'baseline 없음', '회귀 강함'),
      step(4, 'SSR/Client 불일치 가능성 검토', '조건부 렌더/날짜/로케일 불일치 후보 점검(코드 조사)', '근본 원인 후보 좁히기', 'fingerprint 정규화 메시지', '원인 후보 확정', '데이터 부족', '광범위 영향'),
      step(5, '동일 Fingerprint 집중 확인', '단일 fingerprint 집중 여부 확인', '단일 결함 여부 판단', 'fingerprint count/sessions', '단일/다발 확인', '표본 부족', '다발'),
      step(6, '승격 보류 판단', 'Release Gate verdict로 승격 보류 판단(표시만)', '확산 방지', 'gate verdict', 'HOLD/PROCEED(권고)', 'INSUFFICIENT_DATA', 'BLOCK'),
      step(7, '수정 후 Hydration Error 재검증', 'Recovery로 hydration 회복 확인', '복구 확인', 'recovery status', 'RECOVERED', 'INSUFFICIENT_DATA', '재발'),
    ],
  },
  API_REGRESSION: {
    incidentType: 'API_REGRESSION', title: 'API Regression 대응',
    steps: [
      step(1, 'Endpoint normalization 확인', 'APIs 탭에서 정규화된 endpoint(host+path) 확인', '동일 엔드포인트 집계 정확성 확인', 'normalized endpoint', '대상 endpoint 확정', '데이터 없음', ''),
      step(2, 'p75/p95 변화 확인', 'baseline 대비 latency percentile 변화 확인', '지연 회귀 정량화', 'p75/p95 baseline→current', '회귀 확정/반증', '표본 부족', '대폭 상승'),
      step(3, 'timeout/network error 분리', 'timeout·network error를 latency와 분리 확인(가능 범위)', '지연 vs 실패 구분', 'status 분포(가능 시)', '유형 구분', '분리 불가 → 표시', '실패율 급증'),
      step(4, '영향 Route 확인', '해당 API를 호출하는 route 확인', '사용자 체감 화면 파악', 'route별 호출/오류', '영향 화면 파악', '표본 부족', '/player 영향'),
      step(5, 'Release 비교', 'release별 API 지표 비교', '배포 상관 확인', 'release별 p95/실패', '상관 확정', 'baseline 없음', '릴리스 상관 강함'),
      step(6, 'API 자체 vs Client 호출 구분', '서버 지연인지 클라이언트 호출 패턴인지 구분(조사)', '조치 주체 결정', 'route/endpoint 상관', '주체 결정', '판단 불가', '백엔드 원인'),
      step(7, '수정 후 latency/error 재검증', 'Recovery로 p95/실패 회복 확인', '복구 확인', 'recovery status', 'RECOVERED', 'INSUFFICIENT_DATA', '재발'),
    ],
  },
  WEB_VITAL_REGRESSION: {
    incidentType: 'WEB_VITAL_REGRESSION', title: 'Web Vital Regression 대응',
    steps: [
      step(1, 'Metric 확인', '어느 vital(LCP/INP/CLS/TTFB)이 회귀했는지 확인', '대상 지표 특정', 'vital p75/p95', '대상 metric 확정', '데이터 없음', ''),
      step(2, 'Release 비교', 'baseline 대비 vital p75 변화 확인', '회귀 규모 확인', 'vital baseline→current', '회귀 확정', 'baseline 없음', '대폭 악화'),
      step(3, 'Route 집중도 확인', 'route별 dwell/slow route 분포 확인', '특정 화면 회귀 확인', 'slow route 분포', '집중/분산 확인', '표본 부족', '핵심 라우트'),
      step(4, 'Device/Network 분리', 'device class/network type별 분포 확인', '저사양/저속 환경 편중 확인', 'device/network 분포', '편중 확인', '표본 부족', '광범위'),
      step(5, 'Long Task 상관관계 확인', 'long task와 LCP/INP 상관 확인', 'JS 부하 원인 여부 확인', 'long task ↔ LCP 상관', '상관 확정', '데이터 부족', 'JS 부하 강함'),
      step(6, 'Performance Budget 판단', 'Release Gate의 budget FAIL 여부 확인(표시만)', '예산 초과 판단', 'budget items', 'PASS/FAIL 확인', 'INSUFFICIENT_DATA', 'budget FAIL'),
      step(7, '수정 후 p75/p95 재검증', 'Recovery로 vital 회복 확인', '복구 확인', 'recovery status', 'RECOVERED', 'INSUFFICIENT_DATA', '재발'),
    ],
  },
  MEMORY_RISK: {
    incidentType: 'MEMORY_RISK', title: 'Memory Risk 대응',
    steps: [
      step(1, 'Device Memory bucket 확인', 'device memory bucket별 분포 확인', '저메모리 기기 편중 확인', 'memory bucket 분포', '편중 확인', '표본 부족', '저메모리 집중'),
      step(2, 'Route 집중도 확인', 'memory risk의 route 집중 확인', '특정 화면 누수 후보 확인', 'route별 memory risk', '집중/분산 확인', '표본 부족', '핵심 라우트'),
      step(3, '장시간 Session 여부 확인', '세션 지속시간과 heap 증가 상관 확인(가능 범위)', '누수 vs 순간 피크 구분', 'memory 시계열(가능 시)', '누수 후보 확정', '데이터 부족', '지속 증가'),
      step(4, 'Long Task 동반 여부 확인', 'long task 동반 여부 확인', 'GC/blocking 상관 확인', 'long task ↔ memory', '상관 확인', '데이터 부족', ''),
      step(5, '특정 Release 집중 여부 확인', 'release별 memory risk 분포 확인', '배포 상관 확인', 'release별 memory risk', '상관 확정', 'baseline 없음', '릴리스 상관'),
      step(6, '재현 절차 제시', '저메모리 기기+핵심 라우트 재현 시나리오 정리', '재현 가능성 확보', '재현 조건', '재현 절차 확정', '재현 불가', '재현 시 심각'),
      step(7, '수정 후 Memory Risk 재검증', 'Recovery로 memory risk 세션 회복 확인', '복구 확인', 'recovery status', 'RECOVERED', 'INSUFFICIENT_DATA', '재발'),
    ],
  },
  BOOT_RECOVERY_FAILURE: {
    incidentType: 'BOOT_RECOVERY_FAILURE', title: 'Boot Recovery Failure 대응',
    steps: [
      step(1, 'Boot 실패 수 확인', 'boot 실패 신호 수 확인(관측 전용; 전용 채널 없으면 NO DATA)', '초기 부팅 장애 규모 확인', 'boot 실패 수', '규모 파악', '채널 없음 → NO DATA', '광범위'),
      step(2, 'Recovery Attempt 확인', '자동 복구 시도 수 확인', '복구 시도 여부 확인', 'recovery attempts', '시도 확인', 'NO DATA', ''),
      step(3, 'Recovery Success/Failure 확인', '복구 성공/실패 분포 확인', '자동 회복 유효성 확인', 'success/failure', '성공률 파악', 'NO DATA', '실패 다수'),
      step(4, 'Chunk Error 동반 여부 확인', 'chunk-load 오류 동반 여부 확인', '자산 불일치 상관 확인', 'chunk sessions', '상관 확인', '표본 부족', 'chunk 급증'),
      step(5, 'Loop Prevented 확인', '무한 재로드 방지 동작 확인(WEB-OPT-2, 변경 금지)', '복구 루프 안전성 확인', 'loop prevented 신호', '안전 확인', 'NO DATA', 'loop 미방지 의심'),
      step(6, 'Release 보류 또는 Rollback 검토', 'Rollback Advisor로 롤백/보류 판단(표시만)', '확산 방지', 'rollback status', '권고 결정', 'INSUFFICIENT_DATA', 'BLOCK_RELEASE'),
      step(7, '복구율 재검증', 'Recovery로 복구율 회복 확인', '복구 확인', 'recovery status', 'RECOVERED', 'NO DATA', '재발'),
    ],
  },
  GENERIC: {
    incidentType: 'GENERIC', title: '일반 Incident 대응(표준 절차)',
    steps: [
      step(1, '영향 Release/Route/Browser 확인', 'Root Cause와 Blast Radius로 영향 범위 확인', '영향 범위 파악', 'blast radius, root cause', '범위 확정', '표본 부족', '광범위'),
      step(2, 'Confidence 확인', 'confidence가 충분한지 확인', '판단 신뢰도 확보', 'confidence 등급', 'HIGH/MEDIUM 확보', 'INSUFFICIENT', ''),
      step(3, 'Root Cause 검토', '상위 원인 후보와 evidence 검토', '원인 좁히기', 'root cause causes', '원인 후보 확정', '원인 미집중', 'critical'),
      step(4, 'Release Gate 확인', 'gate verdict로 승격 안전성 확인(표시만)', '확산 방지', 'gate verdict', 'HOLD/PROCEED', 'INSUFFICIENT_DATA', 'BLOCK'),
      step(5, 'Rollback 필요성 판단', 'Rollback Advisor 상태 확인(표시만)', '롤백 필요성 판단', 'rollback status', '권고 결정', 'INSUFFICIENT_DATA', 'ROLLBACK_RECOMMENDED'),
      step(6, '수정 후 재검증', 'Recovery로 회복 확인', '복구 확인', 'recovery status', 'RECOVERED', 'INSUFFICIENT_DATA', '재발'),
    ],
  },
};

/** Map any incident type to the closest supported playbook (unsupported → GENERIC — no invented steps). */
export function playbookKeyFor(incidentType: IncidentType | null | undefined): PlaybookKey {
  switch (incidentType) {
    case 'ERROR_SPIKE':
    case 'CRITICAL_ERROR':
    case 'BROWSER_SPECIFIC_FAILURE':
    case 'RELEASE_SPECIFIC_FAILURE':
      return 'ERROR_SPIKE';
    case 'CHUNK_FAILURE_SPIKE': return 'CHUNK_FAILURE_SPIKE';
    case 'HYDRATION_ERROR_SPIKE': return 'HYDRATION_ERROR_SPIKE';
    case 'API_REGRESSION': return 'API_REGRESSION';
    case 'WEB_VITAL_REGRESSION':
    case 'ROUTE_REGRESSION':
    case 'LONG_TASK_SPIKE':
      return 'WEB_VITAL_REGRESSION';
    case 'MEMORY_RISK': return 'MEMORY_RISK';
    case 'BOOT_RECOVERY_FAILURE': return 'BOOT_RECOVERY_FAILURE';
    default: return 'GENERIC';
  }
}

/** Return a fresh (all-NOT_STARTED) playbook for an incident type. */
export function getPlaybook(incidentType: IncidentType | null | undefined): Playbook {
  const key = playbookKeyFor(incidentType);
  const p = PLAYBOOKS[key];
  return { key, incidentType: p.incidentType, title: p.title, steps: p.steps.map((s) => ({ ...s })) };
}
