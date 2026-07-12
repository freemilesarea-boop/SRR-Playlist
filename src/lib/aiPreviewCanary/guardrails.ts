// AI-MUSIC-7 — Runtime playback guardrails (RECOMMENDATION ONLY). Evaluates playback-safety signals during a
// preview canary and, on breach, produces STOP_RECOMMENDED — it NEVER stops/pauses/rolls-back itself; an
// operator must approve. Any signal that the current track was interrupted, the player state changed
// unexpectedly, double playback, an unexpected reload/pause, or an empty queue is BLOCKED (strongest
// recommendation, still only a recommendation). Missing signals degrade to NOT_AVAILABLE / INSUFFICIENT_DATA.

import { GUARDRAIL } from './thresholds';
import type { GuardrailSignals, GuardrailResult } from './types';

export function evaluateGuardrails(s: GuardrailSignals): GuardrailResult {
  const base = { automated: false as const, requiresApproval: true as const };
  const triggers: string[] = [];

  // Hard blocks — playback integrity compromised.
  if (s.currentTrackPreserved === false) triggers.push('Current Track 미보존 (강제 중단)');
  if (s.playerStatePreserved === false) triggers.push('Player State 미보존');
  if (s.doublePlayback === true) triggers.push('Double Playback');
  if (s.unexpectedReload === true) triggers.push('Unexpected Reload');
  if (s.unexpectedPause === true) triggers.push('Unexpected Pause');
  if (s.queueEmpty === true) triggers.push('Queue Empty');
  if (s.queueCompatible === false) triggers.push('Queue 비호환');
  if (triggers.length > 0) return { ...base, status: 'BLOCKED', triggers, recommendation: '즉시 STOP 검토 권고 — 운영자 승인 필요 (자동 중단 아님)' };

  if (!s.sampleSufficient) return { ...base, status: 'INSUFFICIENT_DATA', triggers: ['표본 부족'], recommendation: '표본 부족 — 판단 보류, 관찰 지속' };

  const allNull = s.playbackStartSuccess == null && s.ttfaApproxMs == null && s.transitionGapMs == null
    && s.stall == null && s.mediaError == null && s.recoveryFailure == null;
  if (allNull) return { ...base, status: 'NOT_AVAILABLE', triggers: ['Playback 신호 NOT_AVAILABLE'], recommendation: '신호 원본 없음 — 활성 전 확인 필요' };

  const stop: string[] = [];
  const warn: string[] = [];
  if (s.playbackStartSuccess === false) stop.push('Playback Start 실패');
  if (s.recoveryFailure === true) stop.push('Recovery 실패');
  if (s.mediaError === true) warn.push('Media Error');
  if (s.stall === true) warn.push('Stall');
  if (s.ttfaApproxMs != null) { if (s.ttfaApproxMs >= GUARDRAIL.ttfaStopMs) stop.push(`TTFA ${s.ttfaApproxMs}ms ≥ ${GUARDRAIL.ttfaStopMs}`); else if (s.ttfaApproxMs >= GUARDRAIL.ttfaWarnMs) warn.push(`TTFA ${s.ttfaApproxMs}ms ≥ ${GUARDRAIL.ttfaWarnMs}`); }
  if (s.transitionGapMs != null) { if (s.transitionGapMs >= GUARDRAIL.transitionGapStopMs) stop.push(`Transition Gap ${s.transitionGapMs}ms ≥ ${GUARDRAIL.transitionGapStopMs}`); else if (s.transitionGapMs >= GUARDRAIL.transitionGapWarnMs) warn.push(`Transition Gap ${s.transitionGapMs}ms ≥ ${GUARDRAIL.transitionGapWarnMs}`); }

  if (stop.length > 0) return { ...base, status: 'STOP_RECOMMENDED', triggers: stop, recommendation: 'STOP 권고 — 운영자 검토/승인 후에만 중단 (자동 중단 아님)' };
  if (warn.length > 0) return { ...base, status: 'WARNING', triggers: warn, recommendation: '경고 수준 — 관찰 강화 권고, 아직 STOP 아님' };
  return { ...base, status: 'PASS', triggers: [], recommendation: '재생 가드레일 정상 — 조치 불필요' };
}
