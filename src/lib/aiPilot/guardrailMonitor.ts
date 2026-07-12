// AI-MUSIC-5 — Live Guardrail Monitor (RECOMMENDATION ONLY). Compares treatment vs control signals during an
// active pilot and, when thresholds are breached, produces STOP_RECOMMENDED. It NEVER stops, pauses, or rolls
// back a pilot itself — an operator must approve any state change. A BLOCKED status (critical incident /
// contamination / version or control drift) is the strongest recommendation but still only a recommendation.
// Missing signal sources degrade to NOT_AVAILABLE / INSUFFICIENT_DATA, never a fabricated PASS.

import { GUARDRAIL_MON } from './thresholds';
import type { GuardrailSignals, GuardrailMonitorResult } from './types';

export function monitorGuardrails(s: GuardrailSignals): GuardrailMonitorResult {
  const base = { automated: false as const, requiresApproval: true as const, executed: false as const };
  const triggers: string[] = [];

  // Hard blocks — integrity of the experiment itself is compromised.
  if (s.criticalIncident === true) triggers.push('Critical Incident 발생');
  if (s.contamination === true) triggers.push('Contamination 감지');
  if (s.candidateVersionChanged === true) triggers.push('Candidate Version 변경 감지 (Pin 위반)');
  if (s.controlPlaylistChanged === true) triggers.push('Control Playlist 변경 감지 (Control 오염)');
  if (triggers.length > 0) {
    return { ...base, status: 'BLOCKED', triggers,
      recommendation: '즉시 STOP 검토 권고 — 운영자 승인 필요 (자동 중단 아님)' };
  }

  if (!s.sampleSufficient) {
    return { ...base, status: 'INSUFFICIENT_DATA', triggers: ['표본 부족'],
      recommendation: '표본 부족 — 판단 보류, 관찰 지속' };
  }

  // All quality signals absent → cannot judge.
  const allNull = s.streamingQualityDrop == null && s.stallIncrease == null && s.mediaErrorIncrease == null
    && s.recoveryFailIncrease == null && s.skipIncrease == null && s.dislikeIncrease == null;
  if (allNull) {
    return { ...base, status: 'NOT_AVAILABLE', triggers: ['Guardrail 신호 NOT_AVAILABLE'],
      recommendation: '신호 원본 없음 — 활성 전 데이터 소스 확인 필요' };
  }

  const stop: string[] = [];
  const warn: string[] = [];
  const check = (v: number | null, warnT: number, stopT: number | null, label: string) => {
    if (v == null) return;
    if (stopT != null && v >= stopT) stop.push(`${label} ${v} ≥ ${stopT}`);
    else if (v >= warnT) warn.push(`${label} ${v} ≥ ${warnT}`);
  };

  check(s.streamingQualityDrop, GUARDRAIL_MON.streamingDropWarn, GUARDRAIL_MON.streamingDropStop, 'Streaming 품질 저하');
  check(s.stallIncrease, GUARDRAIL_MON.stallIncreaseWarn, GUARDRAIL_MON.stallIncreaseStop, 'Stall 증가');
  check(s.mediaErrorIncrease, GUARDRAIL_MON.mediaErrorIncreaseWarn, GUARDRAIL_MON.mediaErrorIncreaseStop, 'Media Error 증가');
  check(s.recoveryFailIncrease, GUARDRAIL_MON.recoveryFailIncreaseStop, GUARDRAIL_MON.recoveryFailIncreaseStop, 'Recovery 실패 증가');
  check(s.skipIncrease, GUARDRAIL_MON.skipIncreaseStop, GUARDRAIL_MON.skipIncreaseStop, 'Skip 증가');
  check(s.dislikeIncrease, GUARDRAIL_MON.dislikeIncreaseStop, GUARDRAIL_MON.dislikeIncreaseStop, 'Dislike 증가');

  if (stop.length > 0) {
    return { ...base, status: 'STOP_RECOMMENDED', triggers: stop,
      recommendation: 'STOP 권고 — 운영자 검토/승인 후에만 중단 (자동 중단 아님)' };
  }
  if (warn.length > 0) {
    return { ...base, status: 'WARNING', triggers: warn,
      recommendation: '경고 수준 — 관찰 강화 권고, 아직 STOP 아님' };
  }
  return { ...base, status: 'PASS', triggers: [], recommendation: '가드레일 정상 — 조치 불필요' };
}
