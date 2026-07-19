/**
 * playlistIntelCore — Playlist Intelligence Core & Safe Draft Generation
 * (Phase AI-PLAYLIST-INTEL-1).
 *
 * Production Read Model(candidate pool RPC 결과) 위에서 Hard/Soft/Advisory 제약,
 * 결정론적 선택(Seed), Diversity/Energy 평가, Quality Score, Explainability 를
 * 계산하는 **순수 로직**이다. 실제 Playlist/playlist_tracks/Queue/Scheduler/Player
 * 에는 어떤 것도 반영하지 않는다 — 결과는 Draft(0565) 저장 + 사람 검토에서 종료.
 *
 * 원칙: Hard Constraint 는 목표 곡 수 충족을 위해 자동 완화하지 않는다 ·
 * 존재하지 않는 데이터를 만들지 않는다(missing_* / insufficient_data 명시) ·
 * 동일 입력+Seed → 동일 결과(Math.random 미사용) · 외부 LLM 호출 없음 ·
 * 클라이언트 Quality 는 미리보기용이며 서버(_ai_pl_draft_quality)가 재계산·저장한다.
 *
 * 재사용: playlistGenerator(0487) 의 INDUSTRY_PROFILES/computeCompatibility/
 * fatigueScore 를 업종 적합·반복 위험 계산에 재사용(중복 구현 금지).
 * rotationSequencer 는 이번 Phase 에서 Player 에 연결하지 않는다.
 */

import {
  INDUSTRY_PROFILES, computeCompatibility, fatigueScore, getProfile,
  type PoolTrack,
} from './playlistGenerator';

/* ── Domain 타입 ─────────────────────────────────────────────────────── */
export type PlaylistGenerationMode = 'store' | 'brand' | 'industry' | 'daypart' | 'manual_assist';
export type PlaylistDraftStatus = 'draft' | 'ready_for_review' | 'approved' | 'rejected' | 'expired' | 'archived';
export type PlaylistConstraintSeverity = 'hard' | 'soft' | 'advisory';
export type PlaylistConstraintType =
  | 'store_policy' | 'brand_policy' | 'genre' | 'mood' | 'energy' | 'bpm'
  | 'vocal' | 'instrumental' | 'explicit_content' | 'artist_repetition'
  | 'album_repetition' | 'track_repetition' | 'recent_play' | 'qc'
  | 'release_status' | 'store_fit';

export interface PlaylistDraftTrackReason {
  code: string;
  message: string;
  scoreImpact: number;
  source: string;
}

/** candidate pool RPC(admin_ai_pl_candidate_pool) 원본 행. */
export interface IntelPoolRow {
  track_id: string;
  title: string | null;
  artist: string | null;
  album_name: string | null;
  main_genre: string | null;
  sub_genre: string | null;
  mood: string | null;
  bpm: number | null;
  duration: number | null;
  release_date: string | null;
  explicit_content: boolean | null;
  instrumental: boolean | null;
  energy: number | null;
  vocal_presence: number | null;
  instrumentalness: number | null;
  tempo_stability: number | null;
  qc_score: number | null;
  qc_grade: string | null;
  fit_score: number | null;
  fit_status: string | null;
  events: number | null;
  last_event_at: string | null;
  store_excluded: boolean | null;
  genre_blocked: boolean | null;
}

export interface PlaylistCandidateTrack {
  trackId: string;
  title: string | null;
  artistKey: string | null;
  albumKey: string | null;
  genre: string | null;
  subgenre: string | null;
  moods: string[];
  bpm: number | null;
  energy: number | null;
  isInstrumental: boolean | null;
  isExplicit: boolean | null;
  fitScore: number | null;
  fitStatus: string | null;
  qcScore: number | null;
  releaseDate: string | null;
  events: number;
  lastEventAt: string | null;
  storeExcluded: boolean;
  genreBlocked: boolean;
  missing: string[];
  selected: boolean;
  selectionScore: number;
  exclusionReasons: PlaylistDraftTrackReason[];
  selectionReasons: PlaylistDraftTrackReason[];
}

export interface PlaylistIntelConfig {
  mode: PlaylistGenerationMode;
  storeType: string | null;
  brandKey: string | null;
  sourcePlaylistId: string | null;
  daypart: string | null;
  targetCount: number;
  blockedGenres: string[];
  blockedMoods: string[];
  bpmMin: number | null;
  bpmMax: number | null;
  energyMin: number | null;
  energyMax: number | null;
  blockExplicit: boolean;
  requireInstrumental: boolean;
  minStoreFit: number | null;
  minQc: number | null;
  recentPlayExcludeDays: number | null;
  maxPerArtist: number;
  maxPerAlbum: number;
  maxGenreShare: number;
  minNewTrackRatio: number | null;
  seed: number;
}

