/**
 * contextIntel — Context Intelligence Engine 순수 로직 (Phase AI-MUSIC-2).
 *
 * 성과를 단일 업종/Track 이 아니라 **상황(Context) 조합**(Store Type · Daypart · Weekday Group)
 * 기준으로 학습한다. 각 Context 에서 어떤 Track/Playlist/Genre/Mood 가 실제 KPI 성과가 좋은지
 * 분석하고, Context Score/Health/Confidence/Recommendation/Comparison/Trend 를 계산한다.
 *
 * 원칙:
 *  - 지원되는 Dimension 만 Context Key 에 포함(미지원 = 제외, 추정 금지).
 *  - 표본 부족 Context 는 상위 Grain 으로 fallback(기록).
 *  - Score/Health/Confidence/Completion/Skip 0~100 clamp · NaN/Infinity 금지.
 *  - Evidence 없는 추천 금지. 자동 Playlist/Scheduler/Queue/Track 변경 없음(분석·추천만).
 *  - 기존 Track/Playlist Intelligence 점수 정의 재사용(중복 Health 모델 지양).
 */
import { clampPct, MIN_EVENTS } from './playlistIntel';
import { scoreBreakdown, MIN_BREAKDOWN_EVENTS, type Breakdown, type ScoreRow } from './trackIntel';

const isNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const clamp100 = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

/* ── Dimension 지원 상태(Support Matrix) ─────────────────────────────────── */
export type SupportStatus = 'supported' | 'partially_supported' | 'unsupported' | 'insufficient_data';
export interface DimensionSupport { key: string; label: string; status: SupportStatus; note: string }

/** 실제 DB 재확인 결과. Context Key 는 supported 만 사용한다. */
export const SUPPORT_MATRIX: DimensionSupport[] = [
  { key: 'store_type', label: 'Industry / Store Type', status: 'supported', note: 'playback_events_v2.store_type_slug (10종)' },
  { key: 'daypart', label: 'Daypart', status: 'supported', note: 'created_at KST → _playlist_time_band' },
  { key: 'weekday_group', label: 'Weekday / Weekend', status: 'supported', note: 'created_at KST isodow' },
  { key: 'weekday', label: 'Individual Weekday', status: 'partially_supported', note: '일부 요일 표본 부족(예: 일요일) → weekday_group 권장' },
  { key: 'season', label: 'Season', status: 'insufficient_data', note: '데이터가 단일 계절만 존재 → 비교 불가, 범위만 표시' },
  { key: 'individual_store', label: 'Individual Store', status: 'unsupported', note: 'business_id 100% NULL · store_id 없음' },
  { key: 'brand', label: 'Brand', status: 'unsupported', note: '재생 이벤트-브랜드 연결 없음(business_id NULL)' },
  { key: 'region', label: 'Region', status: 'unsupported', note: '재생 이벤트에 region 없음' },
  { key: 'weather', label: 'Weather / Temp / Humidity', status: 'unsupported', note: '날씨 History 없음' },
  { key: 'event', label: 'Holiday / Event', status: 'unsupported', note: '이벤트 성과 데이터 없음' },
  { key: 'track', label: 'Track (분석)', status: 'supported', note: 'track_id · tracks 메타' },
  { key: 'playlist', label: 'Playlist (분석)', status: 'supported', note: 'playlist_id' },
  { key: 'genre', label: 'Genre (분석)', status: 'supported', note: 'tracks.main_genre (100%)' },
  { key: 'mood', label: 'Mood (분석)', status: 'supported', note: 'tracks.mood (100%)' },
  { key: 'language', label: 'Language (분석)', status: 'partially_supported', note: 'tracks.language (~99%) · DNA 참고용' },
  { key: 'bpm', label: 'BPM', status: 'unsupported', note: 'tracks.bpm 100% NULL' },
  { key: 'rollout_stage', label: 'Rollout Stage', status: 'supported', note: 'track_rollouts.stage' },
];

