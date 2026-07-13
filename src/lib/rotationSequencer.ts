/**
 * rotationSequencer — Adaptive Rotation & Anti-Fatigue Sequencing (Phase AI-PLAYLIST-5).
 *
 * Selection(어떤 Track) 과 Sequencing(어떤 순서) 을 분리한다. 이 모듈은 **Generator 가
 * 선택한 Track 만** 입력받아, 반복 피로도·아티스트/장르/무드 편중·BPM/무드 흐름·재발견·
 * 신곡 노출을 고려한 재생 순서 초안을 Constraint-aware Greedy 로 생성한다(단위 테스트 대상).
 * **새 Track 추가/자동 Queue 반영 없음.** 무작위 순서 금지(결정론적·재현 가능).
 *
 * 원칙: Evidence 없는 배치 금지 · Track 중복 금지 · 존재하는 신호만(BPM/Mood null 제외) ·
 * 점수 0~100 clamp · NaN/Infinity 금지 · Hard Constraint 위반 금지 · 완화 내역 기록.
 */
import { clampPct } from './playlistIntel';

/* ── 입력 Track (rotation pool) ─────────────────────────────────────── */
export interface RotationTrack {
  track_id: string; title: string | null; artist: string | null; main_genre: string | null; mood: string | null;
  bpm: number | null; duration: number | null;
  events: number; skip_rate: number | null; completion_rate: number | null;
  p1d: number; p7d: number; p30d: number; last_played_at: string | null; days_since_last_play: number | null;
  rollout_stage: string | null; compatibility?: number | null;
}

const isNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const clamp100 = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();

/* ── Rotation Profile (Track-level; 문맥 압박은 시퀀싱에서 별도 적용) ────── */
export interface RotationProfile {
  track: RotationTrack;
  fatigue: number; freshness: number; rediscovery: number;
  frequencyPressure: number; recencyPressure: number;
}

/** Fatigue = 재생 빈도(1d/7d/30d) + 최근성. 0~100. 문맥(아티스트/장르) 압박은 시퀀싱 단계. */
export function buildProfile(t: RotationTrack, nowMs: number): RotationProfile {
  const frequencyPressure = clamp100((clamp01(t.p1d / 5) * 0.5 + clamp01(t.p7d / 20) * 0.3 + clamp01(t.p30d / 60) * 0.2) * 100);
  let recencyPressure = 0;
  const days = isNum(t.days_since_last_play) ? t.days_since_last_play : (t.last_played_at ? (nowMs - Date.parse(t.last_played_at)) / 86400e3 : null);
  if (isNum(days)) recencyPressure = days <= 1 ? 100 : days <= 3 ? 60 : days <= 7 ? 30 : days <= 14 ? 10 : 0;
  const fatigue = clamp100(frequencyPressure * 0.6 + recencyPressure * 0.4);
  const freshness = clamp100(100 - fatigue);
  // Rediscovery = 성과(완주·낮은 skip) 우수 + 장기 미노출. 최근 미재생만으로 저성과 우선 금지.
  const comp = clampPct(t.completion_rate) ?? 0;
  const skipInv = 100 - (clampPct(t.skip_rate) ?? 0);
  const perf = (comp * 0.6 + skipInv * 0.4) / 100; // 0~1
  const exposureGap = isNum(days) ? clamp01((days - 14) / 30) : 0; // 14일 이후부터 증가
  const rediscovery = clamp100(perf * exposureGap * 100);
  return { track: t, fatigue, freshness, rediscovery, frequencyPressure, recencyPressure };
}

/* ── Rotation Budget (합계 100) ─────────────────────────────────────── */
export type Bucket = 'core_verified' | 'recent_winner' | 'new_test' | 'rediscovery' | 'surprise';
export interface RotationBudget { core_verified: number; recent_winner: number; new_test: number; rediscovery: number; surprise: number }
export const DEFAULT_ROTATION_BUDGET: RotationBudget = { core_verified: 50, recent_winner: 20, new_test: 10, rediscovery: 15, surprise: 5 };
export function budgetSum(b: RotationBudget): number { return b.core_verified + b.recent_winner + b.new_test + b.rediscovery + b.surprise; }
export function budgetValid(b: RotationBudget): boolean { return budgetSum(b) === 100; }