export const DEFAULT_INTEL_CONFIG: PlaylistIntelConfig = {
  mode: 'store', storeType: null, brandKey: null, sourcePlaylistId: null, daypart: null,
  targetCount: 30, blockedGenres: [], blockedMoods: [],
  bpmMin: null, bpmMax: null, energyMin: null, energyMax: null,
  blockExplicit: true, requireInstrumental: false,
  minStoreFit: null, minQc: null, recentPlayExcludeDays: null,
  maxPerArtist: 2, maxPerAlbum: 2, maxGenreShare: 0.5, minNewTrackRatio: null,
  seed: 1,
};

export const INTEL_ALGORITHM_VERSION = 'pl-intel-core-v1';
export const FIXED_DRAFT_WARNING = '이 Draft는 실제 매장 Playlist, Queue 또는 Player에 자동 반영되지 않습니다.';
export const NEW_TRACK_WINDOW_DAYS = 90;

/** 금지 액션 — 스펙 금지 RPC 목록과 1:1. 어떤 경로도 이 액션을 실행하지 않는다. */
export const BLOCKED_INTEL_ACTIONS = [
  'publish_draft_to_playlist',
  'insert_playlist_tracks',
  'apply_to_queue',
  'apply_to_player',
  'apply_to_scheduler',
  'auto_approve',
  'auto_global_apply',
] as const;
export type BlockedIntelAction = (typeof BLOCKED_INTEL_ACTIONS)[number];
export function isBlockedIntelAction(action: string): boolean {
  return (BLOCKED_INTEL_ACTIONS as readonly string[]).includes(action) || action.startsWith('automatic_');
}

/* ── 결정론 유틸(Seed) — Math.random 미사용 ──────────────────────────── */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** trackId+seed → 안정 tie-break 값(동점 정렬용). */
export function seededTieBreak(trackId: string, seed: number): number {
  let h = seed >>> 0;
  for (let i = 0; i < trackId.length; i++) h = Math.imul(h ^ trackId.charCodeAt(i), 2654435761) >>> 0;
  return mulberry32(h)();
}

const isNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();
const round1 = (n: number) => Math.round(n * 10) / 10;
const clamp100 = (n: number) => Math.max(0, Math.min(100, n));

/* ── Candidate 정규화 — 데이터 부족은 만들어내지 않고 표시 ─────────────── */
export function normalizeCandidate(row: IntelPoolRow): PlaylistCandidateTrack {
  const missing: string[] = [];
  if (!isNum(row.fit_score)) missing.push('missing_store_fit');
  if (!isNum(row.qc_score)) missing.push('missing_qc');
  if (!isNum(row.energy)) missing.push('missing_energy');
  if (!row.main_genre || !row.mood) missing.push('unknown_feature');
  return {
    trackId: row.track_id,
    title: row.title,
    artistKey: norm(row.artist) || null,
    albumKey: norm(row.album_name) || null,
    genre: row.main_genre,
    subgenre: row.sub_genre,
    moods: row.mood ? [row.mood.trim()] : [],
    bpm: isNum(row.bpm) ? row.bpm : null,
    energy: isNum(row.energy) ? row.energy : null,
    isInstrumental: typeof row.instrumental === 'boolean' ? row.instrumental : null,
    isExplicit: typeof row.explicit_content === 'boolean' ? row.explicit_content : null,
    fitScore: isNum(row.fit_score) ? row.fit_score : null,
    fitStatus: row.fit_status,
    qcScore: isNum(row.qc_score) ? row.qc_score : null,
    releaseDate: row.release_date,
    events: isNum(row.events) ? row.events : 0,
    lastEventAt: row.last_event_at,
    storeExcluded: row.store_excluded === true,
    genreBlocked: row.genre_blocked === true,
    missing,
    selected: false,
    selectionScore: 0,
    exclusionReasons: [],
    selectionReasons: [],
  };
}

/* ── Hard Constraint — 위반 시 제외. 자동 완화 절대 금지 ────────────────── */
export function evaluateHardConstraints(c: PlaylistCandidateTrack, cfg: PlaylistIntelConfig): PlaylistDraftTrackReason[] {
  const out: PlaylistDraftTrackReason[] = [];
  const add = (code: PlaylistConstraintType | string, message: string, source: string) =>
    out.push({ code, message, scoreImpact: -100, source });
  if (c.storeExcluded) add('store_policy', '매장 제외 목록(track_store_exclusions)', 'track_store_exclusions');
  if (c.genreBlocked) add('genre', '업종 차단 장르(genre_block_rules)', 'genre_block_rules');
  if (cfg.blockedGenres.some((g) => norm(g) && norm(c.genre).includes(norm(g)))) {
    add('genre', `차단 장르(${c.genre ?? '?'})`, 'config.blockedGenres');
  }
  if (cfg.blockExplicit && c.isExplicit === true) add('explicit_content', 'Explicit 금지 정책 위반', 'tracks.explicit_content');
  if (cfg.requireInstrumental && c.isInstrumental === false) add('instrumental', 'Instrumental 필수 정책 위반', 'tracks.instrumental');
  if (cfg.minQc != null && c.qcScore != null && c.qcScore < cfg.minQc) {
    add('qc', `QC ${c.qcScore} < 최소 ${cfg.minQc}`, 'audio_qc_reports');
  }
  if (c.fitStatus === 'excluded') add('store_fit', 'Store Fit excluded 상태', 'playlist_track_fit_scores');
  return out;
}

