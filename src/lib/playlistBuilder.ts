/**
 * playlistBuilder.ts — Phase AI-PLAYLIST-ADMIN-UX-1
 *
 * PURE logic for the AI-assisted Playlist Builder (no network, no DOM, fully
 * unit-testable). Everything here is ADVISORY: it produces recommendation
 * reasons, warnings, filters, distributions, quality checks and an order
 * *suggestion* for the admin to review. It NEVER writes to the DB and NEVER
 * decides on its own — the admin approves and the service layer saves.
 *
 * 원칙 (AI Assisted, Human Approved):
 *   • 새 점수 공식 없음 — DB 가 계산한 fit/adaptive/guardrail 값을 그대로 재사용.
 *   • 존재하지 않는 데이터로 가짜 이유/경고/필터를 만들지 않는다(null 이면 생략).
 *   • suggestOrder 는 "제안"만 반환한다. 적용 여부는 관리자·UI 가 결정.
 *
 * 데이터 출처(모두 기존):
 *   tracks(list_admin_tracks_with_ai / search_catalog), playlist_track_fit_scores
 *   (get_ai_recommended_tracks_for_playlist), candidate pool(0463/0465),
 *   learning dashboard(0465), store guardrails(0173/0462).
 */

// =============================================================================
// Types — a builder-side merge of already-computed DB values
// =============================================================================

/** 빌더가 다루는 통합 트랙 뷰. 모든 점수/피처는 "기존 DB 값"의 미러다. */
export interface BuilderTrack {
  track_id: string;
  title: string | null;
  artist: string | null;
  genre: string | null; // tracks.main_genre
  mood: string | null;
  bpm: number | null;
  energyLevel: number | null; // 1..5 (tracks.energy_level)
  vocalPresence: number | null; // 1..5 (tracks.vocal_presence)
  instrumental: boolean | null;
  explicit: boolean | null;
  duration: number | null; // seconds
  coverUrl: string | null;
  audioUrl: string | null;
  audioHash: string | null; // tracks.audio_sha256
  // scores — nullable: a catalog track not yet scored for this playlist has none
  fitScore: number | null;
  fitStatus: string | null; // active | review_needed | excluded
  adaptiveScore: number | null;
  reactionScore: number | null;
  difference: number | null; // adaptive − fit
  completionRate: number | null; // 0..1
  skipRate: number | null; // 0..1
  sampleCount: number | null;
  learningStatus: string | null; // collecting | active
  guardrailBlocked: boolean;
  guardrailPenalty: number;
  guardrailSeverity: string | null;
  alreadyInPlaylist: boolean;
}

/** 추천 조건(관리자 입력). 모든 필드 선택적 — 있는 것만 필터/이유에 사용. */
export interface BuilderConditions {
  daypart?: string | null; // 오전/오후/저녁 등 (time_slot)
  storeType?: string | null; // 업종(canonical)
  targetDurationSec?: number | null; // 목표 재생시간
}

// =============================================================================
// Constants (advisory thresholds) — 명시·고정, 테스트로 잠금
// =============================================================================

export const HIGH_FIT = 80;
export const HIGH_COMPLETION = 0.85;
export const LOW_SKIP = 0.2;
export const HIGH_SKIP = 0.5;
/** 동일 아티스트/장르 비중 경고 임계(전체 대비). */
export const ARTIST_CONCENTRATION_WARN = 0.3;
export const GENRE_CONCENTRATION_WARN = 0.5;
/** 인접 BPM/Energy 급변 경고 임계. */
export const BPM_JUMP_WARN = 40;
export const ENERGY_JUMP_WARN = 3; // 1..5 스케일에서 3 이상 점프
/** 보컬 트랙 비중 경고 임계. */
export const VOCAL_RATIO_WARN = 0.7;
/** 학습 적용 최소 표본(0465 와 동일). */
export const MIN_LEARNING_SAMPLE = 20;

// =============================================================================
// Small pure helpers
// =============================================================================

