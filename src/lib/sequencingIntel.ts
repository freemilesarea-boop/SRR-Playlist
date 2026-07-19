/**
 * sequencingIntel — Sequencing Intelligence & Transition Planning
 * (Phase AI-PLAYLIST-INTEL-2).
 *
 * Phase 1(0565) Playlist Draft 의 **선택된 Track 집합을 그대로 유지한 채 순서만**
 * 설계하는 순수 결정론 엔진이다. 실제 playlist_tracks(order_index)/Queue/Scheduler/
 * Player 는 일절 변경하지 않으며, 결과는 Sequence Draft(0566) 저장 + 사람 검토에서
 * 종료한다. 서버(_ai_pl_seq_quality)가 Track Set 불변·Hard Gate·품질을 재검증한다.
 *
 * 원칙: Math.random/시간 Seed/외부 LLM 금지(동일 입력+Seed → 동일 순서) ·
 * Track 추가/제거 금지(순열만) · 결측 Energy/BPM/Vocal 보간 금지(감점 대신
 * Metadata Completeness 분리) · Key/Camelot 데이터 부재 → Harmonic 평가
 * not_available · Hard 충돌 시 sequence_generation_failed 반환(완화 금지).
 *
 * 재사용: playlistIntelCore.seededTieBreak(결정론 tie-break). 피로도는 서버
 * (_ai_pl_seq_quality)와 동일하게 events 기반 min(100, events/80×100) 로 계산한다
 * (playlistGenerator.fatigueScore 의 recency 항은 서버 집계에 없어 정합성 우선).
 */

import { seededTieBreak } from './playlistIntelCore';

/* ── Domain 타입 ─────────────────────────────────────────────────────── */
export type SequenceStrategy =
  | 'balanced' | 'smooth' | 'energy_rise' | 'energy_fall' | 'steady' | 'daypart' | 'manual_assist';
export type SequenceDraftStatus =
  | 'draft' | 'ready_for_review' | 'approved' | 'rejected' | 'expired' | 'archived';
export type TransitionSeverity = 'hard' | 'soft' | 'advisory';
export type TransitionIssueCode =
  | 'same_artist_adjacent' | 'same_album_adjacent' | 'artist_repetition_window'
  | 'genre_cluster' | 'mood_jump' | 'energy_jump' | 'bpm_jump'
  | 'vocal_cluster' | 'instrumental_cluster' | 'fatigue_risk'
  | 'missing_energy' | 'missing_bpm' | 'missing_vocal' | 'missing_genre'
  | 'insufficient_data';

export interface SequenceReason { code: string; message: string; scoreImpact: number; source: string }

export interface SequencingTrackFeature {
  trackId: string;
  title: string | null;
  artistKey: string | null;
  albumKey: string | null;
  genre: string | null;
  moods: string[];
  bpm: number | null;
  energy: number | null;
  vocalPresence: number | null;
  isInstrumental: boolean | null;
  fitScore: number | null;
  fatigueScore: number | null;
  events: number;
  originalDraftOrder: number;
  missing: string[];
}

export interface TransitionEvaluation {
  fromTrackId: string | null;
  toTrackId: string;
  energyDelta: number | null;
  bpmDelta: number | null;
  sameArtist: boolean;
  sameAlbum: boolean;
  sameGenre: boolean;
  vocalTransition: string;
  transitionScore: number;
  penalties: SequenceReason[];
  rewards: SequenceReason[];
}

export interface SequenceQualityBreakdown {
  hardConstraintCompliance: number;
  artistSpacing: number;
  albumSpacing: number;
  genreFlow: number;
  moodFlow: number;
  energyFlow: number | null;
  bpmFlow: number | null;
  vocalFlow: number | null;
  fatigueControl: number;
  metadataCompleteness: number;
  overallScore: number | null;
}

export interface SequenceQualityResult {
  score: number | null;
  grade: 'A' | 'B' | 'C' | 'D' | 'insufficient_data';
  breakdown: SequenceQualityBreakdown;
  transitionCount: number;
  averageTransitionScore: number | null;
  worstTransitionScore: number | null;
  transitionScoreVariance: number | null;
  hardViolations: string[];
  softViolations: string[];
  warnings: string[];
  insufficientData: string[];
  generatedAt: string;
  algorithmVersion: string;
}

export interface SequencingConfig {
  strategy: SequenceStrategy;
  seed: number;
  daypart: string | null;
  maxEnergyDelta: number;
  maxBpmDelta: number;
  artistMinGap: number;
  albumMinGap: number;
  maxGenreRun: number;
  maxMoodRun: number;
  maxVocalRun: number;
  maxInstrumentalRun: number;
  startTrackId: string | null;
  endTrackId: string | null;
  pinnedPositions: Record<string, number>;
}

export const DEFAULT_SEQ_CONFIG: SequencingConfig = {
  strategy: 'balanced', seed: 1, daypart: null,
  maxEnergyDelta: 0.25, maxBpmDelta: 30,
  artistMinGap: 2, albumMinGap: 2,
  maxGenreRun: 3, maxMoodRun: 3, maxVocalRun: 3, maxInstrumentalRun: 5,
  startTrackId: null, endTrackId: null, pinnedPositions: {},
};

export const SEQ_ALGORITHM_VERSION = 'pl-seq-v1';
export const FIXED_SEQUENCE_WARNING = '이 Sequence Draft는 실제 Playlist, Queue, Scheduler 또는 Player에 자동 반영되지 않습니다.';
/** Key/Camelot 데이터가 저장소에 존재하지 않아(항상 null) Harmonic 평가는 제외. */
export const HARMONIC_TRANSITION_STATUS = 'not_available';

