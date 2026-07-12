// AI-MUSIC-9 — Runtime guardrails. If any dangerous runtime signal is observed (current track changed, current
// time reset, unexpected play/pause, double playback, empty queue, invalid index, crossfade/recovery state
// change, preload conflict, audio-output change, repeated fetch/race failure, unexpected queue rewrite, or a
// runtime error), the hook must stop applying and emit STOP_RECOMMENDED — NEVER an automatic stop. Pure &
// deterministic.

import type { GuardrailInput, GuardrailResult } from './types';

export function evaluateGuardrails(i: GuardrailInput): GuardrailResult {
  const triggered = [...new Set(i.signals)];
  if (triggered.length === 0) {
    return { verdict: 'CLEAR', triggered: [], automaticStop: false, reasons: ['위험 신호 없음'] };
  }
  return {
    verdict: 'STOP_RECOMMENDED',
    triggered,
    automaticStop: false,
    reasons: [`위험 신호 감지: ${triggered.join(', ')} — 자동 중단 없이 STOP_RECOMMENDED 만 생성`],
  };
}