function isNum(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

/** vocal 트랙 여부(판정 가능할 때만). instrumental=true → false, vocal_presence>=3 → true. */
export function isVocalTrack(t: BuilderTrack): boolean | null {
  if (t.instrumental === true) return false;
  if (t.instrumental === false) return true;
  if (isNum(t.vocalPresence)) return t.vocalPresence >= 3;
  return null;
}

/** adaptive 우선, 없으면 fit. 둘 다 없으면 null (가짜 값 만들지 않음). */
export function effectiveScore(t: BuilderTrack): number | null {
  if (isNum(t.adaptiveScore)) return t.adaptiveScore;
  if (isNum(t.fitScore)) return t.fitScore;
  return null;
}

// =============================================================================
// Dedupe / duration / distributions
// =============================================================================

/** track_id 기준 중복 제거(첫 등장 유지, 순서 보존). */
export function dedupeTracks<T extends { track_id: string }>(tracks: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const t of tracks) {
    if (!t || typeof t.track_id !== 'string' || seen.has(t.track_id)) continue;
    seen.add(t.track_id);
    out.push(t);
  }
  return out;
}

/** 총 재생시간(초). null duration 은 0 취급. */
export function totalDuration(tracks: Pick<BuilderTrack, 'duration'>[]): number {
  let sum = 0;
  for (const t of tracks) if (isNum(t.duration) && t.duration > 0) sum += t.duration;
  return sum;
}