export const SEQUENCE_LIMITS = { maxTracks: 200, maxSwapIterations: 300 } as const;

/** Transition Edge 가중치(존재 신호만 재정규화, 결측은 completeness 로 분리). */
export const TRANSITION_WEIGHTS = {
  energyTransition: 25, bpmTransition: 15, artistSpacing: 15, genreFlow: 10,
  moodFlow: 10, vocalFlow: 10, albumSpacing: 5, fatigueControl: 5, metadataCompleteness: 5,
} as const;

/** Sequence Quality 가중치 — 서버 _ai_pl_seq_quality 와 동일 상수. */
export const SEQ_QUALITY_WEIGHTS = {
  hardConstraintCompliance: 20, artistSpacing: 15, energyFlow: 15, genreFlow: 10,
  bpmFlow: 10, vocalFlow: 10, albumSpacing: 5, moodFlow: 5, fatigueControl: 5, metadataCompleteness: 5,
} as const;

/** 금지 액션 — 스펙 금지 기능과 1:1. */
export const BLOCKED_SEQUENCE_ACTIONS = [
  'apply_playlist_position',
  'update_playlist_tracks',
  'apply_to_queue',
  'apply_to_player',
  'apply_to_scheduler',
  'publish_sequence',
  'auto_approve',
  'auto_global_apply',
] as const;
export function isBlockedSequenceAction(action: string): boolean {
  return (BLOCKED_SEQUENCE_ACTIONS as readonly string[]).includes(action) || action.startsWith('automatic_');
}

const isNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();
const round1 = (n: number) => Math.round(n * 10) / 10;
const clamp100 = (n: number) => Math.max(0, Math.min(100, n));
const HIGH_FATIGUE = 60;

/* ── 입력 정규화(admin_ai_pl_seq_input 행) ───────────────────────────── */
export interface SeqInputRow {
  track_id: string; original_draft_order: number;
  title: string | null; artist: string | null; album_name: string | null;
  main_genre: string | null; mood: string | null; instrumental: boolean | null;
  energy: number | null; vocal_presence: number | null; bpm: number | null;
  fit_score: number | null; events: number | null;
}

export function normalizeSequenceTrack(row: SeqInputRow): SequencingTrackFeature {
  const missing: string[] = [];
  if (!isNum(row.energy)) missing.push('missing_energy');
  if (!isNum(row.bpm)) missing.push('missing_bpm');
  if (row.instrumental == null && !isNum(row.vocal_presence)) missing.push('missing_vocal');
  if (!row.main_genre) missing.push('missing_genre');
  const events = isNum(row.events) ? row.events : 0;
  return {
    trackId: row.track_id,
    title: row.title,
    artistKey: norm(row.artist) || null,
    albumKey: norm(row.album_name) || null,
    genre: row.main_genre,
    moods: row.mood ? [row.mood.trim()] : [],
    bpm: isNum(row.bpm) ? row.bpm : null,
    energy: isNum(row.energy) ? row.energy : null,
    vocalPresence: isNum(row.vocal_presence) ? row.vocal_presence : null,
    isInstrumental: typeof row.instrumental === 'boolean' ? row.instrumental : null,
    fitScore: isNum(row.fit_score) ? row.fit_score : null,
    // 서버(_ai_pl_seq_quality)와 동일: events 기반 피로도(임의 recency 추정 없음).
    fatigueScore: Math.min(100, (events / 80) * 100),
    events,
    originalDraftOrder: row.original_draft_order,
    missing,
  };
}

/** Vocal 판정(서버와 동일): instrumental 명시 우선, 없으면 vocal_presence≥0.5, 둘 다 없으면 unknown. */
export function vocalState(t: SequencingTrackFeature): boolean | null {
  if (t.isInstrumental === true) return false;
  if (t.isInstrumental === false) return true;
  if (t.vocalPresence != null) return t.vocalPresence >= 0.5;
  return null;
}

