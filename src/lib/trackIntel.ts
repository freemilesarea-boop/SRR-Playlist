/**
 * trackIntel — Track Intelligence & Lifecycle 순수 로직 (Phase AI-MUSIC-1).
 *
 * Playlist 가 아니라 **Track 중심**으로 성과를 학습한다. 실제 Track KPI 로 Health·Lifecycle·
 * Trend·Industry/Daypart/Season Score·Recommendation 을 계산한다(단위 테스트 대상).
 * AI 가 존재하지 않는 메타데이터를 만들지 않으며, 자동 Stage 변경 없이 추천만 생성한다.
 *
 * 원칙: Health/Score/Confidence 0~100 clamp · NaN/Infinity 금지 · Evidence 없는 추천 금지 ·
 * 존재하는 KPI 만(없는 신호 제외·미지원 표기).
 */
import { clampPct } from './playlistIntel';

/* ── 입력(admin_track_intel_list) ─────────────────────────────────────── */
export interface TrackIntelKpi {
  track_id: string; title: string | null; artist: string | null; main_genre: string | null; mood: string | null;
  bpm: number | null; duration: number | null;
  events: number; skip_rate: number | null; completion_rate: number | null; likes: number; replays: number;
  p7d: number; p30d: number; p90d: number; uniq_playlists: number; uniq_store_types: number;
  last_played_at: string | null; days_since_last_play: number | null; rollout_stage: string | null;
}

const isNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const clamp100 = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

/* ── Track Health (Completion·Skip·Trend·Coverage·Rollout) ────────────── */
export const HEALTH_WEIGHTS = { completion: 0.3, skip: 0.25, trend: 0.15, coverage: 0.15, rollout: 0.15 };
export interface HealthResult { score: number; confidence: number; components: Array<{ key: string; label: string; value: number; present: boolean }> }

export type TrendDir = 'up' | 'down' | 'flat' | 'unknown';
/** 최근(7d) 일평균 vs 이전(8~30d) 일평균 → 상승/하락/유지. 데이터 부족이면 unknown. */
export function computeTrend(k: TrackIntelKpi): { dir: TrendDir; recentPerDay: number | null; priorPerDay: number | null; changeRate: number | null } {
  if (k.p30d < 4) return { dir: 'unknown', recentPerDay: null, priorPerDay: null, changeRate: null };
  const recentPerDay = k.p7d / 7;
  const priorDays = 23; // 8~30d
  const priorPerDay = Math.max(0, k.p30d - k.p7d) / priorDays;
  if (priorPerDay === 0 && recentPerDay === 0) return { dir: 'flat', recentPerDay, priorPerDay, changeRate: 0 };
  const changeRate = priorPerDay === 0 ? 100 : Math.round(((recentPerDay - priorPerDay) / priorPerDay) * 1000) / 10;
  const dir: TrendDir = changeRate > 15 ? 'up' : changeRate < -15 ? 'down' : 'flat';
  return { dir, recentPerDay: Math.round(recentPerDay * 100) / 100, priorPerDay: Math.round(priorPerDay * 100) / 100, changeRate };
}

const ROLLOUT_SCORE: Record<string, number> = { global: 100, expanded: 85, limited: 65, pilot: 50, test_pool: 40, draft: 25, archived: 10 };

export function computeHealth(k: TrackIntelKpi): HealthResult {
  const comp = clampPct(k.completion_rate);
  const skip = clampPct(k.skip_rate);
  const trend = computeTrend(k);
  const trendVal = trend.dir === 'up' ? 100 : trend.dir === 'flat' ? 65 : trend.dir === 'down' ? 30 : null;
  const coverage = clamp01((k.uniq_store_types + k.uniq_playlists) / 8) * 100;
  const rollout = k.rollout_stage ? (ROLLOUT_SCORE[k.rollout_stage] ?? null) : null;

  const components = [
    { key: 'completion', label: '완주율', weight: HEALTH_WEIGHTS.completion, value: comp ?? 0, present: comp != null },
    { key: 'skip', label: 'Skip(역)', weight: HEALTH_WEIGHTS.skip, value: skip != null ? 100 - skip : 0, present: skip != null },
    { key: 'trend', label: 'Trend', weight: HEALTH_WEIGHTS.trend, value: trendVal ?? 0, present: trendVal != null },
    { key: 'coverage', label: 'Coverage', weight: HEALTH_WEIGHTS.coverage, value: coverage, present: k.events > 0 },
    { key: 'rollout', label: 'Rollout', weight: HEALTH_WEIGHTS.rollout, value: rollout ?? 0, present: rollout != null },
  ];
  const present = components.filter((c) => c.present);
  const wsum = present.reduce((s, c) => s + c.weight, 0);
  const score = wsum > 0 ? clamp100(present.reduce((s, c) => s + c.value * c.weight, 0) / wsum) : 0;
  // Confidence = 데이터 충족(이벤트/신호 수).
  const confidence = clamp100((clamp01(k.events / 30) * 0.6 + (present.length / components.length) * 0.4) * 100);
  return { score, confidence, components: components.map((c) => ({ key: c.key, label: c.label, value: Math.round(c.value), present: c.present })) };
}