export function dimensionSupported(key: string): boolean {
  return SUPPORT_MATRIX.find((d) => d.key === key)?.status === 'supported';
}

/* ── Context Key (지원 Dimension 만, 고정 순서, locale 무관) ───────────────── */
export const DAYPART_SLUG: Record<string, string> = {
  '새벽': 'dawn', '아침': 'morning', '점심': 'lunch', '오후': 'afternoon', '저녁': 'evening', '심야': 'night',
};
export interface ContextDims { store_type?: string | null; daypart?: string | null; weekday_group?: string | null }

/** 지원 Dimension 만 고정 순서(store_type→daypart→weekday)로 조합. null/미지원 제외. */
export function buildContextKey(dims: ContextDims): string {
  const parts: string[] = [];
  if (dims.store_type) parts.push(`store_type=${dims.store_type}`);
  const dp = dims.daypart ? (DAYPART_SLUG[dims.daypart] ?? null) : null;
  if (dp) parts.push(`daypart=${dp}`);
  if (dims.weekday_group === 'weekday' || dims.weekday_group === 'weekend') parts.push(`weekday=${dims.weekday_group}`);
  return parts.join('|');
}

/* ── Grain (Level 1~3 활성 · Level 4 season 은 단일 계절로 비활성) ─────────── */
export type Grain = 'L1' | 'L2' | 'L3';
export interface GrainDef { level: Grain; label: string; dims: string[] }
export const GRAIN_LEVELS: GrainDef[] = [
  { level: 'L1', label: 'Store Type', dims: ['store_type'] },
  { level: 'L2', label: 'Store Type + Daypart', dims: ['store_type', 'daypart'] },
  { level: 'L3', label: 'Store Type + Daypart + Weekday', dims: ['store_type', 'daypart', 'weekday_group'] },
];

export interface CandidateSamples { l1: number; l2: number; l3: number }
export interface GrainResolution { grain: Grain; daypart: string | null; weekday_group: string | null; fallback: boolean; sample: number }

/**
 * 요청 Dimension + 후보 표본으로 가장 세분화된 유효 Grain 을 결정(표본 >= min). 부족하면 상위로
 * fallback. SQL 해석과 동일 규칙(단위 테스트 대상). fallback = 요청보다 얕은 Grain 으로 내려간 경우.
 */
export function resolveGrain(req: ContextDims, samples: CandidateSamples, min: number = MIN_EVENTS): GrainResolution {
  const reqDp = req.daypart ? (DAYPART_SLUG[req.daypart] ? req.daypart : null) : null;
  const reqWg = req.weekday_group === 'weekday' || req.weekday_group === 'weekend' ? req.weekday_group : null;
  if (reqDp && reqWg && samples.l3 >= min) return { grain: 'L3', daypart: reqDp, weekday_group: reqWg, fallback: false, sample: samples.l3 };
  if (reqDp && samples.l2 >= min) return { grain: 'L2', daypart: reqDp, weekday_group: null, fallback: !!reqWg, sample: samples.l2 };
  return { grain: 'L1', daypart: null, weekday_group: null, fallback: !!(reqDp || reqWg), sample: samples.l1 };
}

/* ── Sample 신뢰도 ──────────────────────────────────────────────────────── */
export type SampleTier = 'insufficient' | 'low' | 'medium' | 'high';
export const SAMPLE_TIERS = { insufficient: 20, medium: 50, high: 200 } as const;
export function sampleTier(n: number): SampleTier {
  if (!isNum(n) || n < SAMPLE_TIERS.insufficient) return 'insufficient';
  if (n < SAMPLE_TIERS.medium) return 'low';
  if (n < SAMPLE_TIERS.high) return 'medium';
  return 'high';
}
/** 표본 신뢰도 0~100(포화 200 이벤트). */
export function sampleConfidence(n: number): number {
  return clamp100(clamp01((isNum(n) ? n : 0) / SAMPLE_TIERS.high) * 100);
}