/* ── Transition 평가(Edge Score) ─────────────────────────────────────── */
export function evaluateTransition(
  from: SequencingTrackFeature | null, to: SequencingTrackFeature, cfg: SequencingConfig,
): TransitionEvaluation {
  const penalties: SequenceReason[] = [];
  const rewards: SequenceReason[] = [];
  if (!from) {
    return {
      fromTrackId: null, toTrackId: to.trackId, energyDelta: null, bpmDelta: null,
      sameArtist: false, sameAlbum: false, sameGenre: false, vocalTransition: 'start',
      transitionScore: 100, penalties, rewards: [{ code: 'start', message: '시작 곡', scoreImpact: 0, source: 'sequence' }],
    };
  }
  const energyDelta = from.energy != null && to.energy != null ? Math.abs(to.energy - from.energy) : null;
  const bpmDelta = from.bpm != null && to.bpm != null ? Math.abs(to.bpm - from.bpm) : null;
  const sameArtist = !!from.artistKey && from.artistKey === to.artistKey;
  const sameAlbum = !!from.albumKey && from.albumKey === to.albumKey;
  const sameGenre = !!from.genre && norm(from.genre) === norm(to.genre);
  const vFrom = vocalState(from);
  const vTo = vocalState(to);
  const vocalTransition = vFrom == null || vTo == null ? 'unknown'
    : `${vFrom ? 'vocal' : 'instrumental'}→${vTo ? 'vocal' : 'instrumental'}`;

  const parts: Array<{ v: number; w: number }> = [];
  let present = 0;
  const total = 6;
  if (energyDelta != null) {
    present++;
    const v = (1 - Math.min(1, energyDelta / 0.5)) * 100;
    parts.push({ v, w: TRANSITION_WEIGHTS.energyTransition });
    if (energyDelta > cfg.maxEnergyDelta) penalties.push({ code: 'energy_jump', message: `Energy Δ${round1(energyDelta * 100) / 100} > ${cfg.maxEnergyDelta}`, scoreImpact: -15, source: 'transition' });
  } else penalties.push({ code: 'missing_energy', message: 'Energy 결측 — 평가 제외', scoreImpact: 0, source: 'metadata' });
  if (bpmDelta != null) {
    present++;
    // Half/Double-Time 자동 추론 금지 — 단순 절대 Delta 평가.
    const v = (1 - Math.min(1, bpmDelta / 60)) * 100;
    parts.push({ v, w: TRANSITION_WEIGHTS.bpmTransition });
    if (bpmDelta > cfg.maxBpmDelta) penalties.push({ code: 'bpm_jump', message: `BPM Δ${round1(bpmDelta)} > ${cfg.maxBpmDelta}`, scoreImpact: -10, source: 'transition' });
  } else penalties.push({ code: 'missing_bpm', message: 'BPM 결측 — 평가 제외', scoreImpact: 0, source: 'metadata' });
  if (from.artistKey || to.artistKey) {
    present++;
    parts.push({ v: sameArtist ? 0 : 100, w: TRANSITION_WEIGHTS.artistSpacing });
    if (sameArtist) penalties.push({ code: 'same_artist_adjacent', message: `동일 아티스트 인접(${to.artistKey})`, scoreImpact: -30, source: 'transition' });
  }
  if (from.genre || to.genre) {
    present++;
    parts.push({ v: sameGenre ? 60 : 100, w: TRANSITION_WEIGHTS.genreFlow });
  } else penalties.push({ code: 'missing_genre', message: '장르 결측', scoreImpact: 0, source: 'metadata' });
  const moodOverlap = from.moods.some((m) => to.moods.includes(m));
  if (from.moods.length || to.moods.length) {
    present++;
    parts.push({ v: moodOverlap ? 100 : 60, w: TRANSITION_WEIGHTS.moodFlow });
  }
  if (vocalTransition !== 'unknown') {
    present++;
    const same = vFrom === vTo;
    parts.push({ v: same ? 70 : 100, w: TRANSITION_WEIGHTS.vocalFlow });
  } else penalties.push({ code: 'missing_vocal', message: 'Vocal 정보 결측', scoreImpact: 0, source: 'metadata' });
  if (sameAlbum) {
    parts.push({ v: 0, w: TRANSITION_WEIGHTS.albumSpacing });
    penalties.push({ code: 'same_album_adjacent', message: `동일 앨범 인접(${to.albumKey})`, scoreImpact: -20, source: 'transition' });
  } else if (from.albumKey || to.albumKey) {
    parts.push({ v: 100, w: TRANSITION_WEIGHTS.albumSpacing });
  }
  const bothTired = from.fatigueScore != null && to.fatigueScore != null
    && from.fatigueScore >= HIGH_FATIGUE && to.fatigueScore >= HIGH_FATIGUE;
  parts.push({ v: bothTired ? 0 : 100, w: TRANSITION_WEIGHTS.fatigueControl });
  if (bothTired) penalties.push({ code: 'fatigue_risk', message: '고피로 Track 인접', scoreImpact: -15, source: 'transition' });
  parts.push({ v: (present / total) * 100, w: TRANSITION_WEIGHTS.metadataCompleteness });

  const wsum = parts.reduce((s, p) => s + p.w, 0);
  // penalty scoreImpact(전환 유래)를 실제 점수에 반영 — Local Swap 도 동일 기준을 본다.
  const penaltySum = penalties.filter((p) => p.source === 'transition').reduce((s, p) => s + p.scoreImpact, 0);
  const score = clamp100(round1(parts.reduce((s, p) => s + p.v * p.w, 0) / wsum + penaltySum));
  return { fromTrackId: from.trackId, toTrackId: to.trackId, energyDelta, bpmDelta, sameArtist, sameAlbum, sameGenre, vocalTransition, transitionScore: score, penalties, rewards };
}

/* ── Energy Curve Planner — 실측값만 재배열(보간/생성 금지) ─────────────── */
export function buildTargetCurve(strategy: SequenceStrategy, n: number, energies: number[]): {
  target: number[] | null; notes: string[];
} {
  const notes: string[] = [];
  const avail = [...energies].sort((a, b) => a - b);
  if (strategy === 'daypart') {
    notes.push('predicted_dayparts 데이터가 없어 Daypart 목표 Curve는 insufficient_data — balanced 기준으로 평가합니다.');
    return { target: null, notes };
  }
  if (strategy === 'manual_assist' || strategy === 'balanced' || strategy === 'smooth') return { target: null, notes };
  if (avail.length < 2) { notes.push('Energy 실측값이 2개 미만이라 목표 Curve를 만들지 않습니다.'); return { target: null, notes }; }
  const at = (q: number) => avail[Math.min(avail.length - 1, Math.max(0, Math.round(q * (avail.length - 1))))];
  const target: number[] = [];
  for (let i = 0; i < n; i++) {
    const q = n === 1 ? 0.5 : i / (n - 1);
    if (strategy === 'energy_rise') target.push(at(q));
    else if (strategy === 'energy_fall') target.push(at(1 - q));
    else target.push(at(0.5)); // steady — 중앙값 근처 유지.
  }
  return { target, notes };
}