/* ── Soft Constraint — 감점/제외 선호. 완화 시 기록 ─────────────────────── */
export interface SoftEvalResult { penalties: PlaylistDraftTrackReason[]; softExcluded: boolean }
export function evaluateSoftConstraints(
  c: PlaylistCandidateTrack, cfg: PlaylistIntelConfig, nowMs: number, minFitOverride: number | null,
): SoftEvalResult {
  const penalties: PlaylistDraftTrackReason[] = [];
  let softExcluded = false;
  const minFit = minFitOverride ?? cfg.minStoreFit;
  if (minFit != null && c.fitScore != null && c.fitScore < minFit) {
    penalties.push({ code: 'store_fit', message: `fit ${c.fitScore} < 최소 ${minFit}`, scoreImpact: -100, source: 'soft.minStoreFit' });
    softExcluded = true;
  }
  if (cfg.bpmMin != null && c.bpm != null && c.bpm < cfg.bpmMin) {
    penalties.push({ code: 'bpm', message: `BPM ${c.bpm} < ${cfg.bpmMin}`, scoreImpact: -10, source: 'soft.bpmRange' });
  }
  if (cfg.bpmMax != null && c.bpm != null && c.bpm > cfg.bpmMax) {
    penalties.push({ code: 'bpm', message: `BPM ${c.bpm} > ${cfg.bpmMax}`, scoreImpact: -10, source: 'soft.bpmRange' });
  }
  if (cfg.energyMin != null && c.energy != null && c.energy < cfg.energyMin) {
    penalties.push({ code: 'energy', message: `Energy ${c.energy} < ${cfg.energyMin}`, scoreImpact: -10, source: 'soft.energyRange' });
  }
  if (cfg.energyMax != null && c.energy != null && c.energy > cfg.energyMax) {
    penalties.push({ code: 'energy', message: `Energy ${c.energy} > ${cfg.energyMax}`, scoreImpact: -10, source: 'soft.energyRange' });
  }
  if (cfg.blockedMoods.length > 0 && c.moods.some((m) => cfg.blockedMoods.includes(m))) {
    penalties.push({ code: 'mood', message: `기피 무드(${c.moods.join(',')})`, scoreImpact: -15, source: 'soft.blockedMoods' });
  }
  if (cfg.recentPlayExcludeDays != null && c.lastEventAt) {
    const last = Date.parse(c.lastEventAt);
    if (Number.isFinite(last) && (nowMs - last) / 86400e3 <= cfg.recentPlayExcludeDays) {
      penalties.push({ code: 'recent_play', message: `${cfg.recentPlayExcludeDays}일 내 재생 이력`, scoreImpact: -100, source: 'playback_events_v2' });
      softExcluded = true;
    }
  }
  return { penalties, softExcluded };
}

/* ── 선택 점수 — 존재하는 신호만 가중 평균(임의 값 생성 금지) ─────────────── */
export function computeSelectionScore(c: PlaylistCandidateTrack, cfg: PlaylistIntelConfig, nowMs: number): {
  score: number; reasons: PlaylistDraftTrackReason[];
} {
  const reasons: PlaylistDraftTrackReason[] = [];
  const parts: Array<{ v: number; w: number; label: string }> = [];
  if (c.fitScore != null) parts.push({ v: c.fitScore, w: 0.5, label: 'store_fit' });
  if (c.qcScore != null) parts.push({ v: c.qcScore, w: 0.2, label: 'qc' });
  const profile = cfg.storeType ? getProfile(cfg.storeType) : null;
  if (profile) {
    // playlistGenerator 재사용 — PoolTrack 형태로 투영해 업종 적합도 계산.
    const asPool: PoolTrack = {
      track_id: c.trackId, title: c.title, artist: c.artistKey,
      main_genre: c.genre, mood: c.moods[0] ?? null, bpm: c.bpm, duration: null, language: null,
      events: c.events, skip_rate: null, completion_rate: null, likes: 0, replays: 0,
      last_event_at: c.lastEventAt, store_coverage: null, rollout_stage: null,
    };
    const compat = computeCompatibility(asPool, profile);
    parts.push({ v: compat.score, w: 0.3, label: 'industry_compat' });
  }
  if (parts.length === 0) {
    return { score: 0, reasons: [{ code: 'insufficient_data', message: '선택 근거 신호 없음(fit/qc/업종 적합 전부 부재)', scoreImpact: 0, source: 'selection' }] };
  }
  const wsum = parts.reduce((s, p) => s + p.w, 0);
  let score = parts.reduce((s, p) => s + p.v * p.w, 0) / wsum;
  for (const p of parts) reasons.push({ code: p.label, message: `${p.label} ${round1(p.v)}`, scoreImpact: round1(p.v * (p.w / wsum)), source: 'selection' });
  const fatigue = fatigueScore({
    track_id: c.trackId, title: c.title, artist: c.artistKey, main_genre: c.genre, mood: c.moods[0] ?? null,
    bpm: c.bpm, duration: null, language: null, events: c.events, skip_rate: null, completion_rate: null,
    likes: 0, replays: 0, last_event_at: c.lastEventAt, store_coverage: null, rollout_stage: null,
  }, nowMs);
  if (fatigue > 0) {
    const impact = -round1(fatigue * 0.2);
    score += impact;
    reasons.push({ code: 'track_repetition', message: `피로도 ${fatigue}`, scoreImpact: impact, source: 'playlistGenerator.fatigueScore' });
  }
  return { score: clamp100(round1(score)), reasons };
}