/* ── Context KPI 요약(admin_context_detail.summary) ──────────────────────── */
export interface ContextSummary {
  events: number; track_count: number; playlist_count: number; genre_count: number; mood_count: number;
  unknown_genre_events: number; completion_rate: number | null; skip_rate: number | null;
  avg_listen_seconds: number | null; likes: number; replays: number;
  last_event_at: string | null; days_since_last: number | null;
}

/* ── Context Score / Health(0~100) ─────────────────────────────────────────
 * 기존 KPI 정의 재사용(완주율·Skip역·Diversity·Coverage·Freshness). 존재 성분만 재정규화.
 * Avg Listening Duration 은 비임의 정규화 기준이 없어 Score 성분에서 제외(표시·비교에만 사용).
 * Context Health 는 별도 모델이 아니라 Context Score 합성값 + (선택)Track/Playlist Score 평균.
 * ------------------------------------------------------------------------- */
export const SCORE_WEIGHTS = { completion: 0.3, skip: 0.25, diversity: 0.15, coverage: 0.15, freshness: 0.15 };
export interface ScoreComponent { key: string; label: string; value: number; present: boolean }
export interface ContextScoreResult { score: number; confidence: number; components: ScoreComponent[] }

function diversityScore(s: ContextSummary): number {
  if (s.events <= 0) return 0;
  const uniqTrackRatio = clamp01(s.track_count / s.events);
  const genreDiv = clamp01(s.genre_count / 8);
  const moodDiv = clamp01(s.mood_count / 6);
  return clamp100((uniqTrackRatio * 0.5 + genreDiv * 0.3 + moodDiv * 0.2) * 100);
}
function coverageScore(s: ContextSummary): number {
  return clamp100((clamp01(Math.min(s.track_count, 50) / 50) * 0.6 + clamp01(Math.min(s.playlist_count, 3) / 3) * 0.4) * 100);
}

export function computeContextScore(s: ContextSummary): ContextScoreResult {
  const comp = clampPct(s.completion_rate);
  const skip = clampPct(s.skip_rate);
  const freshness = isNum(s.days_since_last) ? clamp100(100 - s.days_since_last * 3) : null;
  const components: Array<ScoreComponent & { weight: number }> = [
    { key: 'completion', label: '완주율', weight: SCORE_WEIGHTS.completion, value: comp ?? 0, present: comp != null },
    { key: 'skip', label: 'Skip(역)', weight: SCORE_WEIGHTS.skip, value: skip != null ? 100 - skip : 0, present: skip != null },
    { key: 'diversity', label: 'Diversity', weight: SCORE_WEIGHTS.diversity, value: diversityScore(s), present: s.events > 0 },
    { key: 'coverage', label: 'Coverage', weight: SCORE_WEIGHTS.coverage, value: coverageScore(s), present: s.events > 0 },
    { key: 'freshness', label: 'Freshness', weight: SCORE_WEIGHTS.freshness, value: freshness ?? 0, present: freshness != null },
  ];
  const present = components.filter((c) => c.present);
  const wsum = present.reduce((a, c) => a + c.weight, 0);
  const score = wsum > 0 ? clamp100(present.reduce((a, c) => a + c.value * c.weight, 0) / wsum) : 0;
  const metaCov = s.events > 0 ? clamp01(1 - s.unknown_genre_events / s.events) : 0;
  const confidence = clamp100((sampleConfidence(s.events) * 0.6 + metaCov * 100 * 0.2 + (present.length / components.length) * 100 * 0.2));
  return { score, confidence, components: components.map((c) => ({ key: c.key, label: c.label, value: Math.round(c.value), present: c.present })) };
}

export type ContextHealthStatus = 'healthy' | 'watch' | 'weak' | 'insufficient_data';
export interface ContextHealthResult extends ContextScoreResult { status: ContextHealthStatus }