/** Track → 버킷 분류(실제 rollout/성과/재발견 기반). */
export function classifyBucket(p: RotationProfile): Bucket {
  const t = p.track;
  if (p.rediscovery >= 40) return 'rediscovery';
  const stage = t.rollout_stage;
  if (stage === 'test_pool' || stage === 'pilot' || stage === 'draft') return 'new_test';
  if (stage === 'limited') return 'recent_winner';
  if ((clampPct(t.completion_rate) ?? 0) >= 78 && t.p7d > 0) return 'recent_winner';
  if (stage === 'global' || stage === 'expanded' || t.events >= 20) return 'core_verified';
  return 'new_test';
}

/* ── Hard / Soft Constraint 설정 ────────────────────────────────────── */
export interface SequenceConfig {
  targetCount: number;
  budget: RotationBudget;
  maxFatigue: number;              // Hard: 이 이상 Fatigue 제외
  minCompatibility: number;        // Hard: 미달 제외
  bannedGenres: string[];          // Hard
  bannedMoods: string[];           // Hard
  maxConsecutiveArtist: number;    // Soft
  artistWindow: number; maxArtistInWindow: number; // Soft: 최근 N곡 내 동일 아티스트 최대
  maxArtistShare: number;          // Soft: 전체 점유율
  maxConsecutiveGenre: number;     // Soft
  maxConsecutiveMood: number;      // Soft
  maxBpmJump: number;              // Soft: BPM 급변(있을 때만)
  surpriseBudget: number;          // 0~1
}
export const DEFAULT_SEQUENCE_CONFIG: SequenceConfig = {
  targetCount: 30, budget: DEFAULT_ROTATION_BUDGET, maxFatigue: 85, minCompatibility: 0,
  bannedGenres: [], bannedMoods: [], maxConsecutiveArtist: 1, artistWindow: 5, maxArtistInWindow: 2, maxArtistShare: 0.15,
  maxConsecutiveGenre: 2, maxConsecutiveMood: 2, maxBpmJump: 30, surpriseBudget: 0.05,
};

/* ── Sequencing Score (존재 신호만 가중, 재정규화) ───────────────────── */
export interface SeqScoreSignal { key: string; weight: number; value: number; present: boolean }
export function sequencingScore(p: RotationProfile, ctx: { lastBpm: number | null }): { score: number; signals: SeqScoreSignal[] } {
  const t = p.track;
  const comp = clampPct(t.completion_rate); const skip = clampPct(t.skip_rate);
  const bpmFlow = isNum(t.bpm) && t.bpm > 0 && isNum(ctx.lastBpm) ? clamp01(1 - Math.abs(t.bpm - ctx.lastBpm) / 60) : null;
  const signals: SeqScoreSignal[] = [
    { key: 'compatibility', weight: 0.2, value: clamp01((t.compatibility ?? 0) / 100), present: isNum(t.compatibility) },
    { key: 'completion', weight: 0.2, value: comp != null ? comp / 100 : 0, present: comp != null },
    { key: 'skip_inverse', weight: 0.15, value: skip != null ? 1 - skip / 100 : 0, present: skip != null },
    { key: 'fatigue_inverse', weight: 0.2, value: (100 - p.fatigue) / 100, present: true },
    { key: 'freshness', weight: 0.1, value: p.freshness / 100, present: true },
    { key: 'rediscovery', weight: 0.1, value: p.rediscovery / 100, present: true },
    { key: 'bpm_flow', weight: 0.05, value: bpmFlow ?? 0, present: bpmFlow != null },
  ];
  const present = signals.filter((s) => s.present);
  const wsum = present.reduce((s, x) => s + x.weight, 0);
  const score = wsum > 0 ? clamp100((present.reduce((s, x) => s + x.value * x.weight, 0) / wsum) * 100) : 0;
  return { score, signals };
}

