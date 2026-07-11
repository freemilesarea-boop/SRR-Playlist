// AI-MUSIC-3 — Continuous Learning loop. Ties the cycle together:
//   Store → Playlist → Playback → Reaction → Learning → Next Playlist.
// Given real playback + reaction signals and the playlist's prior score, it computes the reinforcement
// signal, the adaptive score update, and the next-recommendation score. RULE-based, read-only — the AI
// recommends the next score; it never deploys a playlist (requiresApproval:true, automated:false).

import { computeReinforcement } from './reinforcement';
import { computeAdaptiveScore } from './adaptiveScore';
import type { ReinforcementSignals, LearningLoopResult } from './types';

export interface LearningLoopInput {
  storeId: string;
  priorScore: number | null;      // playlist's yesterday score
  signals: ReinforcementSignals;  // real playback + reaction signals
}

export function runLearningLoop(input: LearningLoopInput): LearningLoopResult {
  const reinforcement = computeReinforcement(input.signals);
  const adaptiveScore = computeAdaptiveScore(input.priorScore, reinforcement, input.signals.plays);
  const status = reinforcement.status === 'READY' && adaptiveScore.status === 'READY' ? 'READY' : 'INSUFFICIENT_DATA';
  const notes: string[] = ['Recommendation Only — 실제 Playlist/재생 변경 없음 (운영자 승인 필요)'];
  if (status === 'INSUFFICIENT_DATA') notes.push('학습 신호 부족 — 다음 점수 보류');
  else if (adaptiveScore.trend === 'RISING') notes.push('상승 추세 — 현 방향 강화 권고');
  else if (adaptiveScore.trend === 'FALLING') notes.push('하락 추세 — 구성 재검토 권고');
  return {
    storeId: input.storeId, status, reinforcement, adaptiveScore,
    nextRecommendationScore: adaptiveScore.next, notes,
    requiresApproval: true, automated: false,
  };
}