/* ── 선택 엔진 — 결정론적. 부족 시 Soft 만 완화(Hard 완화 금지) ──────────── */
export interface RelaxationNote { constraint: string; from: string; to: string; note: string }
export interface SelectionResult {
  candidates: PlaylistCandidateTrack[];
  selected: PlaylistCandidateTrack[];
  excluded: PlaylistCandidateTrack[];
  relaxations: RelaxationNote[];
  shortfall: number;
  hardViolationCount: number;
}

const RELAX_STEP = 5;
const RELAX_MAX_STEPS = 3;

export function selectDraftTracks(rows: IntelPoolRow[], cfg: PlaylistIntelConfig, nowMs: number): SelectionResult {
  const target = Math.max(1, Math.min(cfg.targetCount, 200));
  const candidates = rows.map(normalizeCandidate);
  const relaxations: RelaxationNote[] = [];

  // Hard 평가(1회 — 완화 없음).
  let hardViolationCount = 0;
  for (const c of candidates) {
    const hard = evaluateHardConstraints(c, cfg);
    if (hard.length > 0) { c.exclusionReasons.push(...hard); hardViolationCount++; }
  }
  const hardOk = candidates.filter((c) => c.exclusionReasons.length === 0);

  const runPass = (minFit: number | null, recentDays: number | null): PlaylistCandidateTrack[] => {
    const pass: PlaylistCandidateTrack[] = [];
    const local: PlaylistIntelConfig = { ...cfg, recentPlayExcludeDays: recentDays };
    for (const c of hardOk) {
      const soft = evaluateSoftConstraints(c, local, nowMs, minFit);
      const { score, reasons } = computeSelectionScore(c, cfg, nowMs);
      const softPenalty = soft.penalties.filter((p) => p.scoreImpact > -100).reduce((s, p) => s + p.scoreImpact, 0);
      c.selectionScore = clamp100(round1(score + softPenalty));
      c.selectionReasons = reasons;
      if (soft.softExcluded) { c.exclusionReasons = soft.penalties; continue; }
      if (soft.penalties.length > 0) c.selectionReasons = [...reasons, ...soft.penalties];
      c.exclusionReasons = [];
      pass.push(c);
    }
    return pass.sort((a, b) =>
      b.selectionScore - a.selectionScore
      || seededTieBreak(a.trackId, cfg.seed) - seededTieBreak(b.trackId, cfg.seed)
      || (a.trackId < b.trackId ? -1 : 1));
  };

  const pick = (sorted: PlaylistCandidateTrack[]): PlaylistCandidateTrack[] => {
    const chosen: PlaylistCandidateTrack[] = [];
    const artistCount = new Map<string, number>();
    const albumCount = new Map<string, number>();
    const genreCount = new Map<string, number>();
    for (const c of sorted) {
      if (chosen.length >= target) break;
      const a = c.artistKey ?? '';
      const al = c.albumKey ?? '';
      const g = norm(c.genre);
      if (a && (artistCount.get(a) ?? 0) >= cfg.maxPerArtist) {
        c.exclusionReasons = [{ code: 'artist_repetition', message: `동일 아티스트 최대 ${cfg.maxPerArtist}곡 제한`, scoreImpact: -100, source: 'soft.maxPerArtist' }];
        continue;
      }
      if (al && (albumCount.get(al) ?? 0) >= cfg.maxPerAlbum) {
        c.exclusionReasons = [{ code: 'album_repetition', message: `동일 앨범 최대 ${cfg.maxPerAlbum}곡 제한`, scoreImpact: -100, source: 'soft.maxPerAlbum' }];
        continue;
      }
      if (g && (genreCount.get(g) ?? 0) + 1 > Math.ceil(target * cfg.maxGenreShare)) {
        c.exclusionReasons = [{ code: 'genre', message: `장르 비율 상한 ${Math.round(cfg.maxGenreShare * 100)}%`, scoreImpact: -100, source: 'soft.maxGenreShare' }];
        continue;
      }
      c.selected = true;
      chosen.push(c);
      if (a) artistCount.set(a, (artistCount.get(a) ?? 0) + 1);
      if (al) albumCount.set(al, (albumCount.get(al) ?? 0) + 1);
      if (g) genreCount.set(g, (genreCount.get(g) ?? 0) + 1);
    }
    return chosen;
  };

  let minFit = cfg.minStoreFit;
  let recentDays = cfg.recentPlayExcludeDays;
  let selected = pick(runPass(minFit, recentDays));

  // Soft 완화 사다리 — Hard 는 어떤 경우에도 완화하지 않는다.
  let steps = 0;
  while (selected.length < target && steps < RELAX_MAX_STEPS && (minFit != null || recentDays != null)) {
    steps++;
    if (minFit != null && minFit > 0) {
      const next = Math.max(0, minFit - RELAX_STEP);
      relaxations.push({
        constraint: 'min_store_fit', from: String(minFit), to: String(next),
        note: `목표 ${target}곡을 충족하지 못해 최소 Store Fit을 ${minFit}에서 ${next}로 완화함.`,
      });
      minFit = next;
    } else if (recentDays != null && recentDays > 0) {
      const next = Math.floor(recentDays / 2);
      relaxations.push({
        constraint: 'recent_play_exclude_days', from: String(recentDays), to: next > 0 ? String(next) : '해제',
        note: `목표 ${target}곡을 충족하지 못해 최근 재생 제외 기준을 ${recentDays}일에서 ${next > 0 ? `${next}일` : '해제'}로 완화함.`,
      });
      recentDays = next > 0 ? next : null;
    } else break;
    for (const c of hardOk) c.selected = false;
    selected = pick(runPass(minFit, recentDays));
  }
  if (cfg.requireInstrumental || cfg.blockExplicit) {
    // Hard 완화 없음을 설명에 남길 수 있도록 고정 문구(테스트 대상).
    relaxations.forEach((r) => { r.note += ' Instrumental/Explicit 등 Hard Constraint는 완화하지 않음.'; });
  }

  const excluded = candidates.filter((c) => !c.selected);
  return { candidates, selected, excluded, relaxations, shortfall: Math.max(0, target - selected.length), hardViolationCount };
}

