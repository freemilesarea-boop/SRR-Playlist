/**
 * playlistGenerator — AI Playlist Generator & Multi-Dimensional Curation (Phase AI-PLAYLIST-4).
 *
 * 실제 Track 메타데이터(main_genre·mood·bpm·duration·artist)와 재생 KPI 로 성과가 높은
 * Playlist 초안을 생성한다. **AI 가 음악 취향을 임의 생성하지 않는다** — 업종 프로필과
 * 실제 메타데이터/KPI 매칭으로만 판단하고, 모든 선택/제외에 Evidence 를 남긴다.
 * 생성은 Draft 이며 **자동 Publish 없음**(단위 테스트 대상).
 *
 * 원칙: Evidence 없는 Track 선택 금지 · 존재하는 데이터만(bpm null 은 신호 제외) ·
 * Compatibility/Fatigue 0~100 · NaN/Infinity 금지 · Diversity/Freshness/Fatigue Guard.
 */

/* ── Track / 입력 ─────────────────────────────────────────────────── */
export interface PoolTrack {
  track_id: string; title: string | null; artist: string | null;
  main_genre: string | null; mood: string | null; bpm: number | null; duration: number | null; language: string | null;
  events: number; skip_rate: number | null; completion_rate: number | null; likes: number; replays: number;
  last_event_at: string | null; store_coverage: number | null; rollout_stage: string | null;
}

const isNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const clamp100 = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();

/* ── 업종 프로필(실제 genre/mood 값 기반; 취향 추측 아님) ───────────────── */
export interface IndustryProfile { key: string; label: string; genres: string[]; moods: string[]; bpmMin: number; bpmMax: number }
export const INDUSTRY_PROFILES: Record<string, IndustryProfile> = {
  cafe:      { key: 'cafe', label: '카페', genres: ['lo-fi', 'jazz', 'acoustic', 'r&b', 'indie pop', 'ballad'], moods: ['차분한', '따뜻한', '편안한'], bpmMin: 60, bpmMax: 100 },
  hospital:  { key: 'hospital', label: '병원', genres: ['classical', 'piano', 'ambient', 'ballad'], moods: ['차분한', '편안한'], bpmMin: 50, bpmMax: 90 },
  studycafe: { key: 'studycafe', label: '스터디카페', genres: ['lo-fi', 'piano', 'ambient', 'jazz'], moods: ['차분한', '집중'], bpmMin: 60, bpmMax: 95 },
  hotel:     { key: 'hotel', label: '호텔', genres: ['jazz', 'bossa nova', 'lounge', 'r&b'], moods: ['우아한', '따뜻한'], bpmMin: 60, bpmMax: 110 },
  winebar:   { key: 'winebar', label: '와인바', genres: ['jazz', 'r&b', 'soul', 'bossa nova'], moods: ['몽환적', '따뜻한'], bpmMin: 70, bpmMax: 115 },
  pub:       { key: 'pub', label: '펍', genres: ['rock', 'pop', 'hip-hop', 'funk'], moods: ['신나는', '경쾌한'], bpmMin: 100, bpmMax: 140 },
  gym:       { key: 'gym', label: '헬스장', genres: ['edm', 'hip-hop', 'pop', 'dance'], moods: ['신나는', '강렬한'], bpmMin: 120, bpmMax: 165 },
  office:    { key: 'office', label: '사무실', genres: ['lo-fi', 'acoustic', 'ambient', 'jazz'], moods: ['차분한', '집중'], bpmMin: 60, bpmMax: 100 },
  restaurant:{ key: 'restaurant', label: '식당', genres: ['jazz', 'bossa nova', 'acoustic', 'pop'], moods: ['따뜻한', '차분한'], bpmMin: 70, bpmMax: 110 },
};
export function getProfile(key: string | null | undefined): IndustryProfile | null { return key ? INDUSTRY_PROFILES[key] ?? null : null; }

/* ── Track Compatibility (업종 적합도) ───────────────────────────────── */
export interface CompatSignal { key: string; label: string; value: string | number | null; match: number; weight: number; present: boolean }
export interface Compatibility { score: number; signals: CompatSignal[]; summary: string }

/**
 * 업종 적합도 0~100. 존재하는 신호만 가중 평균(bpm null 은 제외 — 추정 없음).
 * genre 0.4 · mood 0.25 · bpm 0.15 · completion 0.2.
 */
