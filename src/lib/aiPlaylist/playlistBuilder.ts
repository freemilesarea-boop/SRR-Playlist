// AI-MUSIC-2 — Playlist Builder Engine. Generates a PROPOSED playlist for a store from the AI-MUSIC-1
// profiles/compatibility + industry rule + day-part time slot + energy curve + fatigue prevention, with
// per-track explainability. RULE-based (NO LLM). SIMULATION ONLY — the result is a proposal that requires
// operator approval (requiresApproval:true, automated:false, simulationOnly:true); it never writes to any
// real playlist / queue / player.

import { clamp, round } from '../observability/math';
import { analyzePlaylist } from '../aiMusic';
import type { TrackProfile } from '../aiMusic/types';
import {
  DEFAULT_TARGET_LENGTH, MAX_TARGET_LENGTH, MIN_POOL_FOR_BUILD, MIN_PICKS_FOR_READY, BUILD_WEIGHTS,
  ENERGY_STAGE_LEVELS,
} from './thresholds';
import { industryPlaylistRule } from './industryIntelligence';
import { resolveTimeSlot } from './timeIntelligence';
import { targetEnergyCurve, targetEnergyAt, scoreEnergyCurve } from './energyCurve';
import { fatigueFactor, playlistFatigueRisk } from './fatiguePrevention';
import { localDestreak, measureDiversity } from './diversityOptimizer';
import { computePlaylistBuildConfidence } from './confidence';
import type {
  PlaylistBuildInput, GeneratedPlaylist, PlaylistTrackPick, BuilderTrack, TimeSlot, IndustryPlaylistRule,
  BuildStrategy, PlaylistExplain,
} from './types';

// Per-strategy component weight multipliers (applied to BUILD_WEIGHTS).
const STRATEGY_MULT: Record<BuildStrategy, { compatibility: number; industryFit: number; timeFit: number; learning: number; freshness: number }> = {
  BALANCED: { compatibility: 1, industryFit: 1, timeFit: 1, learning: 1, freshness: 1 },
  COMPATIBILITY_FIRST: { compatibility: 1.5, industryFit: 1, timeFit: 0.9, learning: 1.1, freshness: 0.8 },
  DISCOVERY_FORWARD: { compatibility: 0.9, industryFit: 1.1, timeFit: 1, learning: 0.7, freshness: 1.8 },
};

function industryFit(t: BuilderTrack, rule: IndustryPlaylistRule): number {
  const g = t.genre == null ? 0.4 : rule.targetGenres.some((x) => x.toLowerCase() === t.genre!.toLowerCase()) ? 1 : 0.3;
  const m = t.mood == null ? 0.4 : rule.targetMoods.some((x) => x.toLowerCase() === t.mood!.toLowerCase()) ? 1 : 0.35;
  const inst = t.instrumental == null ? 0.5 : clamp(1 - Math.abs(rule.instrumentalTarget - (t.instrumental ? 1 : 0)), 0, 1);
  return clamp(g * 0.5 + m * 0.35 + inst * 0.15, 0, 1);
}

function slotTargetEnergy(slot: TimeSlot | null, rule: IndustryPlaylistRule): number {
  if (slot) return ENERGY_STAGE_LEVELS[slot.energyHint];
  if (rule.energyProfile === 'LOW') return ENERGY_STAGE_LEVELS.LOW;
  if (rule.energyProfile === 'HIGH') return ENERGY_STAGE_LEVELS.HIGH;
  return ENERGY_STAGE_LEVELS.MEDIUM;   // MEDIUM or CURVE → mid baseline for suitability scoring
}

function timeFit(t: BuilderTrack, slot: TimeSlot | null, rule: IndustryPlaylistRule): number {
  if (t.energy == null) return 0.5;    // unknown energy → neutral
  return clamp(1 - Math.abs(t.energy - slotTargetEnergy(slot, rule)), 0, 1);
}

interface Scored { track: BuilderTrack; components: Record<string, number>; pickScore: number; }

