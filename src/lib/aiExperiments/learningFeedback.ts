// AI-MUSIC-4 — Learning Feedback. Turns an experiment outcome into AI-MUSIC-3 learning *recommendations* —
// it never writes back into the learning engine this phase (recommendationOnly:true, applied:false,
// requiresApproval:true). Rule-based mapping from the outcome classification + guardrail.

import type { ExperimentOutcome, LearningFeedback, FeedbackKind } from './types';

function fb(kind: FeedbackKind, reason: string): LearningFeedback {
  return { kind, reason, recommendationOnly: true, applied: false, requiresApproval: true };
}

export function buildLearningFeedback(o: ExperimentOutcome): LearningFeedback[] {
  const out: LearningFeedback[] = [];
  switch (o.classification) {
    case 'TREATMENT_BETTER':
      out.push(fb('PROMOTE_CANDIDATE', 'Treatment 우위 — Candidate 승격 검토 권고'));
      out.push(fb('INCREASE_TRACK_WEIGHT', 'Treatment 트랙 가중 상향 검토'));
      break;
    case 'CONTROL_BETTER':
      out.push(fb('RETIRE_CANDIDATE', 'Control 우위 — Candidate 회수 검토'));
      out.push(fb('DECREASE_TRACK_WEIGHT', 'Treatment 트랙 가중 하향 검토'));
      break;
    case 'NO_MEANINGFUL_DIFFERENCE':
      out.push(fb('HOLD_CANDIDATE', '유의미한 차이 없음 — 보류'));
      out.push(fb('INCREASE_EXPLORATION', '탐색 비중 상향 검토'));
      break;
    case 'GUARDRAIL_FAILED':
      out.push(fb('RETIRE_CANDIDATE', 'Guardrail 실패 — Candidate 회수'));
      out.push(fb('REDUCE_EXPLORATION', '안정성 우선 — 탐색 비중 하향'));
      break;
    case 'CONTAMINATED':
    case 'INSUFFICIENT_DATA':
      out.push(fb('HOLD_CANDIDATE', o.classification === 'CONTAMINATED' ? '오염 — 결과 미반영' : '표본 부족 — 결과 미반영'));
      break;
  }
  // drift-driven review
  const driftSecondary = o.secondary.find((s) => s.metric === 'playlist_drift');
  if (driftSecondary && driftSecondary.absoluteDelta != null && driftSecondary.absoluteDelta > 0.15) {
    out.push(fb('REVIEW_DRIFT_THRESHOLD', 'Drift 증가 — 임계값 재검토 권고'));
  }
  return out;
}