/* ── 결정론적 Sequencing ─────────────────────────────────────────────── */
export interface RelaxationNote { constraint: string; from: string; to: string; note: string }
export interface SequenceFailure {
  ok: false;
  failure: 'sequence_generation_failed';
  reasons: string[]; // 'hard_constraint_conflict' | 'manual_review_required' | detail
}
export interface SequenceSuccess {
  ok: true;
  ordered: SequencingTrackFeature[];
  transitions: TransitionEvaluation[];
  targetCurve: number[] | null;
  relaxations: RelaxationNote[];
  notes: string[];
  swapIterations: number;
}
export type SequenceResult = SequenceSuccess | SequenceFailure;

function fail(...reasons: string[]): SequenceFailure {
  return { ok: false, failure: 'sequence_generation_failed', reasons: ['hard_constraint_conflict', 'manual_review_required', ...reasons] };
}

export function generateSequence(tracks: SequencingTrackFeature[], cfg: SequencingConfig): SequenceResult {
  const n = tracks.length;
  const notes: string[] = [];
  const relaxations: RelaxationNote[] = [];
  if (n < 2) return fail(`tracks_too_few(${n})`);
  if (n > SEQUENCE_LIMITS.maxTracks) return fail(`tracks_over_limit(${n}>${SEQUENCE_LIMITS.maxTracks})`);
  const ids = new Set(tracks.map((t) => t.trackId));
  if (ids.size !== n) return fail('duplicate_track');

  // 고정 Position/Start/End 무결성 — 충돌 시 저장 차단(Hard, 완화 금지).
  const pins = new Map<number, string>();
  for (const [tid, pos] of Object.entries(cfg.pinnedPositions)) {
    if (!ids.has(tid)) return fail(`pinned_track_not_in_draft(${tid})`);
    if (!Number.isInteger(pos) || pos < 0 || pos >= n) return fail(`pinned_position_out_of_range(${pos})`);
    if (pins.has(pos) && pins.get(pos) !== tid) return fail(`pinned_position_conflict(${pos})`);
    pins.set(pos, tid);
  }
  const pinConflict = (tid: string | null, pos: number) =>
    tid != null && pins.has(pos) && pins.get(pos) !== tid;
  if (cfg.startTrackId) {
    if (!ids.has(cfg.startTrackId)) return fail('start_track_not_in_draft');
    if (pinConflict(cfg.startTrackId, 0)) return fail('start_track_pin_conflict');
    pins.set(0, cfg.startTrackId);
  }
  if (cfg.endTrackId) {
    if (!ids.has(cfg.endTrackId)) return fail('end_track_not_in_draft');
    if (cfg.endTrackId === cfg.startTrackId) return fail('start_end_same_track');
    if (pinConflict(cfg.endTrackId, n - 1)) return fail('end_track_pin_conflict');
    pins.set(n - 1, cfg.endTrackId);
  }
  const pinnedIds = new Set(pins.values());
  if (pinnedIds.size !== pins.size) return fail('pinned_track_duplicated');

  const byId = new Map(tracks.map((t) => [t.trackId, t]));
  const energies = tracks.map((t) => t.energy).filter(isNum);
  const { target, notes: curveNotes } = buildTargetCurve(cfg.strategy, n, energies);
  notes.push(...curveNotes);

  const bpmMissingRatio = tracks.filter((t) => t.bpm == null).length / n;
  if (bpmMissingRatio > 0.5) {
    relaxations.push({
      constraint: 'bpm_transition_weight', from: String(TRANSITION_WEIGHTS.bpmTransition), to: '5',
      note: `후보 BPM 데이터 누락률(${Math.round(bpmMissingRatio * 100)}%)이 높아 BPM Transition 가중치를 ${TRANSITION_WEIGHTS.bpmTransition}에서 5로 낮췄습니다.`,
    });
  }

  const runPass = (artistGap: number): { order: SequencingTrackFeature[]; gapViolations: number } => {
    const order: Array<SequencingTrackFeature | null> = Array.from({ length: n }, () => null);
    const used = new Set<string>();
    for (const [pos, tid] of pins) { order[pos] = byId.get(tid) ?? null; used.add(tid); }
    let gapViolations = 0;
    const lastArtistPos = new Map<string, number>();
    const lastAlbumPos = new Map<string, number>();
    // 잔여 그룹 크기(실현가능성 가드용) — 큰 그룹을 미루면 말미에 인접이 강제되는
    // greedy 코너 케이스를 방지한다.
    const artistRemaining = new Map<string, number>();
    const albumRemaining = new Map<string, number>();
    for (const t of tracks) {
      if (t.artistKey) artistRemaining.set(t.artistKey, (artistRemaining.get(t.artistKey) ?? 0) + 1);
      if (t.albumKey) albumRemaining.set(t.albumKey, (albumRemaining.get(t.albumKey) ?? 0) + 1);
    }
    const maxGroup = (m: Map<string, number>): { key: string | null; count: number } => {
      let key: string | null = null; let count = 0;
      for (const [k, c] of m) if (c > count) { key = k; count = c; }
      return { key, count };
    };
    const consume = (t: SequencingTrackFeature) => {
      if (t.artistKey) {
        const c = (artistRemaining.get(t.artistKey) ?? 1) - 1;
        if (c <= 0) artistRemaining.delete(t.artistKey); else artistRemaining.set(t.artistKey, c);
      }
      if (t.albumKey) {
        const c = (albumRemaining.get(t.albumKey) ?? 1) - 1;
        if (c <= 0) albumRemaining.delete(t.albumKey); else albumRemaining.set(t.albumKey, c);
      }
    };
    let genreRun = 0; let moodRun = 0; let vocalRun = 0; let instRun = 0;
    const prevRef: { current: SequencingTrackFeature | null } = { current: null };
    let prevGenre = ''; let prevMood = ''; let prevVocal: boolean | null = null;

    const stepState = (t: SequencingTrackFeature, pos: number) => {
      if (t.artistKey) lastArtistPos.set(t.artistKey, pos);
      if (t.albumKey) lastAlbumPos.set(t.albumKey, pos);
      const g = norm(t.genre);
      genreRun = g && g === prevGenre ? genreRun + 1 : 1;
      const m = t.moods[0] ?? '';
      moodRun = m && m === prevMood ? moodRun + 1 : 1;
      const v = vocalState(t);
      vocalRun = v === true && prevVocal === true ? vocalRun + 1 : v === true ? 1 : 0;
      instRun = v === false && prevVocal === false ? instRun + 1 : v === false ? 1 : 0;
      prevGenre = g; prevMood = m; prevVocal = v; prevRef.current = t;
    };

    for (let pos = 0; pos < n; pos++) {
      const pinned = order[pos];
      if (pinned) {
        if (prevRef.current && pinned.artistKey && prevRef.current.artistKey === pinned.artistKey) gapViolations++;
        consume(pinned);
        stepState(pinned, pos);
        continue;
      }
      const slotsLeft = n - pos;
      const maxArtist = maxGroup(artistRemaining);
      const maxAlbum = maxGroup(albumRemaining);
      const prevArtist = prevRef.current ? prevRef.current.artistKey : null;
      const prevAlbum = prevRef.current ? prevRef.current.albumKey : null;
      let best: SequencingTrackFeature | null = null;
      let bestScore = -Infinity;
      for (const t of tracks) {
        if (used.has(t.trackId)) continue;
        const ev = evaluateTransition(prevRef.current, t, cfg);
        let score = ev.transitionScore;
        const aPos = t.artistKey ? lastArtistPos.get(t.artistKey) : undefined;
        if (aPos != null && pos - aPos < artistGap) score -= 80;
        const alPos = t.albumKey ? lastAlbumPos.get(t.albumKey) : undefined;
        if (alPos != null && pos - alPos < cfg.albumMinGap) score -= 40;
        const g = norm(t.genre);
        if (g && g === prevGenre && genreRun >= cfg.maxGenreRun) score -= 60;
        const m = t.moods[0] ?? '';
        if (m && m === prevMood && moodRun >= cfg.maxMoodRun) score -= 30;
        const v = vocalState(t);
        if (v === true && vocalRun >= cfg.maxVocalRun) score -= 40;
        if (v === false && instRun >= cfg.maxInstrumentalRun) score -= 30;
        if (target && t.energy != null) score += (1 - Math.min(1, Math.abs(t.energy - target[pos]) / 0.5)) * 30;
        if ((prevRef.current?.fatigueScore ?? 0) >= HIGH_FATIGUE
          && (t.fatigueScore ?? 0) >= HIGH_FATIGUE) score -= 30; // 고피로 인접 억제
        // 실현가능성 가드: 최대 그룹을 지금 소비하지 않으면 말미 인접이 강제되는 경우.
        if (maxArtist.key && maxArtist.count > Math.ceil((slotsLeft - 1) / 2)
          && t.artistKey !== maxArtist.key && prevArtist !== maxArtist.key) score -= 500;
        if (maxAlbum.key && maxAlbum.count > Math.ceil((slotsLeft - 1) / 2)
          && t.albumKey !== maxAlbum.key && prevAlbum !== maxAlbum.key) score -= 500;
        if (pos < Math.ceil(n / 4) && (t.fatigueScore ?? 0) >= HIGH_FATIGUE) score -= 10; // 고노출 초반 집중 방지
        score += seededTieBreak(t.trackId, cfg.seed) * 0.001; // 결정론적 tie-break
        if (score > bestScore) { bestScore = score; best = t; }
      }
      if (!best) break;
      if (prevRef.current !== null) {
        if (best.artistKey && prevRef.current.artistKey === best.artistKey) gapViolations++;
      }
      order[pos] = best;
      used.add(best.trackId);
      consume(best);
      stepState(best, pos);
    }
    return { order: order.filter((t): t is SequencingTrackFeature => t != null), gapViolations };
  };

  let artistGap = Math.max(1, cfg.artistMinGap);
  let pass = runPass(artistGap);
  while (pass.gapViolations > 0 && artistGap > 1) {
    const next = artistGap - 1;
    relaxations.push({
      constraint: 'artist_min_gap', from: String(artistGap), to: String(next),
      note: `동일 아티스트 최소 간격 ${artistGap}곡을 만족할 수 없어 ${next}곡으로 완화했습니다. Hard Constraint(Track Set/고정 Position)는 완화하지 않습니다.`,
    });
    artistGap = next;
    pass = runPass(artistGap);
  }
  let order = pass.order;
  if (order.length !== n || new Set(order.map((t) => t.trackId)).size !== n) {
    return fail('permutation_integrity_failed');
  }

  // Local Swap Optimization — 인접 스왑, 고정 위치 제외, 반복 상한(결정론).
  const pinnedPos = new Set(pins.keys());
  const localScore = (arr: SequencingTrackFeature[], i: number): number => {
    let s = 0;
    if (i > 0) s += evaluateTransition(arr[i - 1], arr[i], cfg).transitionScore;
    if (i + 1 < arr.length) s += evaluateTransition(arr[i], arr[i + 1], cfg).transitionScore;
    return s;
  };
  let iterations = 0;
  let improved = true;
  while (improved && iterations < SEQUENCE_LIMITS.maxSwapIterations) {
    improved = false;
    for (let i = 0; i + 1 < n && iterations < SEQUENCE_LIMITS.maxSwapIterations; i++) {
      if (pinnedPos.has(i) || pinnedPos.has(i + 1)) continue;
      iterations++;
      const adjCount = (arr: SequencingTrackFeature[]): number => {
        let c = 0;
        for (let k = Math.max(1, i - 1); k <= Math.min(n - 1, i + 2); k++) {
          const a = arr[k - 1]; const b = arr[k];
          if (a.artistKey && a.artistKey === b.artistKey) c++;
          if (a.albumKey && a.albumKey === b.albumKey) c++;
        }
        return c;
      };
      const before = localScore(order, i) + localScore(order, i + 1);
      const swapped = [...order];
      [swapped[i], swapped[i + 1]] = [swapped[i + 1], swapped[i]];
      const after = localScore(swapped, i) + localScore(swapped, i + 1);
      // 인접(아티스트/앨범) 위반을 늘리는 스왑은 점수가 좋아도 금지.
      if (after > before && adjCount(swapped) <= adjCount(order)) { order = swapped; improved = true; }
    }
  }

  const transitions: TransitionEvaluation[] = order.map((t, i) => evaluateTransition(i === 0 ? null : order[i - 1], t, cfg));
  return { ok: true, ordered: order, transitions, targetCurve: target, relaxations, notes, swapIterations: iterations };
}