/** 초 → "H:MM:SS" 또는 "M:SS". */
export function formatTotalDuration(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(ss)}` : `${m}:${pad(ss)}`;
}

export interface DistributionBucket {
  key: string;
  count: number;
  ratio: number; // 0..1 of total
}

function distributionBy(
  tracks: BuilderTrack[],
  keyFn: (t: BuilderTrack) => string | null,
): DistributionBucket[] {
  const counts = new Map<string, number>();
  let total = 0;
  for (const t of tracks) {
    const k = keyFn(t);
    if (k == null || k === '') continue;
    counts.set(k, (counts.get(k) ?? 0) + 1);
    total++;
  }
  const out: DistributionBucket[] = [];
  for (const [key, count] of counts) {
    out.push({ key, count, ratio: total > 0 ? count / total : 0 });
  }
  // count desc, then key asc — deterministic.
  out.sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
  return out;
}

export function artistDistribution(tracks: BuilderTrack[]): DistributionBucket[] {
  return distributionBy(tracks, (t) => t.artist);
}

export function genreDistribution(tracks: BuilderTrack[]): DistributionBucket[] {
  return distributionBy(tracks, (t) => t.genre);
}

/** energy_level(1..5) → low(1-2)/mid(3)/high(4-5) 버킷. */
export function energyDistribution(tracks: BuilderTrack[]): DistributionBucket[] {
  return distributionBy(tracks, (t) => {
    if (!isNum(t.energyLevel)) return null;
    if (t.energyLevel <= 2) return 'low';
    if (t.energyLevel === 3) return 'mid';
    return 'high';
  });
}

// =============================================================================
// Recommendation reasons & warnings (human-readable, data-backed only)
// =============================================================================

/** 추천 이유(있는 근거만). 점수만 나열하지 않고 문장/태그로. */
export function generateReasons(t: BuilderTrack, cond: BuilderConditions = {}): string[] {
  const out: string[] = [];
  const fit = t.fitScore;
  if (isNum(fit) && fit >= HIGH_FIT) {
    out.push(cond.storeType ? `${cond.storeType} 적합도 높음 (${Math.round(fit)})` : `적합도 높음 (${Math.round(fit)})`);
  }
  const vocal = isVocalTrack(t);
  if (vocal === false) out.push('보컬 없음');
  if (cond.daypart && isNum(t.energyLevel)) {
    out.push(`${cond.daypart} 시간대에 어울리는 에너지`);
  }
  if (isNum(t.completionRate) && t.completionRate >= HIGH_COMPLETION && (t.sampleCount ?? 0) >= MIN_LEARNING_SAMPLE) {
    out.push(`완청률 ${Math.round(t.completionRate * 100)}%`);
  }
  if (isNum(t.skipRate) && t.skipRate <= LOW_SKIP && (t.sampleCount ?? 0) >= MIN_LEARNING_SAMPLE) {
    out.push('최근 스킵률 낮음');
  }
  if (isNum(t.adaptiveScore) && isNum(t.fitScore) && t.adaptiveScore - t.fitScore >= 10) {
    out.push('매장 반응으로 상승');
  }
  if (!t.guardrailBlocked && t.guardrailPenalty === 0 && t.fitStatus !== 'excluded') {
    out.push('차단 조건 없음');
  }
  return out;
}

/** 경고 사유(있는 근거만). playlistCtx 는 현재 편집 중인 플레이리스트. */
export function generateWarnings(t: BuilderTrack, playlist: BuilderTrack[] = []): string[] {
  const out: string[] = [];

  if (t.guardrailBlocked || t.fitStatus === 'excluded') {
    out.push('Blocked Guardrail 적용');
  }
  if (t.guardrailPenalty > 0 || t.fitStatus === 'review_needed') {
    out.push(`감점 적용${t.guardrailPenalty > 0 ? ` (−${t.guardrailPenalty})` : ''}`);
  }
  if (t.explicit === true) out.push('Explicit 포함');

  // 동일 아티스트가 이미 플레이리스트에 N곡 포함?
  if (t.artist) {
    const same = playlist.filter((p) => p.artist === t.artist && p.track_id !== t.track_id).length;
    if (same >= 3) out.push(`동일 아티스트가 이미 ${same}곡 포함됨`);
  }

  // 매장 스킵률 높음
  if (isNum(t.skipRate) && t.skipRate >= HIGH_SKIP && (t.sampleCount ?? 0) >= MIN_LEARNING_SAMPLE) {
    out.push(`해당 매장 스킵률 높음 (${Math.round(t.skipRate * 100)}%)`);
  }

  // 표본 부족(학습 참고 불가)
  if (t.learningStatus === 'collecting' || (isNum(t.sampleCount) && t.sampleCount < MIN_LEARNING_SAMPLE)) {
    out.push('학습 샘플 수 부족');
  }

  // 플레이리스트 평균 에너지보다 지나치게 높음
  if (isNum(t.energyLevel) && playlist.length > 0) {
    const energies = playlist.map((p) => p.energyLevel).filter(isNum);
    if (energies.length > 0) {
      const avg = energies.reduce((a, b) => a + b, 0) / energies.length;
      if (t.energyLevel - avg >= ENERGY_JUMP_WARN) out.push('플레이리스트 평균 에너지보다 지나치게 높음');
    }
  }

  // 재생 불가 데이터
  if (!t.audioUrl) out.push('Audio URL 누락');
  return out;
}

// =============================================================================
// Candidate filtering
// =============================================================================

export interface CandidateFilters {
  query?: string; // title/artist/genre 부분일치
  genre?: string | null;
  mood?: string | null;
  bpmMin?: number | null;
  bpmMax?: number | null;
  energyMin?: number | null; // 1..5
  energyMax?: number | null;
  vocal?: 'any' | 'vocal' | 'instrumental';
  fitMin?: number | null;
  fitMax?: number | null;
  adaptiveMin?: number | null;
  adaptiveMax?: number | null;
  completionMin?: number | null; // 0..1
  skipMax?: number | null; // 0..1
  sampleMin?: number | null;
  excludeBlocked?: boolean;
  excludePenalized?: boolean;
  excludeAlreadyIn?: boolean;
  excludeArtists?: string[];
  excludeTrackIds?: string[];
  /** any-of 느슨한(대소문자·부분일치) 장르 허용 목록. 비어있으면 미적용. */
  includeGenres?: string[];
  /** 느슨한(대소문자·부분일치) 장르 차단 목록. */
  excludeGenres?: string[];
  /** explicit 트랙 제외(explicit===true 만 제외; null 은 통과). */
  excludeExplicit?: boolean;
}

/** 느슨한 장르 매칭: 토큰 목록 중 하나라도 트랙 장르와 부분일치하면 true. */
function genreMatchesAny(genre: string | null, tokens: string[]): boolean {
  if (!genre) return false;
  const g = genre.toLowerCase();
  return tokens.some((raw) => {
    const tok = raw.trim().toLowerCase();
    return tok !== '' && (g.includes(tok) || tok.includes(g));
  });
}

function includesCI(hay: string | null, needle: string): boolean {
  return !!hay && hay.toLowerCase().includes(needle);
}

/**
 * 후보 필터. 값이 주어진 조건만 적용한다.
 * 숫자 범위 필터는 해당 값이 null 인 트랙을 제외한다(데이터가 요구되는 필터이므로).
 */
export function filterCandidates(tracks: BuilderTrack[], f: CandidateFilters = {}): BuilderTrack[] {
  const q = f.query?.trim().toLowerCase();
  const exArtists = new Set((f.excludeArtists ?? []).filter(Boolean));
  const exIds = new Set(f.excludeTrackIds ?? []);

  return tracks.filter((t) => {
    if (q && !(includesCI(t.title, q) || includesCI(t.artist, q) || includesCI(t.genre, q))) return false;
    if (f.genre && t.genre !== f.genre) return false;
    if (f.mood && t.mood !== f.mood) return false;

    if (isNum(f.bpmMin)) { if (!isNum(t.bpm) || t.bpm < f.bpmMin) return false; }
    if (isNum(f.bpmMax)) { if (!isNum(t.bpm) || t.bpm > f.bpmMax) return false; }
    if (isNum(f.energyMin)) { if (!isNum(t.energyLevel) || t.energyLevel < f.energyMin) return false; }
    if (isNum(f.energyMax)) { if (!isNum(t.energyLevel) || t.energyLevel > f.energyMax) return false; }

    if (f.vocal === 'vocal' && isVocalTrack(t) !== true) return false;
    if (f.vocal === 'instrumental' && isVocalTrack(t) !== false) return false;

    if (isNum(f.fitMin)) { if (!isNum(t.fitScore) || t.fitScore < f.fitMin) return false; }
    if (isNum(f.fitMax)) { if (!isNum(t.fitScore) || t.fitScore > f.fitMax) return false; }
    if (isNum(f.adaptiveMin)) { if (!isNum(t.adaptiveScore) || t.adaptiveScore < f.adaptiveMin) return false; }
    if (isNum(f.adaptiveMax)) { if (!isNum(t.adaptiveScore) || t.adaptiveScore > f.adaptiveMax) return false; }
    if (isNum(f.completionMin)) { if (!isNum(t.completionRate) || t.completionRate < f.completionMin) return false; }
    if (isNum(f.skipMax)) { if (!isNum(t.skipRate) || t.skipRate > f.skipMax) return false; }
    if (isNum(f.sampleMin)) { if (!isNum(t.sampleCount) || t.sampleCount < f.sampleMin) return false; }

    if (f.excludeBlocked && (t.guardrailBlocked || t.fitStatus === 'excluded')) return false;
    if (f.excludePenalized && (t.guardrailPenalty > 0 || t.fitStatus === 'review_needed')) return false;
    if (f.excludeAlreadyIn && t.alreadyInPlaylist) return false;
    if (f.excludeExplicit && t.explicit === true) return false;
    if (t.artist && exArtists.has(t.artist)) return false;
    if (exIds.has(t.track_id)) return false;

    if (f.includeGenres && f.includeGenres.length > 0 && !genreMatchesAny(t.genre, f.includeGenres)) return false;
    if (f.excludeGenres && f.excludeGenres.length > 0 && genreMatchesAny(t.genre, f.excludeGenres)) return false;

    return true;
  });
}

// =============================================================================
// Quality check (Error / Warning / Info)
// =============================================================================

export type QualitySeverity = 'error' | 'warning' | 'info';

export interface QualityIssue {
  code: string;
  severity: QualitySeverity;
  message: string;
  trackIds?: string[];
}

export interface QualityCheckOptions {
  minTracks?: number; // 기본 5
  targetDurationSec?: number | null;
}

/**
 * 저장 전 품질 검사. 기존 정책/Guardrail 값(fitStatus, guardrail*)을 재사용한다.
 * Error 가 있으면 UI 가 저장/배포를 막을 수 있다. Warning 은 확인 후 저장 가능.
 */
export function runQualityCheck(tracks: BuilderTrack[], opts: QualityCheckOptions = {}): QualityIssue[] {
  const issues: QualityIssue[] = [];
  const minTracks = opts.minTracks ?? 5;
  const n = tracks.length;

  // 곡 수 부족
  if (n < minTracks) {
    issues.push({ code: 'too_few_tracks', severity: n === 0 ? 'error' : 'warning', message: `곡 수가 부족합니다 (${n}/${minTracks})` });
  }

  // 목표 재생시간 부족
  if (isNum(opts.targetDurationSec) && opts.targetDurationSec > 0) {
    const total = totalDuration(tracks);
    if (total < opts.targetDurationSec) {
      issues.push({
        code: 'below_target_duration',
        severity: 'warning',
        message: `목표 재생시간 부족 (${formatTotalDuration(total)} / ${formatTotalDuration(opts.targetDurationSec)})`,
      });
    }
  }

  // 동일 곡 중복
  const idCount = new Map<string, number>();
  for (const t of tracks) idCount.set(t.track_id, (idCount.get(t.track_id) ?? 0) + 1);
  const dupIds = [...idCount.entries()].filter(([, c]) => c > 1).map(([id]) => id);
  if (dupIds.length > 0) {
    issues.push({ code: 'duplicate_track', severity: 'error', message: `동일 곡 중복 ${dupIds.length}건`, trackIds: dupIds });
  }

  // 동일 Audio Hash 중복
  const hashMap = new Map<string, string[]>();
  for (const t of tracks) {
    if (!t.audioHash) continue;
    const arr = hashMap.get(t.audioHash) ?? [];
    arr.push(t.track_id);
    hashMap.set(t.audioHash, arr);
  }
  const dupHash = [...hashMap.values()].filter((a) => a.length > 1).flat();
  if (dupHash.length > 0) {
    issues.push({ code: 'duplicate_audio_hash', severity: 'warning', message: `동일 음원(Audio Hash) 중복 ${dupHash.length}건`, trackIds: dupHash });
  }

  // Blocked / excluded
  const blocked = tracks.filter((t) => t.guardrailBlocked || t.fitStatus === 'excluded').map((t) => t.track_id);
  if (blocked.length > 0) {
    issues.push({ code: 'blocked_track', severity: 'error', message: `차단(Blocked) 곡 포함 ${blocked.length}곡`, trackIds: blocked });
  }

  // Penalized / review_needed
  const penalized = tracks.filter((t) => (t.guardrailPenalty > 0 || t.fitStatus === 'review_needed') && !(t.guardrailBlocked || t.fitStatus === 'excluded')).map((t) => t.track_id);
  if (penalized.length > 0) {
    issues.push({ code: 'penalized_track', severity: 'warning', message: `감점(Penalized) 곡 포함 ${penalized.length}곡`, trackIds: penalized });
  }

  // 재생 불가 데이터: audio_url / duration 누락
  const noAudio = tracks.filter((t) => !t.audioUrl).map((t) => t.track_id);
  if (noAudio.length > 0) issues.push({ code: 'missing_audio_url', severity: 'error', message: `Audio URL 누락 ${noAudio.length}곡`, trackIds: noAudio });
  const noDuration = tracks.filter((t) => !isNum(t.duration) || t.duration <= 0).map((t) => t.track_id);
  if (noDuration.length > 0) issues.push({ code: 'missing_duration', severity: 'warning', message: `재생시간(Duration) 누락 ${noDuration.length}곡`, trackIds: noDuration });
  const noArt = tracks.filter((t) => !t.coverUrl).map((t) => t.track_id);
  if (noArt.length > 0) issues.push({ code: 'missing_artwork', severity: 'info', message: `아트워크 누락 ${noArt.length}곡`, trackIds: noArt });

  // Explicit 포함
  const explicit = tracks.filter((t) => t.explicit === true).map((t) => t.track_id);
  if (explicit.length > 0) issues.push({ code: 'explicit_track', severity: 'warning', message: `Explicit 곡 포함 ${explicit.length}곡`, trackIds: explicit });

  // 아티스트/장르 과다 집중
  if (n > 0) {
    const topArtist = artistDistribution(tracks)[0];
    if (topArtist && topArtist.ratio > ARTIST_CONCENTRATION_WARN) {
      issues.push({ code: 'artist_concentration', severity: 'warning', message: `동일 아티스트 비중 과다 (${topArtist.key} ${Math.round(topArtist.ratio * 100)}%)` });
    }
    const topGenre = genreDistribution(tracks)[0];
    if (topGenre && topGenre.ratio > GENRE_CONCENTRATION_WARN) {
      issues.push({ code: 'genre_concentration', severity: 'info', message: `동일 장르 비중 과다 (${topGenre.key} ${Math.round(topGenre.ratio * 100)}%)` });
    }
    // Vocal 비중 과다
    const vocalCount = tracks.filter((t) => isVocalTrack(t) === true).length;
    if (vocalCount / n > VOCAL_RATIO_WARN) {
      issues.push({ code: 'vocal_concentration', severity: 'info', message: `보컬 트랙 비중 과다 (${Math.round((vocalCount / n) * 100)}%)` });
    }
  }

  // BPM / Energy 급변 구간(인접)
  let bpmJumps = 0, energyJumps = 0;
  for (let i = 1; i < tracks.length; i++) {
    const a = tracks[i - 1], b = tracks[i];
    if (isNum(a.bpm) && isNum(b.bpm) && Math.abs(a.bpm - b.bpm) >= BPM_JUMP_WARN) bpmJumps++;
    if (isNum(a.energyLevel) && isNum(b.energyLevel) && Math.abs(a.energyLevel - b.energyLevel) >= ENERGY_JUMP_WARN) energyJumps++;
  }
  if (bpmJumps > 0) issues.push({ code: 'bpm_jump', severity: 'info', message: `BPM 급변 구간 ${bpmJumps}곳` });
  if (energyJumps > 0) issues.push({ code: 'energy_jump', severity: 'info', message: `에너지 급변 구간 ${energyJumps}곳` });

  return issues;
}

/** 저장 차단 여부: error 가 하나라도 있으면 true. */
export function hasBlockingIssues(issues: QualityIssue[]): boolean {
  return issues.some((i) => i.severity === 'error');
}

/** 심각도별 카운트 요약. */
export function summarizeIssues(issues: QualityIssue[]): Record<QualitySeverity, number> {
  return {
    error: issues.filter((i) => i.severity === 'error').length,
    warning: issues.filter((i) => i.severity === 'warning').length,
    info: issues.filter((i) => i.severity === 'info').length,
  };
}

// =============================================================================
// AI Order Suggestion (advisory preview only)
// =============================================================================

export interface OrderSuggestionResult {
  order: BuilderTrack[];
  changed: boolean;
  movedCount: number; // 위치가 바뀐 트랙 수
}

/**
 * 곡 순서 초안 제안(순수·결정론적). 새 곡 추가/삭제 없음 — 재정렬만.
 * 규칙(그리디): 직전 곡과 동일 아티스트/장르 회피, BPM·Energy 급변 완화,
 * 보컬 연속 회피, blocked 후순위, penalized 후순위. tie-break 는 원래 인덱스.
 * 결과는 "제안"이며, 적용은 관리자·UI 가 결정한다.
 */
export function suggestOrder(tracks: BuilderTrack[]): OrderSuggestionResult {
  const original = [...tracks];
  if (original.length <= 1) return { order: original, changed: false, movedCount: 0 };

  const remaining = original.map((t, i) => ({ t, i }));
  const result: BuilderTrack[] = [];

  // 시작: penalized/blocked 가 아닌 것 중 원래 순서상 첫 곡.
  const cost = (t: BuilderTrack, prev: BuilderTrack | null): number => {
    let c = 0;
    if (t.guardrailBlocked || t.fitStatus === 'excluded') c += 1000;
    if (t.guardrailPenalty > 0 || t.fitStatus === 'review_needed') c += 100;
    if (prev) {
      if (prev.artist && t.artist && prev.artist === t.artist) c += 50;
      if (prev.genre && t.genre && prev.genre === t.genre) c += 20;
      if (isNum(prev.bpm) && isNum(t.bpm)) c += Math.min(20, Math.abs(prev.bpm - t.bpm) / 4);
      if (isNum(prev.energyLevel) && isNum(t.energyLevel)) c += Math.abs(prev.energyLevel - t.energyLevel) * 3;
      if (isVocalTrack(prev) === true && isVocalTrack(t) === true) c += 10;
    }
    return c;
  };

  let prev: BuilderTrack | null = null;
  while (remaining.length > 0) {
    let bestPos = 0;
    let bestCost = Infinity;
    for (let k = 0; k < remaining.length; k++) {
      const c = cost(remaining[k].t, prev);
      // tie-break: 낮은 원래 인덱스 우선 (결정론적, randomness 없음)
      if (c < bestCost - 1e-9 || (Math.abs(c - bestCost) <= 1e-9 && remaining[k].i < remaining[bestPos].i)) {
        bestCost = c;
        bestPos = k;
      }
    }
    const chosen = remaining.splice(bestPos, 1)[0];
    result.push(chosen.t);
    prev = chosen.t;
  }

  let moved = 0;
  for (let i = 0; i < result.length; i++) {
    if (result[i].track_id !== original[i].track_id) moved++;
  }
  return { order: result, changed: moved > 0, movedCount: moved };
}

/** 두 순서(트랙 배열)가 동일한지(id 순서 비교). */
export function sameOrder(a: { track_id: string }[], b: { track_id: string }[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i].track_id !== b[i].track_id) return false;
  return true;
}

/** 저장 payload(admin_save_playlist_tracks)용 순서 보존·중복 제거된 track_id 목록. */
export function toSaveTrackIds(tracks: { track_id: string }[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tracks) {
    if (!t.track_id || seen.has(t.track_id)) continue;
    seen.add(t.track_id);
    out.push(t.track_id);
  }
  return out;
}

/** 복제 시 기본 제목 제안: "제목" → "제목 (사본)", 이미 (사본)이면 (사본 2), (사본 3)… */
export function suggestCloneTitle(title: string | null | undefined): string {
  const base = (title ?? '').trim() || '제목 없음';
  const m = base.match(/^(.*?) \(사본(?: (\d+))?\)$/);
  if (m) {
    const n = m[2] ? parseInt(m[2], 10) + 1 : 2;
    return `${m[1]} (사본 ${n})`;
  }
  return `${base} (사본)`;
}

// =============================================================================
// Mapping — merge existing RPC/table shapes into BuilderTrack (no new fields)
// =============================================================================

/** list_admin_tracks_with_ai / tracks 행의 최소 형태(피처 포함). */
export interface AdminTrackLike {
  id: string;
  title?: string | null;
  artist?: string | null;
  main_genre?: string | null;
  genre?: string | null;
  mood?: string | null;
  bpm?: number | null;
  energy_level?: number | null;
  vocal_presence?: number | null;
  instrumental?: boolean | null;
  explicit_content?: boolean | null;
  duration?: number | null;
  cover_url?: string | null;
  audio_url?: string | null;
  audio_sha256?: string | null;
}

/** admin_ai_learning_dashboard 의 tracks[] 행(0465). */
export interface DashboardTrackLike {
  track_id: string;
  fit_score?: number | null;
  reaction_score?: number | null;
  adaptive_score_live?: number | null;
  adaptive_score_applied?: number | null;
  difference?: number | null;
  completion_rate?: number | null;
  skip_rate?: number | null;
  sample_count?: number | null;
  learning_status?: string | null;
}

/** candidate pool 의 tracks[] 행(0463/0465). */
export interface CandidatePoolLike {
  track_id: string;
  fit_score?: number | null;
  adaptive_score?: number | null;
  fit_status?: string | null;
  guardrail_blocked?: boolean | null;
  guardrail_penalty?: number | null;
  guardrail_severity?: string | null;
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** tracks/admin-track 행 → BuilderTrack(점수 필드는 아직 비어있음). */
export function mapAdminTrack(row: AdminTrackLike, alreadyInPlaylist = false): BuilderTrack {
  return {
    track_id: row.id,
    title: row.title ?? null,
    artist: row.artist ?? null,
    genre: row.main_genre ?? row.genre ?? null,
    mood: row.mood ?? null,
    bpm: num(row.bpm),
    energyLevel: num(row.energy_level),
    vocalPresence: num(row.vocal_presence),
    instrumental: typeof row.instrumental === 'boolean' ? row.instrumental : null,
    explicit: typeof row.explicit_content === 'boolean' ? row.explicit_content : null,
    duration: num(row.duration),
    coverUrl: row.cover_url ?? null,
    audioUrl: row.audio_url ?? null,
    audioHash: row.audio_sha256 ?? null,
    fitScore: null,
    fitStatus: null,
    adaptiveScore: null,
    reactionScore: null,
    difference: null,
    completionRate: null,
    skipRate: null,
    sampleCount: null,
    learningStatus: null,
    guardrailBlocked: false,
    guardrailPenalty: 0,
    guardrailSeverity: null,
    alreadyInPlaylist,
  };
}

/** learning dashboard 행을 BuilderTrack 에 병합(있는 값만 덮어씀). */
export function enrichWithDashboard(tracks: BuilderTrack[], rows: DashboardTrackLike[]): BuilderTrack[] {
  const byId = new Map(rows.map((r) => [r.track_id, r]));
  return tracks.map((t) => {
    const d = byId.get(t.track_id);
    if (!d) return t;
    return {
      ...t,
      fitScore: num(d.fit_score) ?? t.fitScore,
      reactionScore: num(d.reaction_score) ?? t.reactionScore,
      adaptiveScore: num(d.adaptive_score_live) ?? t.adaptiveScore,
      difference: num(d.difference) ?? t.difference,
      completionRate: num(d.completion_rate) ?? t.completionRate,
      skipRate: num(d.skip_rate) ?? t.skipRate,
      sampleCount: num(d.sample_count) ?? t.sampleCount,
      learningStatus: d.learning_status ?? t.learningStatus,
    };
  });
}

/** candidate pool 행을 BuilderTrack 에 병합(fit/guardrail/adaptive). */
export function enrichWithCandidatePool(tracks: BuilderTrack[], rows: CandidatePoolLike[]): BuilderTrack[] {
  const byId = new Map(rows.map((r) => [r.track_id, r]));
  return tracks.map((t) => {
    const c = byId.get(t.track_id);
    if (!c) return t;
    return {
      ...t,
      fitScore: num(c.fit_score) ?? t.fitScore,
      fitStatus: c.fit_status ?? t.fitStatus,
      adaptiveScore: num(c.adaptive_score) ?? t.adaptiveScore,
      guardrailBlocked: c.guardrail_blocked === true || t.guardrailBlocked,
      guardrailPenalty: num(c.guardrail_penalty) ?? t.guardrailPenalty,
      guardrailSeverity: c.guardrail_severity ?? t.guardrailSeverity,
    };
  });
}

/** 현재 플레이리스트에 포함된 track_id 집합으로 alreadyInPlaylist 표시. */
export function markAlreadyIn(tracks: BuilderTrack[], playlistTrackIds: Iterable<string>): BuilderTrack[] {
  const set = playlistTrackIds instanceof Set ? playlistTrackIds : new Set(playlistTrackIds);
  return tracks.map((t) => (t.alreadyInPlaylist === set.has(t.track_id) ? t : { ...t, alreadyInPlaylist: set.has(t.track_id) }));
}
