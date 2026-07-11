// AI-MUSIC-1 — Playlist Simulation. Predicts how a proposed track list would perform for a store
// (skip/completion/diversity/fatigue/compatibility) from rule-based track+store signals. SIMULATION ONLY
// — the AI never builds or deploys the playlist; this estimates outcomes for operator review.

import { clamp, round } from '../observability/math';
import { SIM_MIN_TRACKS } from './thresholds';
import { analyzePlaylist } from './playlistIntelligence';
import type { StoreProfile, TrackProfile, Compatibility, PlaylistSimulation, CompatBand, AiConfidenceLevel } from './types';

function bandForScore(score: number): CompatBand {
  if (score >= 82) return 'EXCELLENT';
  if (score >= 66) return 'GOOD';
  if (score >= 50) return 'ACCEPTABLE';
  if (score >= 34) return 'WEAK';
  return 'UNSUITABLE';
}

export interface SimulationInput {
  store: StoreProfile;
  tracks: TrackProfile[];
  compatibilities: Compatibility[];   // per-track compatibility to this store
  confidence: AiConfidenceLevel;
}

export function simulatePlaylist(input: SimulationInput): PlaylistSimulation {
  const { store, tracks, compatibilities, confidence } = input;
  const notes: string[] = [];
  if (tracks.length < SIM_MIN_TRACKS || store.status === 'INSUFFICIENT_DATA') {
    return { storeId: store.storeId, status: 'INSUFFICIENT_DATA', predictedSkipRate: null, predictedCompletion: null, diversity: null, fatigueRisk: null, meanCompatibility: null, band: 'INSUFFICIENT_DATA', confidence, notes: ['표본/트랙 부족'], simulationOnly: true };
  }
  const pi = analyzePlaylist(tracks);
  const compScores = compatibilities.map((c) => c.score).filter((s): s is number => s != null);
  const meanCompatibility = compScores.length ? clamp(compScores.reduce((a, b) => a + b, 0) / compScores.length, 0, 100) : null;

  // Predicted skip/completion: blend store baseline with mean compatibility + fatigue.
  const baseSkip = store.skipRate ?? 0.25;
  const baseCompletion = store.completionRate ?? 0.6;
  const compFactor = meanCompatibility == null ? 0.5 : meanCompatibility / 100;   // 0..1
  const fatiguePenalty = pi.fatigueRisk ?? 0;
  const predictedSkipRate = clamp(baseSkip * (1.3 - compFactor) + fatiguePenalty * 0.15, 0, 1);
  const predictedCompletion = clamp(baseCompletion * (0.7 + compFactor * 0.5) - fatiguePenalty * 0.1, 0, 1);

  if (fatiguePenalty >= 0.35) notes.push('반복 피로 위험 — 다양성 보강 권고');
  if (meanCompatibility != null && meanCompatibility < 50) notes.push('평균 호환 낮음 — 트랙 재구성 권고');
  notes.push('Simulation Only — 자동 배포/재생 없음');

  return {
    storeId: store.storeId, status: 'READY',
    predictedSkipRate: round(predictedSkipRate, 3), predictedCompletion: round(predictedCompletion, 3),
    diversity: pi.diversity, fatigueRisk: pi.fatigueRisk, meanCompatibility: round(meanCompatibility, 1),
    band: meanCompatibility == null ? 'INSUFFICIENT_DATA' : bandForScore(meanCompatibility), confidence, notes, simulationOnly: true,
  };
}