/* ── Diversity 평가 ──────────────────────────────────────────────────── */
export interface DiversityMetrics {
  uniqueArtistRatio: number | null;
  maxArtistShare: number | null;
  uniqueAlbumRatio: number | null;
  maxAlbumShare: number | null;
  genreDistribution: Record<string, number>;
  moodDistribution: Record<string, number>;
  maxGenreShare: number | null;
  instrumentalRatio: number | null;
  newTrackRatio: number;
  topTrackConcentration: number | null;
  missingMetadataRatio: number;
}

export function computeDiversityMetrics(selected: PlaylistCandidateTrack[], nowMs: number): DiversityMetrics {
  const n = selected.length;
  const empty: DiversityMetrics = {
    uniqueArtistRatio: null, maxArtistShare: null, uniqueAlbumRatio: null, maxAlbumShare: null,
    genreDistribution: {}, moodDistribution: {}, maxGenreShare: null, instrumentalRatio: null,
    newTrackRatio: 0, topTrackConcentration: null, missingMetadataRatio: 0,
  };
  if (n === 0) return empty;
  const count = (keys: Array<string | null>) => {
    const m = new Map<string, number>();
    for (const k of keys) if (k) m.set(k, (m.get(k) ?? 0) + 1);
    return m;
  };
  const artists = count(selected.map((c) => c.artistKey));
  const albums = count(selected.map((c) => c.albumKey));
  const genres = count(selected.map((c) => norm(c.genre) || null));
  const moods = count(selected.map((c) => c.moods[0] ?? null));
  const maxOf = (m: Map<string, number>) => (m.size ? Math.max(...m.values()) / n : null);
  const known = selected.filter((c) => c.isInstrumental != null);
  const newCut = nowMs - NEW_TRACK_WINDOW_DAYS * 86400e3;
  const newCount = selected.filter((c) => c.releaseDate && Date.parse(c.releaseDate) >= newCut).length;
  const totalEvents = selected.reduce((s, c) => s + c.events, 0);
  const topN = Math.max(1, Math.ceil(n * 0.1));
  const topEvents = [...selected].sort((a, b) => b.events - a.events).slice(0, topN).reduce((s, c) => s + c.events, 0);
  const missing = selected.filter((c) => c.missing.length > 0).length;
  return {
    uniqueArtistRatio: artists.size ? round1((artists.size / n) * 100) / 100 : null,
    maxArtistShare: maxOf(artists),
    uniqueAlbumRatio: albums.size ? round1((albums.size / n) * 100) / 100 : null,
    maxAlbumShare: maxOf(albums),
    genreDistribution: Object.fromEntries(genres),
    moodDistribution: Object.fromEntries(moods),
    maxGenreShare: maxOf(genres),
    instrumentalRatio: known.length ? known.filter((c) => c.isInstrumental).length / known.length : null,
    newTrackRatio: newCount / n,
    topTrackConcentration: totalEvents > 0 ? topEvents / totalEvents : null,
    missingMetadataRatio: missing / n,
  };
}

