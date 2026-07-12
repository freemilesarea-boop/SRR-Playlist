// AI-MUSIC-5 — Pilot Completion evaluator. Decides whether an active pilot has met its manual-completion
// criteria (min duration, min sessions/playbacks, final snapshot present, guardrails clean, no contamination).
// Completion NEVER auto-fires: even a fully-satisfied pilot returns requiresApproval:true and the operator
// must confirm. Contamination or a critical guardrail failure downgrades the result rather than completing.

import type { CompletionInput, CompletionResult } from './types';

export function evaluateCompletion(input: CompletionInput): CompletionResult {
  const base = { requiresApproval: true as const, automated: false as const };
  const reasons: string[] = [];

  if (!input.finalSnapshotExists) reasons.push('Final Observation Snapshot 없음');
  const durationMet = input.elapsedMs >= input.minDurationMs;
  const sessionsMet = input.sessions >= input.minSessions;
  const playbacksMet = input.playbacks >= input.minPlaybacks;
  if (!durationMet) reasons.push(`최소 기간 미달 (${input.elapsedMs}/${input.minDurationMs}ms)`);
  if (!sessionsMet) reasons.push(`최소 Session 미달 (${input.sessions}/${input.minSessions})`);
  if (!playbacksMet) reasons.push(`최소 Playback 미달 (${input.playbacks}/${input.minPlaybacks})`);

  // Contamination / critical guardrail failure take precedence — the pilot cannot "complete" cleanly.
  if (input.contamination === 'CONTAMINATED') {
    return { ...base, status: 'CONTAMINATED', reasons: ['Contamination 확정 — 정상 완료 불가, STOP/폐기 검토', ...reasons] };
  }
  if (input.criticalGuardrailFailure) {
    return { ...base, status: 'STOP_RECOMMENDED', reasons: ['Critical Guardrail 실패 — STOP 권고', ...reasons] };
  }

  // Not enough evidence yet to judge completion at all.
  if (input.sessions <= 0 && input.playbacks <= 0) {
    return { ...base, status: 'INSUFFICIENT_DATA', reasons: ['관측 데이터 없음', ...reasons] };
  }

  if (durationMet && sessionsMet && playbacksMet && input.finalSnapshotExists) {
    if (!input.operatorApproved) {
      return { ...base, status: 'COMPLETED', reasons: ['완료 기준 충족 — 운영자 확인 필요 (자동 완료 아님)'] };
    }
    return { ...base, status: 'COMPLETED', reasons: ['완료 기준 충족, 운영자 확인됨'] };
  }

  // Duration met but sample thin → recommend extension rather than premature completion.
  if (durationMet && (!sessionsMet || !playbacksMet)) {
    return { ...base, status: 'EXTEND_RECOMMENDED', reasons: ['기간 충족·표본 부족 — 연장 권고', ...reasons] };
  }
  return { ...base, status: 'EXTEND_RECOMMENDED', reasons: ['진행 중 — 기준 미충족, 관찰 지속', ...reasons] };
}