/* ── 순서 통계(품질/비교 공용) ────────────────────────────────────────── */
export interface OrderStats {
  adjacentSameArtist: number;
  adjacentSameAlbum: number;
  adjacentSameGenre: number;
  maxGenreRun: number;
  maxMoodRun: number;
  maxVocalRun: number;
  avgEnergyDelta: number | null;
  maxEnergyDelta: number | null;
  avgBpmDelta: number | null;
  maxBpmDelta: number | null;
  energyMissing: number;
  bpmMissing: number;
  vocalMissing: number;
  highFatigueAdjacent: number;
}

export function computeOrderStats(order: SequencingTrackFeature[]): OrderStats {
  const n = order.length;
  let adjArtist = 0; let adjAlbum = 0; let adjGenre = 0; let fatigueAdj = 0;
  let genreRun = 0; let maxGenreRun = 0; let moodRun = 0; let maxMoodRun = 0; let vocalRun = 0; let maxVocalRun = 0;
  const eDeltas: number[] = []; const bDeltas: number[] = [];
  let prevGenre = ''; let prevMood = ''; let prevVocal: boolean | null = null;
  for (let i = 0; i < n; i++) {
    const t = order[i];
    const g = norm(t.genre); const m = t.moods[0] ?? ''; const v = vocalState(t);
    genreRun = g && g === prevGenre ? genreRun + 1 : g ? 1 : 0;
    moodRun = m && m === prevMood ? moodRun + 1 : m ? 1 : 0;
    vocalRun = v === true && prevVocal === true ? vocalRun + 1 : v === true ? 1 : 0;
    maxGenreRun = Math.max(maxGenreRun, genreRun);
    maxMoodRun = Math.max(maxMoodRun, moodRun);
    maxVocalRun = Math.max(maxVocalRun, vocalRun);
    if (i > 0) {
      const p = order[i - 1];
      if (t.artistKey && t.artistKey === p.artistKey) adjArtist++;
      if (t.albumKey && t.albumKey === p.albumKey) adjAlbum++;
      if (g && g === norm(p.genre)) adjGenre++;
      if (t.energy != null && p.energy != null) eDeltas.push(Math.abs(t.energy - p.energy));
      if (t.bpm != null && p.bpm != null) bDeltas.push(Math.abs(t.bpm - p.bpm));
      if ((t.fatigueScore ?? 0) >= HIGH_FATIGUE && (p.fatigueScore ?? 0) >= HIGH_FATIGUE) fatigueAdj++;
    }
    prevGenre = g; prevMood = m; prevVocal = v;
  }
  const avg = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);
  return {
    adjacentSameArtist: adjArtist, adjacentSameAlbum: adjAlbum, adjacentSameGenre: adjGenre,
    maxGenreRun, maxMoodRun, maxVocalRun,
    avgEnergyDelta: avg(eDeltas), maxEnergyDelta: eDeltas.length ? Math.max(...eDeltas) : null,
    avgBpmDelta: avg(bDeltas), maxBpmDelta: bDeltas.length ? Math.max(...bDeltas) : null,
    energyMissing: order.filter((t) => t.energy == null).length,
    bpmMissing: order.filter((t) => t.bpm == null).length,
    vocalMissing: order.filter((t) => vocalState(t) == null).length,
    highFatigueAdjacent: fatigueAdj,
  };
}