/* ── Lifecycle (자동 변경 금지, 추천만) ───────────────────────────────── */
export type Lifecycle = 'draft' | 'testing' | 'growing' | 'core' | 'stable' | 'declining' | 'archive_candidate' | 'archived';
export interface LifecycleResult { stage: Lifecycle; reason: string; evidence: Array<{ label: string; value: string | number | null }> }

/** KPI/Health/Trend/Rollout 로 Lifecycle 단계를 **추천**(현재 상태 판정). 자동 반영 없음. */
export function recommendLifecycle(k: TrackIntelKpi, health: HealthResult): LifecycleResult {
  const trend = computeTrend(k);
  const comp = clampPct(k.completion_rate) ?? 0;
  const stage = k.rollout_stage;
  const evidence = [
    { label: '이벤트', value: k.events }, { label: '완주율', value: comp }, { label: 'Health', value: health.score },
    { label: 'Trend', value: trend.dir }, { label: '최근 미재생(일)', value: k.days_since_last_play },
  ];
  let s: Lifecycle; let reason: string;
  if (stage === 'archived') { s = 'archived'; reason = 'Rollout archived'; }
  else if (k.events < 10) { s = 'testing'; reason = `표본 부족(${k.events}) — 검증중`; }
  else if (isNum(k.days_since_last_play) && k.days_since_last_play >= 30 && comp >= 70) { s = 'archive_candidate'; reason = `장기 미재생(${k.days_since_last_play}일)이나 과거 성과 양호 — Rediscovery 후보 겸 Archive 검토`; }
  else if (trend.dir === 'down' && health.score < 55) { s = 'declining'; reason = `Trend 하락 + Health ${health.score}`; }
  else if (health.score >= 80 && comp >= 78 && k.uniq_store_types >= 2) { s = 'core'; reason = `Health ${health.score}·완주 ${comp}·커버리지 우수`; }
  else if (health.score >= 65 && trend.dir === 'up') { s = 'growing'; reason = `Health ${health.score} + Trend 상승`; }
  else if (health.score >= 60) { s = 'stable'; reason = `Health ${health.score} 안정`; }
  else { s = 'testing'; reason = `Health ${health.score} — 추가 검증 필요`; }
  return { stage: s, reason, evidence };
}

/* ── Industry / Daypart / Season Score (breakdown → 완주율 기반) ───────── */
export interface Breakdown { key: string; events: number; completion_rate: number | null; skip_rate: number | null }
export const MIN_BREAKDOWN_EVENTS = 5;
export interface ScoreRow { key: string; score: number | null; events: number; supported: boolean }

/** 완주율(0.7) + Skip 역(0.3) → 0~100. 표본 부족(<MIN)이면 미지원(추정 금지). */
export function scoreBreakdown(rows: Breakdown[]): ScoreRow[] {
  return rows.map((r) => {
    const supported = r.events >= MIN_BREAKDOWN_EVENTS;
    if (!supported) return { key: r.key, score: null, events: r.events, supported: false };
    const comp = clampPct(r.completion_rate) ?? 0;
    const skipInv = 100 - (clampPct(r.skip_rate) ?? 0);
    return { key: r.key, score: clamp100(comp * 0.7 + skipInv * 0.3), events: r.events, supported: true };
  }).sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
}

/* ── Recommendation (Evidence 기반) ─────────────────────────────────── */
export type RecoType = 'core_promote' | 'archive_candidate' | 'rediscovery' | 'industry_expand' | 'playlist_add';
export interface TrackReco { type: RecoType; title: string; reason: string; evidence: Array<{ label: string; value: string | number | null }>; priority: 'high' | 'medium' | 'low' }