/* ── Sequence 생성 (Constraint-aware Greedy, 결정론적) ─────────────────── */
export interface SequencedTrack {
  position: number; track: RotationTrack; bucket: Bucket; score: number; fatigue: number; reason: string;
}
export interface Relaxation { position: number; constraint: string; detail: string }
export interface SequenceResult {
  sequence: SequencedTrack[]; excluded: Array<{ track: RotationTrack; reason: string }>;
  relaxations: Relaxation[]; bucketActual: Record<Bucket, number>; bucketTarget: Record<Bucket, number>;
}

/** Hard constraint 위반 Track 은 후보에서 제외. 이유 반환(없으면 null). */
function hardViolation(p: RotationProfile, cfg: SequenceConfig): string | null {
  const t = p.track;
  if (cfg.bannedGenres.map(norm).includes(norm(t.main_genre))) return '금지 장르';
  if (cfg.bannedMoods.map((m) => m.trim()).includes((t.mood ?? '').trim()) && !!t.mood) return '금지 무드';
  if (p.fatigue > cfg.maxFatigue) return `Fatigue 초과(${p.fatigue}>${cfg.maxFatigue})`;
  if (isNum(t.compatibility) && t.compatibility < cfg.minCompatibility) return `적합도 미달(${t.compatibility}<${cfg.minCompatibility})`;
  return null;
}

/**
 * 결정론적 Greedy 시퀀싱. 동점 tie-break: fatigue↑낮은 → days_since↑큰 → compatibility↓높은 → track_id.
 * Soft constraint 위반은 감점(패널티)으로 반영하고, 후보가 전부 위반이면 최소 위반으로 완화(기록).
 */