/* ── Sequence Quality — 서버 공식과 동일(미리보기; 서버 저장값이 최종) ────── */
const MISSING_RATIO_LIMIT = 0.4;

export function computeSequenceQuality(
  order: SequencingTrackFeature[], transitions: TransitionEvaluation[], cfg: SequencingConfig,
  generatedAt: string, hardViolations: string[] = [],
): SequenceQualityResult {
  const n = order.length;
  const stats = computeOrderStats(order);
  const pairs = Math.max(1, n - 1);
  const warnings: string[] = [];
  const softViolations: string[] = [];
  const insufficient: string[] = [];

  const missingRatio = n === 0 ? 1 : (stats.energyMissing + stats.bpmMissing + stats.vocalMissing) / (3 * n);
  const cHard = hardViolations.length ? 0 : 100;
  const cArtist = clamp100(100 - (stats.adjacentSameArtist / pairs) * 200);
  const cAlbum = clamp100(100 - (stats.adjacentSameAlbum / pairs) * 200);
  const cGenre = clamp100(100 - Math.max(0, stats.maxGenreRun - cfg.maxGenreRun) * 25);
  const cMood = clamp100(100 - Math.max(0, stats.maxMoodRun - cfg.maxGenreRun) * 25);
  const cEnergy = stats.energyMissing >= n ? null : clamp100(100 - (stats.avgEnergyDelta ?? 0) * 200);
  const cBpm = stats.bpmMissing >= n ? null : clamp100(100 - (stats.avgBpmDelta ?? 0) * 2);
  const cVocal = stats.vocalMissing >= n ? null : clamp100(100 - Math.max(0, stats.maxVocalRun - cfg.maxVocalRun) * 20);
  const cFatigue = clamp100(100 - (stats.highFatigueAdjacent / pairs) * 200);
  const cMeta = round1((1 - missingRatio) * 100);

  if (stats.adjacentSameArtist > 0) softViolations.push(`동일 아티스트 인접 ${stats.adjacentSameArtist}회`);
  if (stats.adjacentSameAlbum > 0) softViolations.push(`동일 앨범 인접 ${stats.adjacentSameAlbum}회`);
  if (stats.maxGenreRun > cfg.maxGenreRun) softViolations.push(`장르 연속 ${stats.maxGenreRun} > ${cfg.maxGenreRun}`);
  if (cEnergy == null) insufficient.push('missing_energy');
  if (cBpm == null) insufficient.push('missing_bpm');
  if (cVocal == null) insufficient.push('missing_vocal');
  insufficient.push('harmonic_transition_not_available');

  let score: number | null = null;
  let grade: SequenceQualityResult['grade'] = 'insufficient_data';
  if (hardViolations.length) {
    score = 0; grade = 'D';
  } else if (n >= 2 && missingRatio <= MISSING_RATIO_LIMIT) {
    const parts: Array<{ v: number | null; w: number }> = [
      { v: cHard, w: SEQ_QUALITY_WEIGHTS.hardConstraintCompliance },
      { v: cArtist, w: SEQ_QUALITY_WEIGHTS.artistSpacing },
      { v: cEnergy, w: SEQ_QUALITY_WEIGHTS.energyFlow },
      { v: cGenre, w: SEQ_QUALITY_WEIGHTS.genreFlow },
      { v: cBpm, w: SEQ_QUALITY_WEIGHTS.bpmFlow },
      { v: cVocal, w: SEQ_QUALITY_WEIGHTS.vocalFlow },
      { v: cAlbum, w: SEQ_QUALITY_WEIGHTS.albumSpacing },
      { v: cMood, w: SEQ_QUALITY_WEIGHTS.moodFlow },
      { v: cFatigue, w: SEQ_QUALITY_WEIGHTS.fatigueControl },
      { v: cMeta, w: SEQ_QUALITY_WEIGHTS.metadataCompleteness },
    ].filter((p) => p.v != null);
    const wsum = parts.reduce((s, p) => s + p.w, 0);
    score = wsum > 0 ? round1(parts.reduce((s, p) => s + (p.v as number) * p.w, 0) / wsum) : null;
    grade = score == null ? 'insufficient_data' : score >= 85 ? 'A' : score >= 70 ? 'B' : score >= 55 ? 'C' : 'D';
  } else if (n >= 2) {
    warnings.push(`메타데이터 부족 비율 ${Math.round(missingRatio * 100)}% > ${MISSING_RATIO_LIMIT * 100}% — 점수를 산출하지 않음`);
  }

  const scores = transitions.filter((t) => t.fromTrackId != null).map((t) => t.transitionScore);
  const avgT = scores.length ? round1(scores.reduce((s, v) => s + v, 0) / scores.length) : null;
  const worstT = scores.length ? Math.min(...scores) : null;
  const varT = scores.length && avgT != null
    ? round1(scores.reduce((s, v) => s + (v - avgT) ** 2, 0) / scores.length) : null;

  return {
    score, grade,
    breakdown: {
      hardConstraintCompliance: cHard, artistSpacing: round1(cArtist), albumSpacing: round1(cAlbum),
      genreFlow: round1(cGenre), moodFlow: round1(cMood),
      energyFlow: cEnergy == null ? null : round1(cEnergy), bpmFlow: cBpm == null ? null : round1(cBpm),
      vocalFlow: cVocal == null ? null : round1(cVocal), fatigueControl: round1(cFatigue),
      metadataCompleteness: cMeta, overallScore: score,
    },
    transitionCount: scores.length,
    averageTransitionScore: avgT, worstTransitionScore: worstT, transitionScoreVariance: varT,
    hardViolations, softViolations, warnings, insufficientData: [...new Set(insufficient)],
    generatedAt, algorithmVersion: SEQ_ALGORITHM_VERSION,
  };
}

