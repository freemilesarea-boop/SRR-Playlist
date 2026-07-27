/**
 * playlistPresets — Phase AI-PLAYLIST-ADMIN-UX-2
 *
 * 운영 Preset(업종/목적별 조건 자동 입력) 순수 로직.
 *   Preset 데이터 출처: 기존 public.ai_store_profiles (27개 업종 정책 — genre/mood/
 *   bpm/energy/vocal/explicit). 새 테이블/엔진을 만들지 않고 기존 정책을 재사용한다.
 *
 * 원칙:
 *   - Preset 은 "조건 자동 입력" 편의 기능일 뿐, 자동 저장/배포하지 않는다.
 *   - 정책 기반 값(ai_store_profiles)과 UX 기본값(목표시간/정렬 등)을 명확히 분리한다.
 *   - 후보를 지나치게 좁혀 빈 목록이 되지 않도록 안전한 기본값을 쓴다:
 *     차단 장르/explicit/blocked 만 하드 필터, 선호 장르·vocal 은 기본 미적용(관리자 선택).
 */
import type { CandidateFilters } from './playlistBuilder';

/** ai_store_profiles 행(필요 필드만). */
export interface StoreProfileRow {
  store_key: string;
  store_label: string;
  preferred_genres?: string[] | null;
  blocked_genres?: string[] | null;
  preferred_moods?: string[] | null;
  vocal_preference?: string | null;
  ideal_bpm_min?: number | null;
  ideal_bpm_max?: number | null;
  bpm_min?: number | null;
  bpm_max?: number | null;
  ideal_energy_min?: number | string | null;
  ideal_energy_max?: number | string | null;
  energy_min?: number | string | null;
  energy_max?: number | string | null;
  allow_explicit?: boolean | null;
  require_clean_content?: boolean | null;
  sort_order?: number | null;
  active?: boolean | null;
  description?: string | null;
}

/** 관리자 편집 가능한 Preset 조건. */
export interface PresetConditions {
  bpmMin: number | null;
  bpmMax: number | null;
  energyMin: number | null; // 1..5
  energyMax: number | null; // 1..5
  vocal: 'any' | 'vocal' | 'instrumental';
  fitMin: number | null;
  includeGenres: string[]; // 선호 장르(기본 미적용 — 관리자가 켤 수 있음)
  excludeGenres: string[]; // 차단 장르(정책)
  excludeExplicit: boolean;
  excludeBlocked: boolean;
  excludePenalized: boolean;
  targetDurationSec: number | null;
  candidateSort: 'fit' | 'adaptive';
}

export interface BuilderPreset {
  /** 값 출처 구분: 정책(store_profile) vs UX 기본(ux_default). */
  source: 'store_profile' | 'ux_default';
  storeKey: string;
  storeLabel: string;
  preferredGenres: string[];
  preferredMoods: string[];
  /** 정책 vocal_preference 를 사람이 읽는 라벨로(표시용). */
  vocalPreferenceLabel: string;
  conditions: PresetConditions;
}

/** UX 기본값(정책이 아님) — 명확히 분리. */
export const UX_DEFAULT_TARGET_SEC = 8 * 3600; // 8시간
export const UX_DEFAULT_CANDIDATE_SORT: 'fit' | 'adaptive' = 'fit';

const VOCAL_LABELS: Record<string, string> = {
  instrumental_first: '연주곡 우선',
  vocal_preferred: '보컬 선호',
  vocal_allowed: '보컬 허용',
  lyrics_restricted: '가사 제한',
};

function toNum(v: number | string | null | undefined): number | null {
  if (v == null) return null;
  const n = typeof v === 'string' ? parseFloat(v) : v;
  return Number.isFinite(n) ? n : null;
}

function clampLevel(n: number): number {
  return Math.min(5, Math.max(1, n));
}

/** energy 0..1(정책) → 1..5(BuilderTrack.energyLevel) 레벨. null 은 null 유지. */
export function energyToLevel(v01: number | string | null | undefined): number | null {
  const n = toNum(v01);
  if (n == null) return null;
  if (n <= 0) return 1;
  if (n >= 1) return 5;
  return clampLevel(Math.round(n * 5));
}

function cleanGenres(arr: string[] | null | undefined): string[] {
  return (arr ?? []).map((s) => (s ?? '').trim()).filter((s) => s !== '');
}