export function computeCompatibility(t: PoolTrack, profile: IndustryProfile): Compatibility {
  const genrePresent = !!t.main_genre;
  const genreMatch = genrePresent ? (profile.genres.includes(norm(t.main_genre)) ? 1 : profile.genres.some((g) => norm(t.main_genre).includes(g) || g.includes(norm(t.main_genre))) ? 0.4 : 0) : 0;
  const moodPresent = !!t.mood;
  const moodMatch = moodPresent ? (profile.moods.includes((t.mood ?? '').trim()) ? 1 : 0) : 0;
  const bpmPresent = isNum(t.bpm) && t.bpm > 0;
  const bpmMatch = bpmPresent ? (t.bpm! >= profile.bpmMin && t.bpm! <= profile.bpmMax ? 1 : Math.max(0, 1 - Math.min(Math.abs(t.bpm! - profile.bpmMin), Math.abs(t.bpm! - profile.bpmMax)) / 40)) : 0;
  const compPresent = isNum(t.completion_rate);
  const compMatch = compPresent ? clamp01((t.completion_rate as number) / 100) : 0;

  const signals: CompatSignal[] = [
    { key: 'genre', label: '장르', value: t.main_genre, match: genreMatch, weight: 0.4, present: genrePresent },
    { key: 'mood', label: '무드', value: t.mood, match: moodMatch, weight: 0.25, present: moodPresent },
    { key: 'bpm', label: 'BPM', value: t.bpm, match: bpmMatch, weight: 0.15, present: bpmPresent },
    { key: 'completion', label: '완주율', value: t.completion_rate, match: compMatch, weight: 0.2, present: compPresent },
  ];
  const present = signals.filter((s) => s.present);
  const wsum = present.reduce((s, x) => s + x.weight, 0);
  const score = wsum > 0 ? clamp100((present.reduce((s, x) => s + x.match * x.weight, 0) / wsum) * 100) : 0;
  const summary = present.length === 0 ? '메타데이터 없음' : `${profile.label} 적합 ${score} (${present.map((s) => s.label).join('·')} 기준)`;
  return { score, signals, summary };
}

/* ── Fatigue Guard (피로도) ──────────────────────────────────────────── */
export const FATIGUE_EVENT_CAP = 80;   // 이 이상 재생이면 피로 최대에 근접
/** 재생 빈도 + 최근성 → 0~100. 높을수록 과다 노출(생성 제외 후보). */
export function fatigueScore(t: PoolTrack, nowMs: number): number {
  const freq = clamp01(t.events / FATIGUE_EVENT_CAP);
  let recency = 0;
  if (t.last_event_at) {
    const last = Date.parse(t.last_event_at);
    if (Number.isFinite(last)) {
      const days = (nowMs - last) / 86400e3;
      recency = days <= 1 ? 1 : days <= 3 ? 0.6 : days <= 7 ? 0.3 : 0;
    }
  }
  return clamp100((freq * 0.6 + recency * 0.4) * 100);
}

/* ── Freshness Budget ────────────────────────────────────────────────── */
export type FreshBucket = 'verified' | 'test_pool' | 'promoted' | 'longterm';
export interface FreshnessBudget { verified: number; test_pool: number; promoted: number; longterm: number }
export const DEFAULT_BUDGET: FreshnessBudget = { verified: 0.6, test_pool: 0.2, promoted: 0.1, longterm: 0.1 };

export function trackBucket(t: PoolTrack): FreshBucket {
  const s = t.rollout_stage;
  if (s === 'global' || s === 'expanded') return 'verified';
  if (s === 'test_pool' || s === 'pilot' || s === 'draft') return 'test_pool';
  if (s === 'limited') return 'promoted';
  return t.events >= 20 ? 'verified' : 'longterm'; // rollout 없음: 검증량 많으면 verified, 아니면 longterm
}

/* ── Diversity Guard ─────────────────────────────────────────────────── */
export interface DiversityConfig { maxConsecutiveArtist: number; maxArtistShare: number; maxGenreShare: number; maxMoodShare: number }
export const DEFAULT_DIVERSITY: DiversityConfig = { maxConsecutiveArtist: 1, maxArtistShare: 0.3, maxGenreShare: 0.5, maxMoodShare: 0.5 };