/* ── Energy Profile 평가(순서화는 다음 Phase — 분포만) ─────────────────── */
export const DAYPART_TARGET_UNAVAILABLE = 'predicted_dayparts 미적재 — Daypart 목표 Energy Profile insufficient_data';

export interface EnergyProfile {
  avg: number | null; min: number | null; max: number | null; stddev: number | null;
  lowRatio: number | null; midRatio: number | null; highRatio: number | null;
  outOfPolicyRatio: number | null; missingRatio: number;
  daypartTarget: 'insufficient_data';
}

export function computeEnergyProfile(selected: PlaylistCandidateTrack[], cfg: PlaylistIntelConfig): EnergyProfile {
  const values = selected.map((c) => c.energy).filter(isNum);
  const n = selected.length;
  const missingRatio = n === 0 ? 0 : (n - values.length) / n;
  if (values.length === 0) {
    return { avg: null, min: null, max: null, stddev: null, lowRatio: null, midRatio: null, highRatio: null, outOfPolicyRatio: null, missingRatio, daypartTarget: 'insufficient_data' };
  }
  const avg = values.reduce((s, v) => s + v, 0) / values.length;
  const stddev = Math.sqrt(values.reduce((s, v) => s + (v - avg) ** 2, 0) / values.length);
  const ratio = (fn: (v: number) => boolean) => values.filter(fn).length / values.length;
  const out = cfg.energyMin == null && cfg.energyMax == null ? null
    : ratio((v) => (cfg.energyMin != null && v < cfg.energyMin) || (cfg.energyMax != null && v > cfg.energyMax));
  return {
    avg: round1(avg * 100) / 100, min: Math.min(...values), max: Math.max(...values),
    stddev: round1(stddev * 100) / 100,
    lowRatio: ratio((v) => v < 0.33), midRatio: ratio((v) => v >= 0.33 && v <= 0.66), highRatio: ratio((v) => v > 0.66),
    outOfPolicyRatio: out, missingRatio, daypartTarget: 'insufficient_data',
  };
}

/* ── Quality Score — 서버(_ai_pl_draft_quality)와 동일 공식(미리보기) ───── */
export const QUALITY_WEIGHTS = {
  policyCompliance: 20, storeFit: 20, genreBalance: 20, artistDiversity: 20,
  energyConsistency: 10, vocalBalance: 5, novelty: 5,
} as const;

export interface PlaylistQualityBreakdown {
  policyCompliance: number;
  storeFit: number | null;
  genreBalance: number | null;
  moodBalance: number | null;
  artistDiversity: number | null;
  albumDiversity: number | null;
  energyConsistency: number | null;
  vocalBalance: number;
  novelty: number;
  repetitionRisk: number | null;
  overallScore: number | null;
}

export interface PlaylistQualityResult {
  score: number | null;
  grade: 'A' | 'B' | 'C' | 'D' | 'insufficient_data';
  breakdown: PlaylistQualityBreakdown;
  warnings: string[];
  failures: string[];
  insufficientData: string[];
  generatedAt: string;
  algorithmVersion: string;
}

const MISSING_RATIO_LIMIT = 0.4;