export function generateSequence(tracks: RotationTrack[], cfg: SequenceConfig, nowMs: number): SequenceResult {
  const profiles = tracks.map((t) => buildProfile(t, nowMs));
  const excluded: Array<{ track: RotationTrack; reason: string }> = [];
  const eligible = profiles.filter((p) => { const v = hardViolation(p, cfg); if (v) { excluded.push({ track: p.track, reason: v }); return false; } return true; });

  const target = Math.max(1, Math.min(cfg.targetCount, eligible.length, 500));
  const bucketTarget: Record<Bucket, number> = {
    core_verified: Math.round(target * cfg.budget.core_verified / 100),
    recent_winner: Math.round(target * cfg.budget.recent_winner / 100),
    new_test: Math.round(target * cfg.budget.new_test / 100),
    rediscovery: Math.round(target * cfg.budget.rediscovery / 100),
    surprise: Math.round(target * cfg.budget.surprise / 100),
  };
  const bucketActual: Record<Bucket, number> = { core_verified: 0, recent_winner: 0, new_test: 0, rediscovery: 0, surprise: 0 };
  const bucketOf = new Map(eligible.map((p) => [p.track.track_id, classifyBucket(p)]));

  const sequence: SequencedTrack[] = [];
  const relaxations: Relaxation[] = [];
  const used = new Set<string>();
  const recentArtists: string[] = []; // window
  const artistTotal = new Map<string, number>();

  const softPenalty = (p: RotationProfile): { penalty: number; violated: string | null } => {
    const t = p.track; const last = sequence[sequence.length - 1]?.track;
    let penalty = 0; let violated: string | null = null;
    if (last && norm(last.artist) && norm(last.artist) === norm(t.artist)) { penalty += 60; violated = '연속 아티스트'; }
    const winArtist = recentArtists.slice(-cfg.artistWindow).filter((a) => a === norm(t.artist)).length;
    if (norm(t.artist) && winArtist >= cfg.maxArtistInWindow) { penalty += 40; violated = violated ?? '아티스트 Window'; }
    if (norm(t.artist) && (artistTotal.get(norm(t.artist)) ?? 0) + 1 > Math.ceil(target * cfg.maxArtistShare)) { penalty += 30; violated = violated ?? '아티스트 점유율'; }
    // 장르/무드 연속
    const tailGenre = sequence.slice(-cfg.maxConsecutiveGenre).every((s) => norm(s.track.main_genre) === norm(t.main_genre) && norm(t.main_genre));
    if (sequence.length >= cfg.maxConsecutiveGenre && tailGenre) { penalty += 25; violated = violated ?? '연속 장르'; }
    const tailMood = sequence.slice(-cfg.maxConsecutiveMood).every((s) => (s.track.mood ?? '') === (t.mood ?? '') && !!t.mood);
    if (sequence.length >= cfg.maxConsecutiveMood && tailMood) { penalty += 20; violated = violated ?? '연속 무드'; }
    // BPM 급변(둘 다 존재할 때만)
    if (isNum(t.bpm) && t.bpm > 0 && isNum(last?.bpm) && last!.bpm! > 0 && Math.abs(t.bpm - last!.bpm!) > cfg.maxBpmJump) { penalty += 15; violated = violated ?? 'BPM 급변'; }
    // 버킷 초과 감점(budget fit)
    const b = bucketOf.get(t.track_id)!; if (bucketActual[b] >= bucketTarget[b]) penalty += 10;
    return { penalty, violated };
  };

  const remaining = () => eligible.filter((p) => !used.has(p.track.track_id));
  for (let pos = 0; pos < target; pos++) {
    const cands = remaining();
    if (cands.length === 0) break;
    const lastBpm = sequence[sequence.length - 1]?.track.bpm ?? null;
    const scored = cands.map((p) => {
      const base = sequencingScore(p, { lastBpm });
      const soft = softPenalty(p);
      return { p, effective: base.score - soft.penalty, base: base.score, soft };
    });
    // 정렬: effective desc → tie-break(fatigue asc → days desc → base desc → id)
    scored.sort((a, z) =>
      z.effective - a.effective
      || a.p.fatigue - z.p.fatigue
      || (z.p.track.days_since_last_play ?? -1) - (a.p.track.days_since_last_play ?? -1)
      || z.base - a.base
      || (a.p.track.track_id < z.p.track.track_id ? -1 : 1));
    const chosen = scored[0];
    // 완화 기록: soft 위반이 있는데도 선택된 경우(후보 부족).
    if (chosen.soft.violated) relaxations.push({ position: pos, constraint: chosen.soft.violated, detail: `${chosen.p.track.title} (완화 · 후보 부족)` });
    const b = bucketOf.get(chosen.p.track.track_id)!;
    sequence.push({ position: pos, track: chosen.p.track, bucket: b, score: chosen.base, fatigue: chosen.p.fatigue,
      reason: `${b} · seq ${chosen.base} · fatigue ${chosen.p.fatigue}${chosen.soft.violated ? ` · 완화(${chosen.soft.violated})` : ''}` });
    used.add(chosen.p.track.track_id);
    bucketActual[b] += 1;
    if (norm(chosen.p.track.artist)) { recentArtists.push(norm(chosen.p.track.artist)); artistTotal.set(norm(chosen.p.track.artist), (artistTotal.get(norm(chosen.p.track.artist)) ?? 0) + 1); }
  }
  return { sequence, excluded, relaxations, bucketActual, bucketTarget };
}

