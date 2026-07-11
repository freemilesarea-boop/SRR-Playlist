// AI-MUSIC-2 — Intelligent Playlist Generation & Optimization types. Builds on the AI-MUSIC-1 engines
// (StoreProfile / TrackProfile / Compatibility) to GENERATE a proposed playlist. Rule-based (NO LLM).
// Every output is SIMULATION ONLY — the AI never writes to any real playlist / queue / player; a generated
// playlist is a proposal that requires operator approval (requiresApproval:true, automated:false).

import type { AiConfidenceLevel, PlaylistIntelligence } from '../aiMusic/types';

// ── Time Intelligence ─────────────────────────────────────────────────────────
export type EnergyStage = 'LOW' | 'MEDIUM' | 'HIGH';
export interface TimeSlot {
  key: string;             // MORNING / LUNCH / AFTERNOON / DINNER / CLOSING
  label: string;           // human label (예: Coffee/Morning)
  startHour: number;       // inclusive 0-23
  endHour: number;         // exclusive 1-24
  energyHint: EnergyStage;
  moodHint: string[];
}

// ── Industry Intelligence ──────────────────────────────────────────────────────
export type EnergyProfile = 'LOW' | 'MEDIUM' | 'HIGH' | 'CURVE';
export interface IndustryPlaylistRule {
  storeType: string;               // resolved industry key (cafe/hospital/…/general)
  targetGenres: string[];
  targetMoods: string[];
  energyProfile: EnergyProfile;
  instrumentalTarget: number;      // 0..1 desired instrumental share
  note: string;
  source: 'RULE';
}

// ── Explainability (per picked track) ──────────────────────────────────────────
export interface ExplainFactor { key: string; label: string; score: number; }  // score 0..100
export interface PlaylistExplain { factors: ExplainFactor[]; summary: string; }

export interface PlaylistTrackPick {
  trackId: string;
  title: string | null;
  position: number;                // 1-based order in the generated playlist
  genre: string | null;
  mood: string | null;
  energy: number | null;           // 0..1
  bpm: number | null;
  compatScore: number | null;      // 0..100 store↔track compatibility
  pickScore: number;               // 0..100 builder suitability score
  explain: PlaylistExplain;
}

// ── Build input / strategy ──────────────────────────────────────────────────────
export type BuildStrategy = 'BALANCED' | 'COMPATIBILITY_FIRST' | 'DISCOVERY_FORWARD';

export interface BuilderTrack {
  trackId: string;
  title: string | null;
  genre: string | null;
  mood: string | null;
  energy: number | null;
  instrumental: boolean | null;
  bpm: number | null;
  compatScore: number | null;      // from AI-MUSIC-1 compatibility
  learningScore: number | null;    // -? store-learning affinity if available
  recentPlays7d: number;           // plays of this track at this store in the last 7 days (fatigue signal)
}

export interface PlaylistBuildInput {
  storeId: string;
  storeType: string | null;
  storeReady: boolean;             // StoreProfile.status === 'READY'
  storeEnergyPreference: number | null;
  hour: number | null;             // day-part hint (0-23) or null → whole-day plan
  targetLength: number;
  strategy: BuildStrategy;
  pool: BuilderTrack[];
}

// ── Playlist build confidence (HIGH/MEDIUM/LOW/INSUFFICIENT_DATA) ────────────────
export interface PlaylistBuildConfidenceInput {
  poolSize: number;
  storeReady: boolean;
  compatCoverage: number;          // 0..1 fraction of pool with a compatibility score
  learningCoverage: number;        // 0..1 fraction with a learning score
  curveFit: number | null;         // 0..1 energy-curve fit of the built playlist
}
export interface PlaylistBuildConfidence {
  value: number | null;
  level: AiConfidenceLevel;
  parts: Array<{ key: string; label: string; score: number; weight: number }>;
}

// ── Generated playlist (proposal — SIMULATION ONLY) ─────────────────────────────
export interface GeneratedPlaylist {
  storeId: string;
  storeType: string | null;
  status: 'READY' | 'INSUFFICIENT_DATA';
  strategy: BuildStrategy;
  timeSlot: TimeSlot | null;
  industryRule: IndustryPlaylistRule;
  picks: PlaylistTrackPick[];
  trackCount: number;
  energyCurve: number[];           // actual per-track energy (nulls → -1)
  targetEnergyCurve: number[];     // Low→Med→High→Med→Low target
  curveFit: number | null;         // 0..1
  diversity: number | null;
  fatigueRisk: number | null;      // 0..1 (recent-7d repeat weighted)
  intelligence: PlaylistIntelligence;
  confidence: PlaylistBuildConfidence;
  notes: string[];
  requiresApproval: true;          // operator approval required before any real change
  automated: false;                // never auto-deployed
  simulationOnly: true;            // outcome is a proposal/estimate only
}

// ── Candidate comparison (A vs B vs C → best) ───────────────────────────────────
export interface PlaylistCandidate {
  label: string;                   // A / B / C
  strategy: BuildStrategy;
  playlist: GeneratedPlaylist;
  score: number | null;            // 0..100 composite candidate score
  isBest: boolean;
  metrics: { compatibility: number | null; diversity: number | null; fatigueRisk: number | null; curveFit: number | null; confidence: number | null };
}
export interface CandidateComparison {
  storeId: string;
  candidates: PlaylistCandidate[];
  bestLabel: string | null;
  notes: string[];
  simulationOnly: true;
}