/** 선택된 리스트가 diversity 규칙을 위반하는지(위반 항목 반환). */
export function checkDiversity(tracks: PoolTrack[], cfg: DiversityConfig = DEFAULT_DIVERSITY): string[] {
  const violations: string[] = [];
  const n = tracks.length;
  if (n === 0) return violations;
  // 연속 동일 아티스트
  let run = 1;
  for (let i = 1; i < n; i++) {
    if (norm(tracks[i].artist) && norm(tracks[i].artist) === norm(tracks[i - 1].artist)) { run++; if (run > cfg.maxConsecutiveArtist) violations.push(`동일 아티스트 연속(${tracks[i].artist})`); } else run = 1;
  }
  const share = (fn: (t: PoolTrack) => string, cap: number, label: string) => {
    const counts = new Map<string, number>();
    for (const t of tracks) { const k = fn(t); if (k) counts.set(k, (counts.get(k) ?? 0) + 1); }
    for (const [k, v] of counts) if (v / n > cap) violations.push(`${label} 편중(${k} ${Math.round((v / n) * 100)}%)`);
  };
  share((t) => norm(t.artist), cfg.maxArtistShare, '아티스트');
  share((t) => norm(t.main_genre), cfg.maxGenreShare, '장르');
  share((t) => (t.mood ?? '').trim(), cfg.maxMoodShare, '무드');
  return [...new Set(violations)];
}

/* ── Generator ───────────────────────────────────────────────────────── */
export interface GeneratorConfig {
  storeType: string; targetCount: number; minCompatibility: number; maxFatigue: number;
  budget?: FreshnessBudget; diversity?: DiversityConfig;
}
export interface SelectedTrack { track: PoolTrack; compatibility: number; fatigue: number; bucket: FreshBucket; reason: string }
export interface ExcludedTrack { track: PoolTrack; reason: string }
export interface GenerateResult { selected: SelectedTrack[]; excluded: ExcludedTrack[]; profile: IndustryProfile | null }

/** Draft 생성. 적합도/피로도/Freshness/Diversity 를 적용해 순서화된 후보 + 제외 사유. */
export function generateDraft(pool: PoolTrack[], config: GeneratorConfig, nowMs: number): GenerateResult {
  const profile = getProfile(config.storeType);
  if (!profile) return { selected: [], excluded: [], profile: null };
  const budget = config.budget ?? DEFAULT_BUDGET;
  const diversity = config.diversity ?? DEFAULT_DIVERSITY;
  const target = Math.max(1, Math.min(config.targetCount, 100));

  const excluded: ExcludedTrack[] = [];
  const scored = pool.map((t) => {
    const c = computeCompatibility(t, profile);
    const f = fatigueScore(t, nowMs);
    return { track: t, compatibility: c.score, fatigue: f, bucket: trackBucket(t), signals: c.signals };
  });

  // 1차 필터: 적합도/피로도.
  const eligible = scored.filter((s) => {
    if (s.compatibility < config.minCompatibility) { excluded.push({ track: s.track, reason: `적합도 미달(${s.compatibility}<${config.minCompatibility})` }); return false; }
    if (s.fatigue > config.maxFatigue) { excluded.push({ track: s.track, reason: `피로도 초과(${s.fatigue}>${config.maxFatigue})` }); return false; }
    return true;
  });

  // 버킷별 정렬(적합도 desc).
  const byBucket: Record<FreshBucket, typeof eligible> = { verified: [], test_pool: [], promoted: [], longterm: [] };
  for (const s of eligible) byBucket[s.bucket].push(s);
  (Object.keys(byBucket) as FreshBucket[]).forEach((b) => byBucket[b].sort((a, z) => z.compatibility - a.compatibility));

  const quota: Record<FreshBucket, number> = {
    verified: Math.round(target * budget.verified), test_pool: Math.round(target * budget.test_pool),
    promoted: Math.round(target * budget.promoted), longterm: Math.round(target * budget.longterm),
  };

  const selected: SelectedTrack[] = [];
  const artistCount = new Map<string, number>(); const genreCount = new Map<string, number>(); const moodCount = new Map<string, number>();
  const canAdd = (t: PoolTrack): boolean => {
    if (selected.length > 0 && norm(t.artist) && norm(selected[selected.length - 1].track.artist) === norm(t.artist)) return false; // 연속 아티스트
    const cap = (m: Map<string, number>, k: string, share: number) => !k || (m.get(k) ?? 0) + 1 <= Math.ceil(target * share);
    return cap(artistCount, norm(t.artist), diversity.maxArtistShare) && cap(genreCount, norm(t.main_genre), diversity.maxGenreShare) && cap(moodCount, (t.mood ?? '').trim(), diversity.maxMoodShare);
  };
  const commit = (s: typeof eligible[number], bucket: FreshBucket) => {
    selected.push({ track: s.track, compatibility: s.compatibility, fatigue: s.fatigue, bucket, reason: `${INDUSTRY_PROFILES[config.storeType].label} 적합 ${s.compatibility} · 피로 ${s.fatigue} · ${bucket}` });
    const inc = (m: Map<string, number>, k: string) => { if (k) m.set(k, (m.get(k) ?? 0) + 1); };
    inc(artistCount, norm(s.track.artist)); inc(genreCount, norm(s.track.main_genre)); inc(moodCount, (s.track.mood ?? '').trim());
  };

  // 버킷 quota 우선 채움.
  const order: FreshBucket[] = ['verified', 'test_pool', 'promoted', 'longterm'];
  for (const b of order) {
    for (const s of byBucket[b]) {
      if (selected.length >= target) break;
      if (selected.filter((x) => x.bucket === b).length >= quota[b]) break;
      if (canAdd(s.track)) commit(s, b);
    }
  }
  // 부족분은 전체 적합도 순으로 채움(quota 미달 보완).
  if (selected.length < target) {
    const rest = eligible.filter((s) => !selected.some((x) => x.track.track_id === s.track.track_id)).sort((a, z) => z.compatibility - a.compatibility);
    for (const s of rest) { if (selected.length >= target) break; if (canAdd(s.track)) commit(s, s.bucket); }
  }
  return { selected, excluded, profile };
}