/* ── 비교(원본 순서 vs Sequence / Sequence vs Sequence) ─────────────────── */
export interface SequenceComparison {
  positionChanged: number;
  avgAbsPositionDelta: number;
  a: OrderStats;
  b: OrderStats;
}

export function compareOrders(a: SequencingTrackFeature[], b: SequencingTrackFeature[]): SequenceComparison {
  const posA = new Map(a.map((t, i) => [t.trackId, i]));
  let changed = 0; let sum = 0; let counted = 0;
  b.forEach((t, i) => {
    const pa = posA.get(t.trackId);
    if (pa == null) return;
    counted++;
    if (pa !== i) changed++;
    sum += Math.abs(pa - i);
  });
  return {
    positionChanged: changed,
    avgAbsPositionDelta: counted ? round1((sum / counted) * 10) / 10 : 0,
    a: computeOrderStats(a), b: computeOrderStats(b),
  };
}

/* ── Explainability — 템플릿 결정론(LLM 미사용) ────────────────────────── */
export function buildSequenceExplanation(
  draftName: string, cfg: SequencingConfig, result: SequenceSuccess, quality: SequenceQualityResult,
): string[] {
  const lines: string[] = [];
  const stats = computeOrderStats(result.ordered);
  lines.push(`원본 Draft "${draftName}"의 ${result.ordered.length}곡을 ${cfg.strategy} 전략(Seed ${cfg.seed})으로 재배열했습니다.`);
  lines.push(stats.adjacentSameArtist === 0
    ? '동일 아티스트가 인접하지 않도록 순서를 재배치했습니다.'
    : `동일 아티스트 인접이 ${stats.adjacentSameArtist}회 남았습니다(후보 구성상 불가피 — Soft 위반으로 기록).`);
  if (stats.avgEnergyDelta != null) {
    lines.push(`에너지 평균 변화량은 ${Math.round(stats.avgEnergyDelta * 100) / 100}이며 최대 변화량은 ${Math.round((stats.maxEnergyDelta ?? 0) * 100) / 100}입니다.`);
  }
  if (stats.bpmMissing > 0) lines.push(`BPM 정보가 없는 ${stats.bpmMissing}곡은 BPM Transition 평가에서 제외했습니다.`);
  if (stats.energyMissing > 0) lines.push(`Energy 정보가 없는 ${stats.energyMissing}곡은 Energy Flow 평가에서 제외했습니다.`);
  lines.push(`장르 최대 연속 ${stats.maxGenreRun}곡 · Vocal 최대 연속 ${stats.maxVocalRun}곡 · 동일 앨범 인접 ${stats.adjacentSameAlbum}회.`);
  for (const r of result.relaxations) lines.push(r.note);
  for (const nt of result.notes) lines.push(nt);
  const real = result.transitions.filter((t) => t.fromTrackId != null);
  if (real.length) {
    const worst = real.reduce((w, t) => (t.transitionScore < w.transitionScore ? t : w));
    const best = real.reduce((w, t) => (t.transitionScore > w.transitionScore ? t : w));
    lines.push(`Worst Transition: ${worst.fromTrackId}→${worst.toTrackId} (${worst.transitionScore}) · Best: ${best.fromTrackId}→${best.toTrackId} (${best.transitionScore}).`);
  }
  lines.push(quality.score != null
    ? `Sequence Quality ${quality.score} (${quality.grade}) — 가중치: Hard20·아티스트15·에너지15·장르10·BPM10·보컬10·앨범5·무드5·피로5·메타5.`
    : 'Sequence Quality는 데이터 부족으로 산출하지 않았습니다(insufficient_data).');
  lines.push('Key/Camelot 데이터가 없어 Harmonic Transition 평가는 not_available입니다.');
  lines.push(FIXED_SEQUENCE_WARNING);
  return lines;
}