function scoreTrack(t: BuilderTrack, slot: TimeSlot | null, rule: IndustryPlaylistRule, strategy: BuildStrategy): Scored {
  const compat = t.compatScore == null ? 0.35 : clamp(t.compatScore / 100, 0, 1);
  const ind = industryFit(t, rule);
  const time = timeFit(t, slot, rule);
  const learn = t.learningScore == null ? 0.5 : clamp(t.learningScore, 0, 1);
  const fresh = fatigueFactor(t.recentPlays7d);
  const mult = STRATEGY_MULT[strategy];
  const defs: Array<{ v: number; w: number }> = [
    { v: compat, w: BUILD_WEIGHTS.compatibility * mult.compatibility },
    { v: ind, w: BUILD_WEIGHTS.industryFit * mult.industryFit },
    { v: time, w: BUILD_WEIGHTS.timeFit * mult.timeFit },
    { v: learn, w: BUILD_WEIGHTS.learning * mult.learning },
    { v: fresh, w: BUILD_WEIGHTS.freshness * mult.freshness },
  ];
  const totW = defs.reduce((s, d) => s + d.w, 0);
  const pickScore = clamp((defs.reduce((s, d) => s + d.v * d.w, 0) / totW) * 100, 0, 100);
  return { track: t, components: { compat, industryFit: ind, timeFit: time, learning: learn, freshness: fresh }, pickScore: round(pickScore, 1) as number };
}

function explainFor(s: Scored, rule: IndustryPlaylistRule, slot: TimeSlot | null): PlaylistExplain {
  const c = s.components;
  const factors = [
    { key: 'genreMatch', label: 'Genre / Industry Match', score: round(c.industryFit * 100, 0) as number },
    { key: 'storeLearning', label: 'Store Learning', score: round(c.learning * 100, 0) as number },
    { key: 'timeRule', label: slot ? `${slot.label} Rule` : `${rule.storeType} Rule`, score: round(c.timeFit * 100, 0) as number },
    { key: 'compatibility', label: 'Compatibility', score: round(c.compat * 100, 0) as number },
    { key: 'freshness', label: 'Freshness (fatigue)', score: round(c.freshness * 100, 0) as number },
  ];
  const top = [...factors].sort((a, b) => b.score - a.score)[0];
  return { factors, summary: `${top.label} ${top.score}% 주도 · pickScore ${s.pickScore}` };
}

/** Order selected tracks to follow the Low→Medium→High→Medium→Low target energy curve. */
function orderByEnergyCurve(scored: Scored[]): Scored[] {
  const n = scored.length;
  const withEnergy = scored.filter((s) => s.track.energy != null);
  const noEnergy = scored.filter((s) => s.track.energy == null);
  const remaining = [...withEnergy];
  const ordered: Scored[] = [];
  for (let i = 0; i < withEnergy.length; i++) {
    const target = targetEnergyAt(i, n);
    let bestIdx = 0, bestErr = Infinity;
    for (let j = 0; j < remaining.length; j++) {
      const err = Math.abs((remaining[j].track.energy as number) - target) - remaining[j].pickScore * 0.0005; // tiny score tiebreak
      if (err < bestErr) { bestErr = err; bestIdx = j; }
    }
    ordered.push(remaining.splice(bestIdx, 1)[0]);
  }
  // Interleave unknown-energy tracks evenly.
  if (noEnergy.length) {
    const step = Math.max(1, Math.floor((ordered.length + noEnergy.length) / (noEnergy.length + 1)));
    let pos = step;
    for (const s of noEnergy) { ordered.splice(Math.min(pos, ordered.length), 0, s); pos += step + 1; }
  }
  return ordered;
}

function toPick(s: Scored, position: number, rule: IndustryPlaylistRule, slot: TimeSlot | null): PlaylistTrackPick {
  return {
    trackId: s.track.trackId, title: s.track.title, position,
    genre: s.track.genre, mood: s.track.mood, energy: s.track.energy, bpm: s.track.bpm,
    compatScore: s.track.compatScore, pickScore: s.pickScore, explain: explainFor(s, rule, slot),
  };
}