/** ai_store_profiles 행 → BuilderPreset. 정책 값을 조건으로 매핑(빈 목록 방지 안전 기본값). */
export function profileToPreset(row: StoreProfileRow): BuilderPreset {
  const bpmMin = toNum(row.ideal_bpm_min) ?? toNum(row.bpm_min);
  const bpmMax = toNum(row.ideal_bpm_max) ?? toNum(row.bpm_max);
  const eMinLvl = energyToLevel(row.ideal_energy_min ?? row.energy_min);
  const eMaxLvl = energyToLevel(row.ideal_energy_max ?? row.energy_max);
  // min <= max 보장
  const energyMin = eMinLvl != null && eMaxLvl != null ? Math.min(eMinLvl, eMaxLvl) : eMinLvl;
  const energyMax = eMinLvl != null && eMaxLvl != null ? Math.max(eMinLvl, eMaxLvl) : eMaxLvl;
  const requireClean = row.require_clean_content === true || row.allow_explicit === false;

  return {
    source: 'store_profile',
    storeKey: row.store_key,
    storeLabel: row.store_label || row.store_key,
    preferredGenres: cleanGenres(row.preferred_genres),
    preferredMoods: cleanGenres(row.preferred_moods),
    vocalPreferenceLabel: VOCAL_LABELS[row.vocal_preference ?? ''] ?? '제한 없음',
    conditions: {
      bpmMin,
      bpmMax,
      energyMin,
      energyMax,
      vocal: 'any', // 안전 기본값(정책 vocal 은 라벨로 표시, 관리자가 좁힐 수 있음)
      fitMin: null, // 기본 미적용(빈 목록 방지) — 관리자가 설정
      includeGenres: [], // 선호 장르는 기본 미적용
      excludeGenres: cleanGenres(row.blocked_genres),
      excludeExplicit: requireClean,
      excludeBlocked: true,
      excludePenalized: false,
      targetDurationSec: UX_DEFAULT_TARGET_SEC, // UX 기본값
      candidateSort: UX_DEFAULT_CANDIDATE_SORT, // UX 기본값
    },
  };
}

/** 빈 Playlist 시작용 중립 Preset(정책 아님). */
export function emptyPreset(): BuilderPreset {
  return {
    source: 'ux_default',
    storeKey: '',
    storeLabel: '빈 플레이리스트',
    preferredGenres: [],
    preferredMoods: [],
    vocalPreferenceLabel: '제한 없음',
    conditions: {
      bpmMin: null,
      bpmMax: null,
      energyMin: null,
      energyMax: null,
      vocal: 'any',
      fitMin: null,
      includeGenres: [],
      excludeGenres: [],
      excludeExplicit: false,
      excludeBlocked: true,
      excludePenalized: false,
      targetDurationSec: null,
      candidateSort: UX_DEFAULT_CANDIDATE_SORT,
    },
  };
}

/** Preset 조건을 부분 override 로 병합(관리자 수정). 주어진 키만 덮어쓴다. */
export function mergeConditions(base: PresetConditions, patch: Partial<PresetConditions>): PresetConditions {
  return { ...base, ...patch };
}

/** Preset 조건 → 후보 필터(CandidateFilters). excludeAlreadyIn 기본 true. */
export function presetToFilters(
  c: PresetConditions,
  opts: { query?: string; excludeAlreadyIn?: boolean } = {},
): CandidateFilters {
  return {
    query: opts.query,
    bpmMin: c.bpmMin,
    bpmMax: c.bpmMax,
    energyMin: c.energyMin,
    energyMax: c.energyMax,
    vocal: c.vocal,
    fitMin: c.fitMin,
    includeGenres: c.includeGenres,
    excludeGenres: c.excludeGenres,
    excludeExplicit: c.excludeExplicit,
    excludeBlocked: c.excludeBlocked,
    excludePenalized: c.excludePenalized,
    excludeAlreadyIn: opts.excludeAlreadyIn ?? true,
  };
}

/** Preset Preview 용 요약 라인(적용될 조건을 사람이 읽는 형태). */
export function presetSummaryLines(p: BuilderPreset): string[] {
  const c = p.conditions;
  const lines: string[] = [];
  if (p.preferredGenres.length > 0) lines.push(`선호 장르: ${p.preferredGenres.join(', ')}`);
  if (c.excludeGenres.length > 0) lines.push(`제외 장르: ${c.excludeGenres.join(', ')}`);
  if (p.preferredMoods.length > 0) lines.push(`분위기: ${p.preferredMoods.join(', ')}`);
  if (c.bpmMin != null || c.bpmMax != null) lines.push(`BPM: ${c.bpmMin ?? '—'}–${c.bpmMax ?? '—'}`);
  if (c.energyMin != null || c.energyMax != null) lines.push(`Energy: ${c.energyMin ?? '—'}–${c.energyMax ?? '—'} (1–5)`);
  lines.push(`Vocal: ${p.vocalPreferenceLabel}`);
  if (c.excludeExplicit) lines.push('Explicit 제외');
  if (c.targetDurationSec) lines.push(`목표 재생시간: ${Math.round(c.targetDurationSec / 3600)}시간`);
  return lines;
}
