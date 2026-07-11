// AI-MUSIC-1 — Shared AI-Music types. Everything is a rule-based recommendation/simulation computed from
// READ-ONLY inputs (existing telemetry + store learning + track metadata). No LLM. No auto-deployment.
// Every engine degrades to NO_DATA / INSUFFICIENT_DATA rather than fabricating a musical verdict.

export type AiConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW' | 'INSUFFICIENT_DATA';
export type PrefStrength = 'STRONG' | 'MODERATE' | 'WEAK' | 'NEUTRAL' | 'NO_DATA';

// ── Store Intelligence Profile ───────────────────────────────────────────────
export interface StorePlayAggregate {
  storeId: string;
  storeType: string | null;              // industry/type (카페/병원/…) or null
  plays: number;
  skips: number;
  completes: number;
  likes: number;
  dislikes: number;
  replays: number;
  sessionCount: number;
  avgSessionSeconds: number | null;
  genreShare: Record<string, number>;    // genre → play count
  moodShare: Record<string, number>;     // mood → play count
  instrumentalPlays: number;             // plays of instrumental tracks
  vocalPlays: number;
  energySum: number;                     // Σ energy of played tracks (0..1 each)
  energyCount: number;
  activeHours: Record<string, number>;   // hour(0-23) → play count
}
export interface StoreProfile {
  storeId: string;
  storeType: string | null;
  status: 'READY' | 'INSUFFICIENT_DATA';
  genrePreference: Array<{ key: string; share: number; strength: PrefStrength }>;
  moodPreference: Array<{ key: string; share: number; strength: PrefStrength }>;
  instrumentalPreference: number | null;   // 0..1 instrumental share
  vocalPreference: number | null;
  energyPreference: number | null;         // 0..1 mean energy
  skipRate: number | null;
  completionRate: number | null;
  likeRatio: number | null;
  dislikeRatio: number | null;
  avgSessionSeconds: number | null;
  activeHours: number[];                    // top hours by play count
  seasonalPattern: 'NOT_AVAILABLE';         // rule placeholder — no seasonal data this phase
  weatherPattern: 'NOT_AVAILABLE';          // rule placeholder
  holidayPattern: 'NOT_AVAILABLE';          // rule placeholder
  plays: number;
}

// ── Track Intelligence Profile ───────────────────────────────────────────────
export interface TrackMeta {
  trackId: string;
  title: string | null;
  artistId: string | null;
  genre: string | null;
  mood: string | null;
  energy: number | null;                    // 0..1
  danceability: number | null;              // 0..1
  bpm: number | null;
  instrumental: boolean | null;
  vocal: boolean | null;
  durationSeconds: number | null;
  qcStatus: string | null;                  // reused QC status (e.g. 'approved')
}
export interface TrackPerformance {
  plays: number; skips: number; completes: number; replays: number; likes: number; dislikes: number;
  learningScore: number | null;             // reused store-learning score if available
}
export type BpmBucket = 'SLOW' | 'MEDIUM' | 'UPBEAT' | 'FAST' | 'UNKNOWN';
export type PerfBand = 'STRONG' | 'OK' | 'POOR' | 'NO_DATA';
export interface TrackProfile {
  trackId: string;
  title: string | null;
  genre: string | null;
  mood: string | null;
  energy: number | null;
  danceability: number | null;
  instrumental: boolean | null;
  vocal: boolean | null;
  bpmBucket: BpmBucket;
  timeOfDaySuitability: string[];           // e.g. ['morning','afternoon']
  industrySuitability: string[];            // store types this track suits
  replayPerformance: PerfBand;
  skipPerformance: PerfBand;
  completionPerformance: PerfBand;
  learningConfidence: AiConfidenceLevel;
  qcStatus: string | null;
}

// ── Compatibility ─────────────────────────────────────────────────────────────
export type CompatBand = 'EXCELLENT' | 'GOOD' | 'ACCEPTABLE' | 'WEAK' | 'UNSUITABLE' | 'INSUFFICIENT_DATA';
export interface CompatComponent { key: string; label: string; score: number | null; weight: number; }
export interface Compatibility {
  storeId: string; trackId: string;
  score: number | null;                     // 0..100 over present components
  band: CompatBand;
  components: CompatComponent[];
  reasons: string[];
}

// ── Playlist Intelligence ────────────────────────────────────────────────────
export interface PlaylistIntelligence {
  trackCount: number;
  status: 'READY' | 'INSUFFICIENT_DATA';
  diversity: number | null;                 // 0..1
  fatigueRisk: number | null;               // 0..1
  fatigueBand: 'LOW' | 'MEDIUM' | 'HIGH' | 'NO_DATA';
  genreBalance: number | null;              // 0..1 (evenness)
  moodBalance: number | null;
  artistBalance: number | null;
  energyCurve: number[];                     // per-track energy sequence (nulls → -1)
  repeatRisk: number | null;                 // 0..1
  instrumentalRatio: number | null;
  notes: string[];
}

// ── Discovery Pool ────────────────────────────────────────────────────────────
export type DiscoveryStage = 'CANDIDATE' | 'PILOT' | 'EVALUATION' | 'RECOMMENDED_EXPANSION' | 'APPROVED' | 'GENERAL_DISTRIBUTION';
export interface DiscoveryCandidate {
  trackId: string; title: string | null;
  stage: DiscoveryStage;
  pilotStores: number;
  pilotPlays: number;
  pilotCompletion: number | null;
  pilotSkip: number | null;
  recommendation: string;                   // advisory next step — never auto-deployed
  requiresApproval: true;
  automated: false;
}

// ── Learning Engine ───────────────────────────────────────────────────────────
export interface LearningSignals { skip: number; complete: number; like: number; dislike: number; replay: number; sessionSeconds: number | null; }
export interface LearningProfile {
  scope: string;
  status: 'READY' | 'INSUFFICIENT_DATA';
  affinityScore: number | null;             // -1..1 rule-blended affinity
  band: 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE' | 'NO_DATA';
  signalCount: number;
  breakdown: Record<string, number>;
}

// ── AI Music Director (industry rules) ───────────────────────────────────────
export interface DirectorSlot { part: string; hours: string; mood: string[]; energy: string; note: string; }
export interface DirectorPlan { storeType: string; slots: DirectorSlot[]; source: 'RULE'; }

// ── Recommendation Engine ────────────────────────────────────────────────────
export type RecKind = 'RECOMMEND_TRACK' | 'EXCLUDE_TRACK' | 'RECOMMEND_PLAYLIST' | 'RECOMMEND_GENRE' | 'RECOMMEND_MOOD';
export interface MusicRecommendation {
  id: string; kind: RecKind; targetId: string; label: string; score: number | null; reason: string;
  confidence: AiConfidenceLevel;
  requiresApproval: true; automated: false;
}

// ── Playlist Simulation ───────────────────────────────────────────────────────
export interface PlaylistSimulation {
  storeId: string;
  status: 'READY' | 'INSUFFICIENT_DATA';
  predictedSkipRate: number | null;
  predictedCompletion: number | null;
  diversity: number | null;
  fatigueRisk: number | null;
  meanCompatibility: number | null;
  band: CompatBand;
  confidence: AiConfidenceLevel;
  notes: string[];
  simulationOnly: true;
}

// ── AI Confidence ─────────────────────────────────────────────────────────────
export interface AiConfidenceInput { sampleSize: number; storeHistoryPlays: number; trackHistoryPlays: number; learningCoverage: number; signalCoverage: number; }
export interface AiConfidence { value: number | null; level: AiConfidenceLevel; parts: Array<{ key: string; label: string; score: number; weight: number }>; }