/** Context Health = Context Score 합성 + (선택)Track/Playlist Score 평균 블렌드. 표본 부족이면 insufficient_data. */
export function computeContextHealth(s: ContextSummary, opts: { trackScoreAvg?: number | null; playlistScoreAvg?: number | null } = {}): ContextHealthResult {
  const base = computeContextScore(s);
  const blends: number[] = [base.score];
  if (isNum(opts.trackScoreAvg)) blends.push(clamp100(opts.trackScoreAvg));
  if (isNum(opts.playlistScoreAvg)) blends.push(clamp100(opts.playlistScoreAvg));
  const score = clamp100(blends.reduce((a, b) => a + b, 0) / blends.length);
  let status: ContextHealthStatus;
  if (s.events < SAMPLE_TIERS.insufficient) status = 'insufficient_data';
  else if (score >= 70) status = 'healthy';
  else if (score >= 50) status = 'watch';
  else status = 'weak';
  return { ...base, score, status };
}

/* ── Track / Playlist / Genre / Mood 랭킹(기존 scoreBreakdown 재사용) ──────── */
export interface ContextRankRow { key: string; label: string; events: number; completion_rate: number | null; skip_rate: number | null }
export interface RankedRow extends ScoreRow { label: string }

/** rows → scoreBreakdown(완주율 0.7 + Skip역 0.3, 표본 부족 미지원) + 라벨 유지. */
export function rankContextItems(rows: ContextRankRow[]): RankedRow[] {
  const bd: Breakdown[] = rows.map((r) => ({ key: r.key, events: r.events, completion_rate: r.completion_rate, skip_rate: r.skip_rate }));
  const scored = scoreBreakdown(bd);
  const labelOf = new Map(rows.map((r) => [r.key, r.label]));
  return scored.map((sc) => ({ ...sc, label: labelOf.get(sc.key) ?? sc.key }));
}

export interface GenreMoodRow { key: string; is_unknown: boolean; events: number; completion_rate: number | null; skip_rate: number | null }
export interface GenreMoodResult {
  top: RankedRow[]; low: RankedRow[]; unknown: GenreMoodRow | null; insufficient: GenreMoodRow[];
}
/** unknown 분리 · 표본 부족 분리 · 완주율 기준 상/하위. 추정 금지(unknown 은 순위 제외). */
export function rankGenreMood(rows: GenreMoodRow[]): GenreMoodResult {
  const unknown = rows.find((r) => r.is_unknown) ?? null;
  const known = rows.filter((r) => !r.is_unknown);
  const insufficient = known.filter((r) => r.events < MIN_BREAKDOWN_EVENTS);
  const enough = known.filter((r) => r.events >= MIN_BREAKDOWN_EVENTS);
  const ranked = rankContextItems(enough.map((r) => ({ key: r.key, label: r.key, events: r.events, completion_rate: r.completion_rate, skip_rate: r.skip_rate })));
  return { top: ranked.slice(0, 5), low: [...ranked].reverse().slice(0, 5).filter((r) => (r.score ?? 0) < 55), unknown, insufficient };
}

/* ── Context Detail(전체 RPC 응답) ──────────────────────────────────────── */
export interface ContextTrackRow { track_id: string; title: string | null; artist: string | null; genre: string | null; mood: string | null; events: number; completion_rate: number | null; skip_rate: number | null; avg_listen_seconds: number | null; last_played_at: string | null }
export interface ContextPlaylistRow { playlist_id: string | null; title: string | null; events: number; unique_track_count: number; completion_rate: number | null; skip_rate: number | null; avg_listen_seconds: number | null }
export interface ContextBaseline { events: number; completion_rate: number | null; skip_rate: number | null; avg_listen_seconds: number | null }
export interface ContextDetail {
  store_type: string;
  requested: { daypart: string | null; weekday_group: string | null };
  resolved: { grain: Grain; daypart: string | null; weekday_group: string | null; fallback: boolean };
  candidate_samples: { l1: number; l2: number; l3: number; min_sample: number };
  range: string; summary: ContextSummary;
  tracks: ContextTrackRow[]; playlists: ContextPlaylistRow[];
  genres: GenreMoodRow[]; moods: GenreMoodRow[]; baseline: ContextBaseline;
  generated_at: string;
}