/* ── Simulation (실측 집계만; 효과 예측 금지) ────────────────────────── */
export interface RotationSimulation {
  trackCount: number; durationMinutes: number | null;
  artistCount: number; genreCount: number; moodCount: number;
  avgCompatibility: number | null; avgCompletion: number | null; avgSkipRisk: number | null; avgFatigue: number;
  maxArtistShare: number; maxGenreShare: number;
  consecutiveArtistViolations: number; consecutiveGenreViolations: number;
  avgBpmDelta: number | null; nullMetadataRate: number; relaxationCount: number;
  bucketActual: Record<Bucket, number>;
}
export function simulateSequence(res: SequenceResult): RotationSimulation {
  const seq = res.sequence; const n = seq.length;
  const empty: RotationSimulation = {
    trackCount: 0, durationMinutes: null, artistCount: 0, genreCount: 0, moodCount: 0,
    avgCompatibility: null, avgCompletion: null, avgSkipRisk: null, avgFatigue: 0,
    maxArtistShare: 0, maxGenreShare: 0, consecutiveArtistViolations: 0, consecutiveGenreViolations: 0,
    avgBpmDelta: null, nullMetadataRate: 0, relaxationCount: res.relaxations.length, bucketActual: res.bucketActual,
  };
  if (n === 0) return empty;
  const arts = seq.map((s) => norm(s.track.artist)).filter(Boolean);
  const gens = seq.map((s) => norm(s.track.main_genre)).filter(Boolean);
  const moods = seq.map((s) => (s.track.mood ?? '').trim()).filter(Boolean);
  const share = (arr: string[]) => { const m = new Map<string, number>(); for (const a of arr) m.set(a, (m.get(a) ?? 0) + 1); return arr.length ? Math.max(...m.values()) / n : 0; };
  const dur = seq.reduce((s, x) => s + (isNum(x.track.duration) ? x.track.duration : 0), 0);
  const comps = seq.map((s) => clampPct(s.track.completion_rate)).filter(isNum) as number[];
  const skips = seq.map((s) => clampPct(s.track.skip_rate)).filter(isNum) as number[];
  const compat = seq.map((s) => s.track.compatibility).filter(isNum) as number[];
  let consecA = 0, consecG = 0, nullMeta = 0;
  const bpmDeltas: number[] = [];
  for (let i = 0; i < n; i++) {
    if (i > 0 && norm(seq[i].track.artist) && norm(seq[i].track.artist) === norm(seq[i - 1].track.artist)) consecA++;
    if (i > 0 && norm(seq[i].track.main_genre) && norm(seq[i].track.main_genre) === norm(seq[i - 1].track.main_genre)) consecG++;
    if (i > 0 && isNum(seq[i].track.bpm) && isNum(seq[i - 1].track.bpm)) bpmDeltas.push(Math.abs((seq[i].track.bpm as number) - (seq[i - 1].track.bpm as number)));
    if (!seq[i].track.main_genre || !seq[i].track.mood) nullMeta++;
  }
  const avg = (a: number[]) => (a.length ? Math.round((a.reduce((s, x) => s + x, 0) / a.length) * 10) / 10 : null);
  return {
    trackCount: n, durationMinutes: dur > 0 ? Math.round(dur / 60) : null,
    artistCount: new Set(arts).size, genreCount: new Set(gens).size, moodCount: new Set(moods).size,
    avgCompatibility: avg(compat), avgCompletion: avg(comps), avgSkipRisk: avg(skips),
    avgFatigue: Math.round(seq.reduce((s, x) => s + x.fatigue, 0) / n),
    maxArtistShare: Math.round(share(arts) * 1000) / 10, maxGenreShare: Math.round(share(gens) * 1000) / 10,
    consecutiveArtistViolations: consecA, consecutiveGenreViolations: consecG,
    avgBpmDelta: avg(bpmDeltas), nullMetadataRate: Math.round((nullMeta / n) * 1000) / 10, relaxationCount: res.relaxations.length,
    bucketActual: res.bucketActual,
  };
}