/* ── 저장 payload(서버가 Track Set/Hard/품질 재검증) ────────────────────── */
export function buildSequencePayload(
  name: string, playlistDraftId: string, cfg: SequencingConfig,
  result: SequenceSuccess, explanation: string[], quality: SequenceQualityResult,
): Record<string, unknown> {
  const cap = (r: SequenceReason[]) => r.slice(0, 10);
  return {
    playlist_draft_id: playlistDraftId,
    name,
    strategy: cfg.strategy,
    seed: cfg.seed,
    algorithm_version: SEQ_ALGORITHM_VERSION,
    input_snapshot: { strategy: cfg.strategy, seed: cfg.seed, daypart: cfg.daypart, track_count: result.ordered.length },
    constraint_snapshot: {
      max_energy_delta: cfg.maxEnergyDelta, max_bpm_delta: cfg.maxBpmDelta,
      artist_min_gap: cfg.artistMinGap, album_min_gap: cfg.albumMinGap,
      max_genre_run: cfg.maxGenreRun, max_mood_run: cfg.maxMoodRun, max_vocal_run: cfg.maxVocalRun,
      start_track_id: cfg.startTrackId, end_track_id: cfg.endTrackId, pinned: cfg.pinnedPositions,
    },
    relaxations: result.relaxations,
    energy_curve: result.targetCurve ?? [],
    explanation,
    warnings: quality.warnings.concat(quality.softViolations),
    insufficient_data: quality.insufficientData,
    ordering: result.ordered.map((t, i) => ({
      track_id: t.trackId,
      sequence_position: i,
      original_draft_order: t.originalDraftOrder,
      transition_from_track_id: i === 0 ? null : result.ordered[i - 1].trackId,
      transition_score: result.transitions[i]?.transitionScore ?? 0,
      energy_delta: result.transitions[i]?.energyDelta ?? null,
      bpm_delta: result.transitions[i]?.bpmDelta ?? null,
      reasons: cap(result.transitions[i]?.penalties ?? []),
      warnings: [],
      feature_snapshot: {
        energy: t.energy, bpm: t.bpm, genre: t.genre, mood: t.moods[0] ?? null,
        artist: t.artistKey, album: t.albumKey, vocal: vocalState(t), events: t.events, missing: t.missing,
      },
    })),
  };
}