/* ── Recommendation(Evidence 기반, 자동 실행 없음) ────────────────────────── */
export type ContextRecoType =
  | 'top_track_expand' | 'low_track_reduce' | 'top_playlist' | 'playlist_experiment'
  | 'genre_ratio' | 'mood_ratio' | 'rediscovery' | 'new_track_test' | 'collect_sample';
export interface EvidenceItem { label: string; value: string | number | null }
export interface ContextReco {
  type: ContextRecoType; priority: 'high' | 'medium' | 'low'; title: string; reason: string;
  suggested_action: string; evidence: EvidenceItem[];
}

/**
 * Context KPI + Baseline 비교로 Evidence 기반 추천 생성. 비교 기준(표본/Baseline)이 있을 때만
 * 성과 추천을 만든다. 표본 부족이면 'collect_sample' 만. 자동 반영 없음.
 */
export function recommendContext(detail: ContextDetail): ContextReco[] {
  const out: ContextReco[] = [];
  const s = detail.summary;
  const key = buildContextKey({ store_type: detail.store_type, daypart: detail.resolved.daypart, weekday_group: detail.resolved.weekday_group });
  const base = detail.baseline;
  const period = detail.range;
  const dimsUsed = GRAIN_LEVELS.find((g) => g.level === detail.resolved.grain)?.dims.join(', ') ?? 'store_type';
  const commonEv = (extra: EvidenceItem[] = []): EvidenceItem[] => [
    { label: 'Context', value: key || detail.store_type },
    { label: 'Dimensions', value: dimsUsed },
    { label: 'Sample', value: s.events },
    { label: 'Context 완주율', value: s.completion_rate },
    { label: 'Context Skip', value: s.skip_rate },
    { label: 'Baseline 완주율', value: base?.completion_rate ?? null },
    { label: 'Confidence', value: computeContextScore(s).confidence },
    { label: '기간', value: period },
    { label: 'Source', value: 'admin_context_detail' },
    { label: 'Fallback', value: detail.resolved.fallback ? 'Y' : 'N' },
    ...extra,
  ];

  // 표본 부족 → 수집 권장만.
  if (s.events < MIN_EVENTS) {
    out.push({ type: 'collect_sample', priority: 'medium', title: 'Context 표본 추가 수집 권장',
      reason: `표본 ${s.events} (< ${MIN_EVENTS}) — 신뢰 가능한 Score/추천 생성 불가`,
      suggested_action: '해당 Context 재생 데이터 축적 후 재분석', evidence: commonEv() });
    return out;
  }

  const tracks = rankContextItems(detail.tracks.map((t) => ({ key: t.track_id, label: t.title ?? t.track_id, events: t.events, completion_rate: t.completion_rate, skip_rate: t.skip_rate })));
  const topTrack = tracks.find((t) => t.supported && (t.score ?? 0) >= 75);
  const lowTrack = [...tracks].reverse().find((t) => t.supported && (t.score ?? 100) < 45);
  const playlists = rankContextItems(detail.playlists.map((p) => ({ key: p.playlist_id ?? '(none)', label: p.title ?? '(untitled)', events: p.events, completion_rate: p.completion_rate, skip_rate: p.skip_rate })));
  const topPlaylist = playlists.find((p) => p.supported && (p.score ?? 0) >= 70);
  const compVsBase = isNum(clampPct(s.completion_rate)) && isNum(clampPct(base?.completion_rate)) ? (clampPct(s.completion_rate)! - clampPct(base!.completion_rate)!) : null;

  if (topTrack) out.push({ type: 'top_track_expand', priority: 'high', title: `Top Track 확대: ${topTrack.label}`,
    reason: `Context 내 Track Score ${topTrack.score} · 표본 ${topTrack.events}`,
    suggested_action: '해당 Track 의 Context 내 노출/비중 확대 검토', evidence: commonEv([{ label: 'Track Score', value: topTrack.score }, { label: 'Track 표본', value: topTrack.events }]) });

  if (lowTrack) out.push({ type: 'low_track_reduce', priority: 'low', title: `저성과 Track 축소: ${lowTrack.label}`,
    reason: `Context 내 Track Score ${lowTrack.score} · 표본 ${lowTrack.events}`,
    suggested_action: '해당 Track 의 Context 내 비중 축소/교체 실험 검토', evidence: commonEv([{ label: 'Track Score', value: lowTrack.score }]) });

  if (topPlaylist) out.push({ type: 'top_playlist', priority: 'medium', title: `Top Playlist: ${topPlaylist.label}`,
    reason: `Context 내 Playlist Score ${topPlaylist.score} · 표본 ${topPlaylist.events}`,
    suggested_action: '해당 Playlist 를 이 Context 기본 후보로 검토', evidence: commonEv([{ label: 'Playlist Score', value: topPlaylist.score }]) });

  if (playlists.filter((p) => p.supported).length >= 2) out.push({ type: 'playlist_experiment', priority: 'medium', title: 'Playlist 교체 실험 추천',
    reason: `Context 내 비교 가능한 Playlist ${playlists.filter((p) => p.supported).length}개 — A/B 실험 후보`,
    suggested_action: 'AI-PLAYLIST-2 실험으로 상위 Playlist 검증(자동 교체 금지)', evidence: commonEv() });

  const gm = rankGenreMood(detail.genres);
  if (gm.top[0] && isNum(compVsBase)) out.push({ type: 'genre_ratio', priority: 'low', title: `Genre 비율 조정: ${gm.top[0].label}`,
    reason: `Context 내 상위 Genre(Score ${gm.top[0].score}) — 비율 상향 검토`,
    suggested_action: '해당 Genre 비중 조정 후 Context Health 재확인', evidence: commonEv([{ label: 'Genre', value: gm.top[0].label }, { label: 'Genre Score', value: gm.top[0].score }]) });

  const mm = rankGenreMood(detail.moods);
  if (mm.top[0]) out.push({ type: 'mood_ratio', priority: 'low', title: `Mood 비율 조정: ${mm.top[0].label}`,
    reason: `Context 내 상위 Mood(Score ${mm.top[0].score}) — 비율 상향 검토`,
    suggested_action: '해당 Mood 비중 조정 후 Context Health 재확인', evidence: commonEv([{ label: 'Mood', value: mm.top[0].label }, { label: 'Mood Score', value: mm.top[0].score }]) });

  // Rediscovery: 완주율 양호하나 최근 미노출 Track.
  const rediscover = detail.tracks.find((t) => (clampPct(t.completion_rate) ?? 0) >= 72 && t.events >= MIN_BREAKDOWN_EVENTS && isStale(t.last_played_at, detail.generated_at, 14));
  if (rediscover) out.push({ type: 'rediscovery', priority: 'medium', title: `Rediscovery: ${rediscover.title ?? rediscover.track_id}`,
    reason: `Context 내 과거 완주율 양호(${rediscover.completion_rate})하나 최근 미노출`,
    suggested_action: '해당 Track 재노출(자동 배포 금지)', evidence: commonEv([{ label: 'Track 완주율', value: rediscover.completion_rate }, { label: '마지막 재생', value: rediscover.last_played_at }]) });

  return out;
}