/* ── Comparison (기존 순서 vs Rotation Draft; Simulation 만) ──────────── */
export interface SequenceComparison {
  metric: string; existing: number | null; rotation: number | null; better: 'existing' | 'rotation' | 'tie' | 'na';
}
export function compareSequences(existing: RotationSimulation, rotation: RotationSimulation): SequenceComparison[] {
  const cmp = (metric: string, e: number | null, r: number | null, higherBetter: boolean): SequenceComparison => {
    if (e == null || r == null) return { metric, existing: e, rotation: r, better: 'na' };
    if (e === r) return { metric, existing: e, rotation: r, better: 'tie' };
    const rotationBetter = higherBetter ? r > e : r < e;
    return { metric, existing: e, rotation: r, better: rotationBetter ? 'rotation' : 'existing' };
  };
  return [
    cmp('아티스트 다양성', existing.artistCount, rotation.artistCount, true),
    cmp('장르 다양성', existing.genreCount, rotation.genreCount, true),
    cmp('무드 다양성', existing.moodCount, rotation.moodCount, true),
    cmp('평균 Fatigue', existing.avgFatigue, rotation.avgFatigue, false),
    cmp('아티스트 최대 점유율', existing.maxArtistShare, rotation.maxArtistShare, false),
    cmp('연속 아티스트 위반', existing.consecutiveArtistViolations, rotation.consecutiveArtistViolations, false),
    cmp('연속 장르 위반', existing.consecutiveGenreViolations, rotation.consecutiveGenreViolations, false),
    cmp('Null 메타 비율', existing.nullMetadataRate, rotation.nullMetadataRate, false),
  ];
}

/* ── Support Matrix ──────────────────────────────────────────────────── */
export interface SupportItem { key: string; label: string; supported: boolean; note: string }
export const SUPPORT_MATRIX: SupportItem[] = [
  { key: 'track_history', label: 'Track History', supported: true, note: 'playback_events_v2' },
  { key: 'playlist_history', label: 'Playlist History', supported: true, note: 'playback_events_v2.playlist_id' },
  { key: 'store_type_history', label: 'Store Type History', supported: true, note: 'store_type_slug' },
  { key: 'store_history', label: '개별 Store History', supported: false, note: 'store_id 미기록' },
  { key: 'artist', label: 'Artist', supported: true, note: 'tracks.artist' },
  { key: 'genre', label: 'Genre', supported: true, note: 'tracks.main_genre' },
  { key: 'mood', label: 'Mood', supported: true, note: 'tracks.mood' },
  { key: 'bpm', label: 'BPM', supported: true, note: '있을 때만(다수 null → 신호 제외)' },
  { key: 'key', label: 'Key(음정)', supported: false, note: '컬럼 부재' },
  { key: 'vocal', label: 'Vocal 여부', supported: false, note: '컬럼 부재' },
  { key: 'explicit', label: 'Explicit', supported: false, note: '컬럼 부재' },
  { key: 'energy', label: 'Energy', supported: false, note: '컬럼 부재 — BPM/Mood proxy 를 Energy 로 단정 금지' },
  { key: 'weather', label: 'Weather', supported: false, note: '데이터 없음' },
  { key: 'event', label: 'Event', supported: false, note: '데이터 없음' },
  { key: 'daypart', label: 'Daypart', supported: true, note: 'created_at 시간대' },
];

/* ── Learning 집계 헬퍼 ──────────────────────────────────────────────── */
export interface RotationDraftLike { status: string }
export function aggregateRotationLearning(drafts: RotationDraftLike[]): { approved: number; rejected: number; total: number; approvalRate: number | null } {
  let approved = 0, rejected = 0;
  for (const d of drafts) { if (d.status === 'approved') approved++; else if (d.status === 'rejected') rejected++; }
  const decided = approved + rejected;
  return { approved, rejected, total: drafts.length, approvalRate: decided > 0 ? Math.round((approved / decided) * 1000) / 10 : null };
}

/* ── 표시 헬퍼 ────────────────────────────────────────────────────── */
export const BUCKET_LABEL: Record<Bucket, string> = { core_verified: 'Core 검증', recent_winner: 'Recent Winner', new_test: 'New/Test', rediscovery: '재발견', surprise: 'Surprise' };
export const STATUS_LABEL: Record<string, string> = { draft: '초안', simulated: '시뮬레이션', approved: '승인', rejected: '반려', archived: '보관' };
export const STATUS_TONE: Record<string, 'neutral' | 'info' | 'success' | 'warning'> = { draft: 'neutral', simulated: 'info', approved: 'success', rejected: 'warning', archived: 'neutral' };
