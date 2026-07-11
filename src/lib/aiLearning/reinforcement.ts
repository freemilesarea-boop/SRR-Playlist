// AI-MUSIC-3 — Reinforcement Rules. RULE-based (NO reinforcement-learning model / NO LLM) reward/penalty
// blend from real playback + reaction signals: reward = complete/like/long-session, penalty =
// skip/dislike/repeat-fatigue. Read-only — it produces a learning signal, never a playback change.

import { clamp, round, safeRatio } from '../observability/math';
import { MIN_PLAYS_FOR_REINFORCEMENT, REWARD_WEIGHTS, PENALTY_WEIGHTS } from './thresholds';
import type { ReinforcementSignals, ReinforcementScore } from './types';

export function computeReinforcement(s: ReinforcementSignals): ReinforcementScore {
  if (s.plays < MIN_PLAYS_FOR_REINFORCEMENT) {
    return { status: 'INSUFFICIENT_DATA', reward: null, penalty: null, net: null, breakdown: {} };
  }
  const rw = REWARD_WEIGHTS, pw = PENALTY_WEIGHTS;
  // Per-play rates × weights, then normalized by the total weight so reward/penalty land in 0..1.
  const rewardRaw = safeRatio(s.completes, s.plays) * rw.complete + safeRatio(s.likes, s.plays) * rw.like + safeRatio(s.longSessions, s.plays) * rw.longSession;
  const penaltyRaw = safeRatio(s.skips, s.plays) * pw.skip + safeRatio(s.dislikes, s.plays) * pw.dislike + safeRatio(s.repeatFatigue, s.plays) * pw.repeatFatigue;
  const rewardW = rw.complete + rw.like + rw.longSession;
  const penaltyW = pw.skip + pw.dislike + pw.repeatFatigue;
  const reward = clamp(rewardRaw / rewardW, 0, 1);
  const penalty = clamp(penaltyRaw / penaltyW, 0, 1);
  const net = clamp(reward - penalty, -1, 1);
  return {
    status: 'READY',
    reward: round(reward, 3), penalty: round(penalty, 3), net: round(net, 3),
    breakdown: {
      complete: round(safeRatio(s.completes, s.plays), 3) ?? 0,
      like: round(safeRatio(s.likes, s.plays), 3) ?? 0,
      longSession: round(safeRatio(s.longSessions, s.plays), 3) ?? 0,
      skip: round(safeRatio(s.skips, s.plays), 3) ?? 0,
      dislike: round(safeRatio(s.dislikes, s.plays), 3) ?? 0,
      repeatFatigue: round(safeRatio(s.repeatFatigue, s.plays), 3) ?? 0,
    },
  };
}