/** last 가 ref 기준 days 이상 과거이면 stale. 파싱 실패/누락이면 false(추정 금지). */
export function isStale(last: string | null, ref: string, days: number): boolean {
  if (!last) return false;
  const lt = Date.parse(last); const rt = Date.parse(ref);
  if (!Number.isFinite(lt) || !Number.isFinite(rt)) return false;
  return (rt - lt) / 86400000 >= days;
}

/* ── Context Comparison(승자 단정 없음, 항목별 차이) ──────────────────────── */
export interface CompareInput { label: string; summary: ContextSummary; health: ContextHealthResult }
export interface CompareRow { kpi: string; a: number | null; b: number | null; delta: number | null; note: string }
export interface CompareResult { comparable: boolean; reason?: string; rows: CompareRow[] }

export function compareContexts(a: CompareInput, b: CompareInput): CompareResult {
  if (a.summary.events < MIN_EVENTS || b.summary.events < MIN_EVENTS) {
    return { comparable: false, reason: `표본 부족(A ${a.summary.events} / B ${b.summary.events}, 최소 ${MIN_EVENTS})`, rows: [] };
  }
  const mk = (kpi: string, av: number | null, bv: number | null, higherBetter: boolean): CompareRow => {
    const delta = isNum(av) && isNum(bv) ? Math.round((av - bv) * 10) / 10 : null;
    let note = '동등/판정 불가';
    if (isNum(delta) && Math.abs(delta) >= 1) {
      const aStronger = higherBetter ? delta > 0 : delta < 0;
      note = aStronger ? `${a.label} 우세` : `${b.label} 우세`;
    }
    return { kpi, a: av, b: bv, delta, note };
  };
  return {
    comparable: true,
    rows: [
      mk('완주율', clampPct(a.summary.completion_rate), clampPct(b.summary.completion_rate), true),
      mk('Skip율', clampPct(a.summary.skip_rate), clampPct(b.summary.skip_rate), false),
      mk('평균 청취(초)', a.summary.avg_listen_seconds, b.summary.avg_listen_seconds, true),
      mk('Track 다양성', a.summary.track_count, b.summary.track_count, true),
      mk('Playlist 다양성', a.summary.playlist_count, b.summary.playlist_count, true),
      mk('Health', a.health.score, b.health.score, true),
      mk('Confidence', a.health.confidence, b.health.confidence, true),
    ],
  };
}