export function computeQuality(
  selected: PlaylistCandidateTrack[], hardViolationCount: number,
  metrics: DiversityMetrics, energy: EnergyProfile, cfg: PlaylistIntelConfig, generatedAt: string,
): PlaylistQualityResult {
  const n = selected.length;
  const warnings: string[] = [];
  const failures: string[] = [];
  const insufficient: string[] = [];

  const fits = selected.map((c) => c.fitScore).filter(isNum);
  const fitMissing = n - fits.length;
  const energyMissing = n === 0 ? 0 : Math.round(energy.missingRatio * n);
  const missingRatio = n === 0 ? 1 : (fitMissing + energyMissing) / (2 * n);

  const policyCompliance = clamp100(100 - hardViolationCount * 100);
  if (hardViolationCount > 0) failures.push(`Hard Constraint 위반 ${hardViolationCount}건 — ready_for_review 승격 불가`);
  const storeFit = fits.length ? round1(fits.reduce((s, v) => s + v, 0) / fits.length) : null;
  if (storeFit == null) insufficient.push('missing_store_fit');
  const genreBalance = metrics.maxGenreShare == null ? null
    : round1(clamp100(100 - Math.max(0, metrics.maxGenreShare - 0.5) * 200));
  const artistDiversity = metrics.uniqueArtistRatio == null || metrics.maxArtistShare == null ? null
    : round1(Math.min(100, metrics.uniqueArtistRatio * 70 + Math.max(0, 1 - metrics.maxArtistShare / 0.3) * 30));
  const albumDiversity = metrics.uniqueAlbumRatio == null ? null : round1(Math.min(100, metrics.uniqueAlbumRatio * 100));
  if (albumDiversity == null) insufficient.push('album_metadata_missing');
  const energyConsistency = energy.stddev == null ? null
    : round1(clamp100(100 - energy.stddev * 200 - energy.missingRatio * 30));
  if (energyConsistency == null) insufficient.push('missing_energy');
  // 목표 비율 정책이 없으면 실측 비율을 목표로 간주(감점 0) — 임의 목표 생성 금지.
  const vocalBalance = metrics.instrumentalRatio == null ? 100
    : round1(100 - Math.abs(metrics.instrumentalRatio - (cfg.requireInstrumental ? 1 : metrics.instrumentalRatio)) * 100);
  const novelty = round1(metrics.newTrackRatio * 100);
  const repetitionRisk = n === 0 ? null
    : round1(selected.reduce((s, c) => s + Math.min(100, (c.events / 80) * 100), 0) / n);
  const moodBalance = null; // 무드 목표 분포 정책 부재 — 임의 목표를 만들지 않는다.
  insufficient.push('mood_balance_target_missing');
  if (energy.daypartTarget === 'insufficient_data' && cfg.mode === 'daypart') insufficient.push('daypart_energy_target_missing');

  let score: number | null = null;
  let grade: PlaylistQualityResult['grade'] = 'insufficient_data';
  if (n > 0 && missingRatio <= MISSING_RATIO_LIMIT) {
    const parts: Array<{ v: number | null; w: number }> = [
      { v: policyCompliance, w: QUALITY_WEIGHTS.policyCompliance },
      { v: storeFit, w: QUALITY_WEIGHTS.storeFit },
      { v: genreBalance, w: QUALITY_WEIGHTS.genreBalance },
      { v: artistDiversity, w: QUALITY_WEIGHTS.artistDiversity },
      { v: energyConsistency, w: QUALITY_WEIGHTS.energyConsistency },
      { v: vocalBalance, w: QUALITY_WEIGHTS.vocalBalance },
      { v: novelty, w: QUALITY_WEIGHTS.novelty },
    ].filter((p) => p.v != null);
    const wsum = parts.reduce((s, p) => s + p.w, 0);
    score = wsum > 0 ? round1(parts.reduce((s, p) => s + (p.v as number) * p.w, 0) / wsum) : null;
    grade = score == null ? 'insufficient_data' : score >= 85 ? 'A' : score >= 70 ? 'B' : score >= 55 ? 'C' : 'D';
  } else if (n > 0) {
    warnings.push(`메타데이터 부족 비율 ${Math.round(missingRatio * 100)}% > ${MISSING_RATIO_LIMIT * 100}% — 점수를 산출하지 않음`);
  }
  if (metrics.missingMetadataRatio > 0) warnings.push(`메타데이터 부족 곡 비율 ${Math.round(metrics.missingMetadataRatio * 100)}%`);

  return {
    score, grade,
    breakdown: {
      policyCompliance, storeFit, genreBalance, moodBalance, artistDiversity, albumDiversity,
      energyConsistency, vocalBalance, novelty, repetitionRisk, overallScore: score,
    },
    warnings, failures, insufficientData: [...new Set(insufficient)],
    generatedAt, algorithmVersion: INTEL_ALGORITHM_VERSION,
  };
}