export function recommendTrack(k: TrackIntelKpi, health: HealthResult, industryScores: ScoreRow[]): TrackReco[] {
  const out: TrackReco[] = [];
  const life = recommendLifecycle(k, health);
  const comp = clampPct(k.completion_rate) ?? 0;
  const ev = (extra: Array<{ label: string; value: string | number | null }> = []) => [
    { label: '이벤트', value: k.events }, { label: '완주율', value: comp }, { label: 'Health', value: health.score }, ...extra,
  ];
  if (life.stage === 'core' && k.rollout_stage !== 'global') out.push({ type: 'core_promote', title: 'Core 승격 추천', reason: `Core 수준 성과(Health ${health.score})이나 Rollout 미완`, evidence: ev([{ label: 'Rollout', value: k.rollout_stage }]), priority: 'high' });
  if (isNum(k.days_since_last_play) && k.days_since_last_play >= 21 && comp >= 72) out.push({ type: 'rediscovery', title: 'Rediscovery 추천', reason: `과거 성과 양호 + ${k.days_since_last_play}일 미노출`, evidence: ev([{ label: '미재생(일)', value: k.days_since_last_play }]), priority: 'medium' });
  if (life.stage === 'archive_candidate' || (health.score < 45 && k.events >= 15)) out.push({ type: 'archive_candidate', title: 'Archive Candidate 추천', reason: `저성과/장기 미노출 — Archive 검토`, evidence: ev(), priority: 'low' });
  const strongIndustries = industryScores.filter((s) => s.supported && (s.score ?? 0) >= 75);
  if (strongIndustries.length > 0 && k.uniq_store_types < 4) out.push({ type: 'industry_expand', title: '업종 확대 추천', reason: `${strongIndustries.map((s) => s.key).slice(0, 2).join('·')} 업종 성과 우수 — 확대 검토`, evidence: ev([{ label: '현재 업종수', value: k.uniq_store_types }]), priority: 'medium' });
  if (comp >= 75 && k.uniq_playlists < 3 && k.events >= 15) out.push({ type: 'playlist_add', title: 'Playlist 추가 추천', reason: `성과 양호하나 노출 Playlist ${k.uniq_playlists}개`, evidence: ev([{ label: 'Playlist 수', value: k.uniq_playlists }]), priority: 'low' });
  return out;
}

/* ── Support Matrix ─────────────────────────────────────────────────── */
export interface SupportItem { key: string; label: string; supported: boolean; note: string }
export const SUPPORT_MATRIX: SupportItem[] = [
  { key: 'track_kpi', label: 'Track KPI', supported: true, note: 'playback_events_v2' },
  { key: 'industry', label: 'Industry(Store Type)', supported: true, note: 'store_type_slug' },
  { key: 'playlist', label: 'Playlist', supported: true, note: 'playlist_id' },
  { key: 'rollout', label: 'Rollout', supported: true, note: 'track_rollouts.stage' },
  { key: 'daypart', label: 'Daypart', supported: true, note: 'created_at 시간대' },
  { key: 'season', label: 'Season', supported: true, note: 'created_at 월' },
  { key: 'genre', label: 'Genre', supported: true, note: 'tracks.main_genre' },
  { key: 'mood', label: 'Mood', supported: true, note: 'tracks.mood' },
  { key: 'bpm', label: 'BPM', supported: true, note: '있을 때만(다수 null)' },
  { key: 'brand', label: 'Brand', supported: false, note: 'playback_events_v2 brand 미기록 → store_type proxy' },
  { key: 'weather', label: 'Weather', supported: false, note: '데이터 없음' },
  { key: 'event', label: 'Event', supported: false, note: '데이터 없음' },
];

/* ── 표시 헬퍼 ──────────────────────────────────────────────────────── */
export const LIFECYCLE_LABEL: Record<Lifecycle, string> = {
  draft: 'Draft', testing: 'Testing', growing: 'Growing', core: 'Core', stable: 'Stable', declining: 'Declining', archive_candidate: 'Archive 후보', archived: 'Archived',
};
export const LIFECYCLE_TONE: Record<Lifecycle, 'neutral' | 'info' | 'success' | 'warning' | 'danger'> = {
  draft: 'neutral', testing: 'info', growing: 'info', core: 'success', stable: 'success', declining: 'warning', archive_candidate: 'warning', archived: 'neutral',
};
export const TREND_LABEL: Record<TrendDir, string> = { up: '상승', down: '하락', flat: '유지', unknown: '데이터 없음' };
export const TREND_TONE: Record<TrendDir, 'success' | 'danger' | 'neutral' | 'warning'> = { up: 'success', down: 'danger', flat: 'neutral', unknown: 'warning' };
export const RECO_LABEL: Record<RecoType, string> = { core_promote: 'Core 승격', archive_candidate: 'Archive 후보', rediscovery: 'Rediscovery', industry_expand: '업종 확대', playlist_add: 'Playlist 추가' };

export function healthTone(score: number): 'success' | 'warning' | 'danger' | 'neutral' {
  return score >= 75 ? 'success' : score >= 50 ? 'warning' : score > 0 ? 'danger' : 'neutral';
}
