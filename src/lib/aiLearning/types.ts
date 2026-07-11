// AI-MUSIC-3 — Adaptive Music Intelligence & Continuous Learning types. Rule-based (NO LLM) learning loop
// over the AI-MUSIC-1/2 outputs + READ-ONLY real operation data (playback + reactions). Everything is a
// Recommendation — the AI never changes the real Player / Playback / Queue / Playlist / ranking / settlement.
// Every classifier degrades to NO_DATA / INSUFFICIENT_DATA rather than fabricating.

export type LearningStatus = 'READY' | 'INSUFFICIENT_DATA';
export type Trend = 'RISING' | 'FLAT' | 'FALLING';

// ── Reinforcement (rule-based reward / penalty) ────────────────────────────────
export interface ReinforcementSignals {
  plays: number;
  completes: number;
  likes: number;
  longSessions: number;      // sessions above the long-session floor
  skips: number;
  dislikes: number;
  repeatFatigue: number;     // count of over-repeated plays (from AI-MUSIC-2 fatigue)
}
export interface ReinforcementScore {
  status: LearningStatus;
  reward: number | null;     // 0..1 normalized positive signal
  penalty: number | null;    // 0..1 normalized negative signal
  net: number | null;        // -1..1 (reward - penalty)
  breakdown: Record<string, number>;
}

// ── Adaptive Playlist Score (score changes over time) ──────────────────────────
export interface AdaptiveScore {
  status: LearningStatus;
  yesterday: number | null;  // prior score (0..100)
  today: number | null;      // updated score after reinforcement
  next: number | null;       // projected next-recommendation score
  delta: number | null;      // today - yesterday
  trend: Trend;
}

// ── Track Reputation (Excellent / Good / Weak / Recovering) ─────────────────────
export type ReputationBand = 'EXCELLENT' | 'GOOD' | 'WEAK' | 'RECOVERING' | 'NO_DATA';
export interface TrackReputationInput {
  trackId: string;
  title: string | null;
  completionRate: number | null;   // 0..1
  skipRate: number | null;         // 0..1
  likeRate: number | null;         // 0..1
  replayRate: number | null;       // 0..1
  plays: number;
  priorScore: number | null;       // previous reputation score (0..100) for trend / RECOVERING
}
export interface TrackReputation {
  trackId: string;
  title: string | null;
  status: LearningStatus;
  score: number | null;            // 0..100
  band: ReputationBand;
  trend: Trend;
  reasons: string[];
}

// ── Playlist Evolution (V1 → V2 → … → History) ─────────────────────────────────
export interface PlaylistVersion {
  version: number;
  score: number | null;
  trackCount: number;
  diversity: number | null;
  fatigueRisk: number | null;
  label: string | null;
}
export interface PlaylistEvolution {
  status: LearningStatus;
  versions: Array<PlaylistVersion & { delta: number | null }>;
  latestScore: number | null;
  overallTrend: Trend;
  summary: string;
}

// ── Exploration vs Exploitation (80% best / 20% discovery) ─────────────────────
export interface ExplorationPlan {
  poolSize: number;
  exploitRatio: number;      // e.g. 0.8
  exploitCount: number;      // best-track slots
  exploreCount: number;      // discovery slots
  note: string;
}

// ── Discovery Expansion (Pilot → Small → Medium → Large → Global) ──────────────
export type ExpansionStage = 'PILOT' | 'SMALL_GROUP' | 'MEDIUM' | 'LARGE' | 'GLOBAL_RECOMMENDATION';
export interface DiscoveryExpansionInput {
  trackId: string;
  title: string | null;
  stage: ExpansionStage;
  reachStores: number;
  plays: number;
  completionRate: number | null;
  skipRate: number | null;
}
export interface DiscoveryExpansion {
  trackId: string;
  title: string | null;
  status: LearningStatus;
  currentStage: ExpansionStage;
  recommendedStage: ExpansionStage;
  advance: boolean;          // recommend advancing? (never auto — requiresApproval)
  reason: string;
  requiresApproval: true;
  automated: false;
}

// ── Seasonal / Time / Industry learning ────────────────────────────────────────
export type Season = 'SPRING' | 'SUMMER' | 'FALL' | 'WINTER';
export type DayPart = 'MORNING' | 'LUNCH' | 'EVENING' | 'LATE_NIGHT';
export interface SegmentAggregate { plays: number; completionRate: number | null; topGenres: string[]; }
export interface SegmentLearning<K extends string> {
  status: LearningStatus;
  segments: Array<{ key: K; plays: number; completionRate: number | null; topGenres: string[]; strength: 'STRONG' | 'MODERATE' | 'WEAK' | 'NO_DATA' }>;
  bestSegment: K | null;
  note: string;
}

// ── Playlist Drift (how far from the original intent) ──────────────────────────
export interface DriftProfile {
  genreShare: Record<string, number>;
  moodShare: Record<string, number>;
  energyMean: number | null;
}
export interface PlaylistDrift {
  status: LearningStatus;
  drift: number | null;      // 0..1 (0 = identical to original intent)
  band: 'LOW' | 'MEDIUM' | 'HIGH' | 'NO_DATA';
  genreDrift: number | null;
  moodDrift: number | null;
  energyDrift: number | null;
  notes: string[];
}

// ── Explainability v2 (8 factors per track) ────────────────────────────────────
export interface ExplainV2Factor { key: string; label: string; score: number | null; }  // 0..100 or null
export interface ExplainV2 {
  trackId: string;
  title: string | null;
  factors: ExplainV2Factor[];   // Genre / Mood / Energy / Learning / Discovery / Industry / Time / Confidence
  summary: string;
}

// ── Continuous Learning loop result ────────────────────────────────────────────
export interface LearningLoopResult {
  storeId: string;
  status: LearningStatus;
  reinforcement: ReinforcementScore;
  adaptiveScore: AdaptiveScore;
  nextRecommendationScore: number | null;
  notes: string[];
  requiresApproval: true;
  automated: false;
}