/* ── Explainability — 템플릿 기반 결정론(LLM 미사용) ───────────────────── */
export function buildDraftExplanation(
  cfg: PlaylistIntelConfig, poolCount: number, result: SelectionResult,
  metrics: DiversityMetrics, energy: EnergyProfile, quality: PlaylistQualityResult,
): string[] {
  const lines: string[] = [];
  const profile = cfg.storeType ? INDUSTRY_PROFILES[cfg.storeType] : null;
  lines.push(`${profile ? `${profile.label}(${cfg.storeType})` : cfg.storeType ?? cfg.mode} 기준으로 Draft를 생성했습니다.`);
  const policies: string[] = [];
  if (cfg.blockExplicit) policies.push('Explicit 금지');
  if (cfg.requireInstrumental) policies.push('Instrumental 필수');
  if (cfg.minQc != null) policies.push(`최소 QC ${cfg.minQc}`);
  if (cfg.minStoreFit != null) policies.push(`최소 Store Fit ${cfg.minStoreFit}`);
  lines.push(policies.length ? `적용 정책: ${policies.join(' · ')}.` : '추가 정책 없이 기본 게이트만 적용했습니다.');
  lines.push(`후보 ${poolCount}곡 중 ${result.selected.length}곡을 선택하고 ${result.excluded.length}곡을 제외했습니다.`);
  const reasonCounts = new Map<string, number>();
  for (const c of result.excluded) for (const r of c.exclusionReasons) reasonCounts.set(r.code, (reasonCounts.get(r.code) ?? 0) + 1);
  const topReasons = [...reasonCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  if (topReasons.length) lines.push(`주요 제외 사유: ${topReasons.map(([c, n]) => `${c} ${n}곡`).join(', ')}.`);
  for (const r of result.relaxations) lines.push(r.note);
  if (result.shortfall > 0) lines.push(`완화 후에도 목표 대비 ${result.shortfall}곡이 부족합니다(후보 부족).`);
  if (metrics.maxArtistShare != null) lines.push(`아티스트 최대 점유율 ${Math.round(metrics.maxArtistShare * 100)}% · 고유 아티스트 비율 ${Math.round((metrics.uniqueArtistRatio ?? 0) * 100)}%.`);
  if (metrics.instrumentalRatio != null) lines.push(`Instrumental 비율 ${Math.round(metrics.instrumentalRatio * 100)}%.`);
  if (energy.avg != null) lines.push(`Energy 평균 ${energy.avg} (저 ${Math.round((energy.lowRatio ?? 0) * 100)}% · 고 ${Math.round((energy.highRatio ?? 0) * 100)}%).`);
  if (energy.missingRatio > 0) lines.push(`Energy 메타데이터가 없는 곡 ${Math.round(energy.missingRatio * result.selected.length)}곡은 품질 평가에서 데이터 부족으로 처리했습니다.`);
  lines.push(quality.score != null
    ? `Quality Score ${quality.score} (${quality.grade}) — 가중치: 정책20·Fit20·장르20·아티스트20·에너지10·보컬5·신규5.`
    : 'Quality Score는 데이터 부족으로 산출하지 않았습니다(insufficient_data).');
  lines.push(FIXED_DRAFT_WARNING);
  return lines;
}

/* ── Draft 저장 payload(서버가 Hard Gate·품질 재검증) ──────────────────── */
export interface DraftPayloadTrack {
  track_id: string; draft_order: number; selection_score: number; selected: boolean;
  selection_reasons: PlaylistDraftTrackReason[]; exclusion_reasons: PlaylistDraftTrackReason[];
  feature_snapshot: Record<string, unknown>;
}

export function buildDraftPayload(
  name: string, cfg: PlaylistIntelConfig, poolCount: number, result: SelectionResult,
  explanation: string[], quality: PlaylistQualityResult,
): Record<string, unknown> {
  const cap = (r: PlaylistDraftTrackReason[]) => r.slice(0, 10);
  const toTrack = (c: PlaylistCandidateTrack, i: number): DraftPayloadTrack => ({
    track_id: c.trackId, draft_order: i, selection_score: c.selectionScore, selected: c.selected,
    selection_reasons: cap(c.selectionReasons), exclusion_reasons: cap(c.exclusionReasons),
    feature_snapshot: {
      fit_score: c.fitScore, qc_score: c.qcScore, energy: c.energy, bpm: c.bpm,
      genre: c.genre, mood: c.moods[0] ?? null, events: c.events, missing: c.missing,
    },
  });
  const excludedSample = result.excluded.slice(0, 200 - Math.min(result.selected.length, 200));
  return {
    name,
    generation_mode: cfg.mode,
    store_type: cfg.storeType,
    brand_key: cfg.brandKey,
    source_playlist_id: cfg.sourcePlaylistId,
    target_track_count: Math.max(1, Math.min(cfg.targetCount, 200)),
    candidate_track_count: poolCount,
    algorithm_version: INTEL_ALGORITHM_VERSION,
    input_snapshot: { mode: cfg.mode, store_type: cfg.storeType, brand_key: cfg.brandKey, daypart: cfg.daypart, seed: cfg.seed, target: cfg.targetCount },
    constraint_snapshot: {
      block_explicit: cfg.blockExplicit, require_instrumental: cfg.requireInstrumental,
      min_qc: cfg.minQc, min_store_fit: cfg.minStoreFit, bpm: [cfg.bpmMin, cfg.bpmMax],
      energy: [cfg.energyMin, cfg.energyMax], blocked_genres: cfg.blockedGenres,
      max_per_artist: cfg.maxPerArtist, max_per_album: cfg.maxPerAlbum, max_genre_share: cfg.maxGenreShare,
      recent_play_exclude_days: cfg.recentPlayExcludeDays,
    },
    relaxations: result.relaxations,
    explanation,
    warnings: quality.warnings.concat(quality.failures),
    insufficient_data: quality.insufficientData,
    tracks: [...result.selected.map(toTrack), ...excludedSample.map((c, i) => toTrack(c, result.selected.length + i))],
  };
}