// A light TrackProfile shim so we can reuse AI-MUSIC-1 analyzePlaylist for structural intelligence.
function toTrackProfile(p: PlaylistTrackPick): TrackProfile {
  return {
    trackId: p.trackId, title: p.title, genre: p.genre, mood: p.mood, energy: p.energy, danceability: null,
    instrumental: null, vocal: null, bpmBucket: 'UNKNOWN', timeOfDaySuitability: [], industrySuitability: [],
    replayPerformance: 'NO_DATA', skipPerformance: 'NO_DATA', completionPerformance: 'NO_DATA',
    learningConfidence: 'INSUFFICIENT_DATA', qcStatus: null,
  };
}

export function buildPlaylist(input: PlaylistBuildInput): GeneratedPlaylist {
  const rule = industryPlaylistRule(input.storeType);
  const slot = resolveTimeSlot(input.hour);
  const targetLength = clamp(Math.floor(input.targetLength || DEFAULT_TARGET_LENGTH), 1, MAX_TARGET_LENGTH);
  const empty = (notes: string[]): GeneratedPlaylist => ({
    storeId: input.storeId, storeType: input.storeType, status: 'INSUFFICIENT_DATA', strategy: input.strategy,
    timeSlot: slot, industryRule: rule, picks: [], trackCount: 0, energyCurve: [], targetEnergyCurve: [],
    curveFit: null, diversity: null, fatigueRisk: null,
    intelligence: analyzePlaylist([]),
    confidence: { value: null, level: 'INSUFFICIENT_DATA', parts: [] },  // no playlist built → no confidence
    notes, requiresApproval: true, automated: false, simulationOnly: true,
  });

  if (!input.storeReady) return empty(['store 프로필 표본 부족 — 생성 보류']);
  if (input.pool.length < MIN_POOL_FOR_BUILD) return empty([`후보 트랙 부족 (${input.pool.length} < ${MIN_POOL_FOR_BUILD})`]);

  // 1) score + select
  const scored = input.pool.map((t) => scoreTrack(t, slot, rule, input.strategy)).sort((a, b) => b.pickScore - a.pickScore);
  const selected = scored.slice(0, targetLength);
  if (selected.length < MIN_PICKS_FOR_READY) return empty(['유효 트랙 부족 — 생성 보류']);

  // 2) order by energy curve, 3) light de-streak preserving the curve
  const ordered = orderByEnergyCurve(selected);
  let picks = ordered.map((s, i) => toPick(s, i + 1, rule, slot));
  picks = localDestreak(picks);

  // 4) metrics
  const energyCurveActual = picks.map((p) => (p.energy == null ? -1 : round(p.energy, 2) as number));
  const curveFit = scoreEnergyCurve(picks.map((p) => p.energy));
  const div = measureDiversity(picks);
  const recentByTrack = new Map(input.pool.map((t) => [t.trackId, t.recentPlays7d]));
  const fatigueRisk = playlistFatigueRisk(picks.map((p) => recentByTrack.get(p.trackId) ?? 0));
  const intelligence = analyzePlaylist(picks.map(toTrackProfile));

  const compatCoverage = selected.filter((s) => s.track.compatScore != null).length / selected.length;
  const learningCoverage = selected.filter((s) => s.track.learningScore != null).length / selected.length;
  const confidence = computePlaylistBuildConfidence({ poolSize: input.pool.length, storeReady: input.storeReady, compatCoverage, learningCoverage, curveFit });

  const notes: string[] = ['Simulation Only — 운영자 승인 전 실제 Playlist 변경 없음'];
  if (curveFit != null && curveFit < 0.5) notes.push('에너지 커브 적합도 낮음');
  if (fatigueRisk != null && fatigueRisk >= 0.35) notes.push('반복 피로 위험 — 다양성/신선도 보강 권고');
  if (div.genreDiversity != null && div.genreDiversity < 0.4) notes.push('장르 다양성 낮음');

  return {
    storeId: input.storeId, storeType: input.storeType, status: 'READY', strategy: input.strategy,
    timeSlot: slot, industryRule: rule, picks, trackCount: picks.length,
    energyCurve: energyCurveActual, targetEnergyCurve: targetEnergyCurve(picks.length), curveFit,
    diversity: div.genreDiversity, fatigueRisk, intelligence, confidence, notes,
    requiresApproval: true, automated: false, simulationOnly: true,
  };
}