/* ── Context Trend ──────────────────────────────────────────────────────── */
export type TrendMetric = 'events' | 'completion_rate' | 'skip_rate' | 'avg_listen_seconds' | 'track_count' | 'playlist_count';
export type ContextTrendDir = 'rising' | 'falling' | 'stable' | 'insufficient_data';
export const MIN_TREND_POINTS = 3;
export interface TrendPoint { bucket_start: string; events: number; completion_rate: number | null; skip_rate: number | null; avg_listen_seconds: number | null; track_count: number; playlist_count: number }

/** 전반부 평균 vs 후반부 평균 변화율(±15%)로 rising/falling/stable. 포인트 < 3 이면 insufficient. */
export function computeContextTrend(series: TrendPoint[], metric: TrendMetric): { dir: ContextTrendDir; changeRate: number | null; points: number } {
  const vals = series.map((p) => p[metric]).filter((v): v is number => isNum(v));
  if (vals.length < MIN_TREND_POINTS) return { dir: 'insufficient_data', changeRate: null, points: vals.length };
  const mid = Math.floor(vals.length / 2);
  const firstHalf = vals.slice(0, mid);
  const secondHalf = vals.slice(vals.length - mid);
  const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
  const f = avg(firstHalf); const l = avg(secondHalf);
  if (f === 0 && l === 0) return { dir: 'stable', changeRate: 0, points: vals.length };
  const changeRate = f === 0 ? 100 : Math.round(((l - f) / f) * 1000) / 10;
  const higherBetter = metric !== 'skip_rate';
  let dir: ContextTrendDir;
  if (Math.abs(changeRate) < 15) dir = 'stable';
  else if (changeRate > 0) dir = higherBetter ? 'rising' : 'falling';
  else dir = higherBetter ? 'falling' : 'rising';
  return { dir, changeRate, points: vals.length };
}