/* ── Simulation (실측 기반 추정) ─────────────────────────────────────── */
export interface SimulationResult {
  trackCount: number; diversity: number; freshness: number; avgCompletion: number | null; skipRisk: number | null;
  genreCoverage: number; artistCoverage: number; bucketMix: Record<FreshBucket, number>;
}
export function simulateDraft(selected: SelectedTrack[]): SimulationResult {
  const n = selected.length;
  if (n === 0) return { trackCount: 0, diversity: 0, freshness: 0, avgCompletion: null, skipRisk: null, genreCoverage: 0, artistCoverage: 0, bucketMix: { verified: 0, test_pool: 0, promoted: 0, longterm: 0 } };
  const artists = new Set(selected.map((s) => norm(s.track.artist)).filter(Boolean));
  const genres = new Set(selected.map((s) => norm(s.track.main_genre)).filter(Boolean));
  const moods = new Set(selected.map((s) => (s.track.mood ?? '').trim()).filter(Boolean));
  const diversity = clamp100(((artists.size / n) * 0.4 + (genres.size / n) * 0.3 + (moods.size / n) * 0.3) * 100);
  const fresh = selected.filter((s) => s.bucket !== 'verified' && s.bucket !== 'longterm').length;
  const freshness = clamp100((fresh / n) * 100);
  const comps = selected.map((s) => s.track.completion_rate).filter(isNum) as number[];
  const skips = selected.map((s) => s.track.skip_rate).filter(isNum) as number[];
  const bucketMix: Record<FreshBucket, number> = { verified: 0, test_pool: 0, promoted: 0, longterm: 0 };
  for (const s of selected) bucketMix[s.bucket] += 1;
  return {
    trackCount: n, diversity, freshness,
    avgCompletion: comps.length ? Math.round((comps.reduce((a, b) => a + b, 0) / comps.length) * 10) / 10 : null,
    skipRisk: skips.length ? Math.round((skips.reduce((a, b) => a + b, 0) / skips.length) * 10) / 10 : null,
    genreCoverage: genres.size, artistCoverage: artists.size, bucketMix,
  };
}

/* ── 표시 헬퍼 ────────────────────────────────────────────────────── */
export const BUCKET_LABEL: Record<FreshBucket, string> = { verified: '검증', test_pool: 'Test Pool', promoted: '승격', longterm: 'Long-term' };
/** 지원 불가 메타데이터(실제 컬럼 부재). */
export const UNSUPPORTED_METADATA = ['key(음정)', 'vocal 여부', 'explicit'];