/* ── Context DNA(성과 요약 Profile · 서술형 취향 생성 금지) ────────────────── */
export interface ContextDNA {
  context_key: string; dominant_genres: string[]; dominant_moods: string[];
  bpm_range: string; vocal_support: boolean; average_completion: number | null; average_skip: number | null;
  diversity_profile: number; best_tracks: string[]; best_playlists: string[]; sample_size: number; confidence: number;
}
export function contextDNA(detail: ContextDetail): ContextDNA {
  const key = buildContextKey({ store_type: detail.store_type, daypart: detail.resolved.daypart, weekday_group: detail.resolved.weekday_group });
  const gm = rankGenreMood(detail.genres);
  const mm = rankGenreMood(detail.moods);
  const tracks = rankContextItems(detail.tracks.map((t) => ({ key: t.track_id, label: t.title ?? t.track_id, events: t.events, completion_rate: t.completion_rate, skip_rate: t.skip_rate })));
  const playlists = rankContextItems(detail.playlists.map((p) => ({ key: p.playlist_id ?? '(none)', label: p.title ?? '(untitled)', events: p.events, completion_rate: p.completion_rate, skip_rate: p.skip_rate })));
  const score = computeContextScore(detail.summary);
  return {
    context_key: key || detail.store_type,
    dominant_genres: gm.top.slice(0, 3).map((g) => g.label),
    dominant_moods: mm.top.slice(0, 3).map((m) => m.label),
    bpm_range: '미지원(tracks.bpm NULL)',
    vocal_support: false, // vocal_presence 100% NULL
    average_completion: clampPct(detail.summary.completion_rate),
    average_skip: clampPct(detail.summary.skip_rate),
    diversity_profile: diversityScore(detail.summary),
    best_tracks: tracks.filter((t) => t.supported).slice(0, 3).map((t) => t.label),
    best_playlists: playlists.filter((p) => p.supported).slice(0, 3).map((p) => p.label),
    sample_size: detail.summary.events,
    confidence: score.confidence,
  };
}

/* ── 표시 헬퍼 ──────────────────────────────────────────────────────────── */
export const STATUS_LABEL: Record<ContextHealthStatus, string> = { healthy: 'Healthy', watch: 'Watch', weak: 'Weak', insufficient_data: '데이터 부족' };
export const STATUS_TONE: Record<ContextHealthStatus, 'success' | 'warning' | 'danger' | 'neutral'> = { healthy: 'success', watch: 'warning', weak: 'danger', insufficient_data: 'neutral' };
export const GRAIN_LABEL: Record<Grain, string> = { L1: 'Store Type', L2: 'Store Type+Daypart', L3: 'Store Type+Daypart+Weekday' };
export const WEEKDAY_GROUP_LABEL: Record<string, string> = { weekday: '평일', weekend: '주말' };
export const TREND_DIR_LABEL: Record<ContextTrendDir, string> = { rising: '상승', falling: '하락', stable: '유지', insufficient_data: '데이터 부족' };
export const TREND_DIR_TONE: Record<ContextTrendDir, 'success' | 'danger' | 'neutral' | 'warning'> = { rising: 'success', falling: 'danger', stable: 'neutral', insufficient_data: 'warning' };
export const SAMPLE_TIER_LABEL: Record<SampleTier, string> = { insufficient: '표본 부족', low: '낮음', medium: '보통', high: '높음' };
export const SAMPLE_TIER_TONE: Record<SampleTier, 'danger' | 'warning' | 'info' | 'success'> = { insufficient: 'danger', low: 'warning', medium: 'info', high: 'success' };
export const RECO_LABEL: Record<ContextRecoType, string> = {
  top_track_expand: 'Top Track 확대', low_track_reduce: '저성과 Track 축소', top_playlist: 'Top Playlist',
  playlist_experiment: 'Playlist 실험', genre_ratio: 'Genre 비율', mood_ratio: 'Mood 비율',
  rediscovery: 'Rediscovery', new_track_test: '신곡 Test', collect_sample: '표본 수집',
};
export const DAYPART_OPTIONS = ['새벽', '아침', '점심', '오후', '저녁', '심야'] as const;

export function statusTone(status: ContextHealthStatus) { return STATUS_TONE[status]; }
export function healthStatusFromScore(score: number, events: number): ContextHealthStatus {
  if (events < SAMPLE_TIERS.insufficient) return 'insufficient_data';
  return score >= 70 ? 'healthy' : score >= 50 ? 'watch' : 'weak';
}
