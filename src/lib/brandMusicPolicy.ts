/**
 * brandMusicPolicy — pure, framework-free core for the BRAND MUSIC POLICY "STUDIO"
 * (Phase BRAND-MUSIC-POLICY-STUDIO-1).
 *
 * The studio lets an admin choose, per brand, either
 *   • `inherit` — apply only the industry (store-type) defaults, no brand overrides, or
 *   • `custom`  — a brand whitelist of allowed genres + blocked genres/moods + vocal policy
 *                 + energy/BPM ranges.
 *
 * ABSOLUTE INVARIANT (mirrors migration 0464 §C): a store-type HARD policy (study cafe
 * strict) always wins over the brand's custom values — a brand can never relax it. When a
 * study-cafe brand saves a custom policy, the server silently CLAMPS the unsafe fields and
 * returns a `warnings[]` list. This module reproduces that clamp EXACTLY so the studio can
 * show the operator, before they hit save, what will actually be enforced. The Postgres
 * function `admin_upsert_brand_music_policy` is the source of truth; keep the two in
 * lock-step (thresholds below === STUDY_GENRES / 0.5 / 110 / instrumental_only in SQL).
 *
 * The option lists mirror `public.taxonomy_genres` / `public.taxonomy_moods` (is_active)
 * — the same tables the server validates against. Only these slugs are accepted by
 * `admin_upsert_brand_music_policy`; offering anything else would make the save fail.
 *
 * Intentionally NO I/O and NO framework imports — unit-testable without a DB or browser.
 */

// ---------------------------------------------------------------------------
// Policy mode
// ---------------------------------------------------------------------------

export type PolicyMode = 'inherit' | 'custom';

export const POLICY_MODE_LABELS: Record<PolicyMode, string> = {
  inherit: '업종 기본 상속',
  custom: '브랜드 커스텀',
};

// ---------------------------------------------------------------------------
// Taxonomy option lists — MUST mirror public.taxonomy_genres / taxonomy_moods
// (is_active) since the server validates submitted slugs against those tables.
// ---------------------------------------------------------------------------

export interface TaxonomyOption {
  slug: string;
  label: string;
}

/** Allowed/blocked/preferred genre slugs (mirror taxonomy_genres, is_active). */
export const BRAND_POLICY_GENRES: readonly TaxonomyOption[] = [
  { slug: 'acoustic', label: '어쿠스틱' },
  { slug: 'ballad', label: '발라드' },
  { slug: 'classical', label: '클래식' },
  { slug: 'edm', label: 'EDM' },
  { slug: 'hiphop', label: '힙합' },
  { slug: 'house', label: '하우스' },
  { slug: 'indie', label: '인디' },
  { slug: 'jazz', label: '재즈' },
  { slug: 'jpop', label: 'J-Pop' },
  { slug: 'kpop', label: 'K-Pop' },
  { slug: 'lofi', label: '로파이' },
  { slug: 'ost', label: 'OST' },
  { slug: 'pop', label: '팝' },
  { slug: 'rnb', label: 'R&B' },
  { slug: 'rock', label: '록' },
];

/** Preferred/blocked mood slugs (mirror taxonomy_moods, is_active). */
export const BRAND_POLICY_MOODS: readonly TaxonomyOption[] = [
  { slug: 'bright', label: '밝은' },
  { slug: 'calm', label: '차분한' },
  { slug: 'chic', label: '세련된' },
  { slug: 'dreamy', label: '몽환적인' },
  { slug: 'emotional', label: '감성적인' },
  { slug: 'energetic', label: '에너지있는' },
  { slug: 'exciting', label: '신나는' },
  { slug: 'focused', label: '집중되는' },
  { slug: 'happy', label: '행복한' },
  { slug: 'lively', label: '활기찬' },
  { slug: 'luxurious', label: '고급스러운' },
  { slug: 'relaxed', label: '편안한' },
  { slug: 'romantic', label: '로맨틱한' },
  { slug: 'sensual', label: '감각적인' },
  { slug: 'trendy', label: '트렌디한' },
  { slug: 'warm', label: '따뜻한' },
];

const GENRE_SLUGS: ReadonlySet<string> = new Set(BRAND_POLICY_GENRES.map((g) => g.slug));
const MOOD_SLUGS: ReadonlySet<string> = new Set(BRAND_POLICY_MOODS.map((m) => m.slug));

const GENRE_LABELS: Record<string, string> = Object.fromEntries(BRAND_POLICY_GENRES.map((g) => [g.slug, g.label]));
const MOOD_LABELS: Record<string, string> = Object.fromEntries(BRAND_POLICY_MOODS.map((m) => [m.slug, m.label]));

export function genreLabel(slug: string): string {
  return GENRE_LABELS[slug] ?? slug;
}
export function moodLabel(slug: string): string {
  return MOOD_LABELS[slug] ?? slug;
}
export function isValidPolicyGenre(slug: string): boolean {
  return GENRE_SLUGS.has(slug);
}
export function isValidPolicyMood(slug: string): boolean {
  return MOOD_SLUGS.has(slug);
}

/** lower+trim+dedupe a raw slug list to comparable tokens (mirrors server normalization). */
export function normalizePolicySlugs(raw: readonly string[] | null | undefined): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const r of raw ?? []) {
    const t = (r ?? '').trim().toLowerCase();
    if (t && !seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Study-cafe hard clamp — mirrors migration 0464 §C exactly
// ---------------------------------------------------------------------------

/** Genres a study cafe may ever allow (mirror SQL STUDY_GENRES). */
export const STUDY_CAFE_POLICY_GENRES: readonly string[] = ['lofi', 'ambient', 'jazz'];

/** Hard ceilings a study-cafe brand can never relax (mirror SQL clamp constants). */
export const STUDY_CAFE_HARD = {
  energyMax: 0.5,
  bpmMax: 110,
  vocalPolicy: 'instrumental_only' as const,
} as const;

export type BrandPolicyWarning =
  | 'allowed_genres_clamped_to_study'
  | 'vocal_forced_instrumental_only'
  | 'energy_max_clamped_0.5'
  | 'bpm_max_clamped_110';

export const WARNING_LABELS: Record<BrandPolicyWarning, string> = {
  allowed_genres_clamped_to_study: '허용 장르가 스터디카페 허용집합(로파이·재즈)으로 제한되었습니다.',
  vocal_forced_instrumental_only: '보컬 정책이 "연주곡만"으로 고정되었습니다.',
  'energy_max_clamped_0.5': '에너지 최대값이 0.5로 제한되었습니다.',
  bpm_max_clamped_110: 'BPM 최대값이 110으로 제한되었습니다.',
};

export type BrandVocalPolicyLite = 'any' | 'vocal_ok' | 'prefer_instrumental' | 'instrumental_only';

/** The subset of custom-policy fields the study-cafe clamp can rewrite. */
export interface ClampableBrandPolicy {
  allowedGenres: string[];
  vocalPolicy: BrandVocalPolicyLite;
  energyMin: number | null;
  energyMax: number | null;
  bpmMin: number | null;
  bpmMax: number | null;
}

export interface ClampResult {
  values: ClampableBrandPolicy;
  warnings: BrandPolicyWarning[];
}

/**
 * Reproduce the server-side study-cafe clamp (migration 0464 §C) for a would-be custom
 * policy. Returns the values that will actually be persisted plus the warning tokens the
 * server would emit. Non-study brands are returned unchanged with no warnings.
 *
 * Mirrors the SQL step-for-step:
 *   • allowed_genres → intersect with STUDY_GENRES (warn if anything was dropped),
 *   • vocal_policy   → force 'instrumental_only' (warn if it wasn't already),
 *   • energy_max     → min(coalesce(energy_max, 0.5), 0.5) (warn only if an explicit >0.5),
 *   • bpm_max        → min(coalesce(bpm_max, 110), 110)     (warn only if an explicit >110),
 *   • then energy_min/bpm_min are pulled down to their max if they now exceed it.
 */
export function clampStudyCafeBrandPolicy(input: ClampableBrandPolicy, isStudyCafe: boolean): ClampResult {
  const warnings: BrandPolicyWarning[] = [];
  const v: ClampableBrandPolicy = {
    allowedGenres: [...input.allowedGenres],
    vocalPolicy: input.vocalPolicy,
    energyMin: input.energyMin,
    energyMax: input.energyMax,
    bpmMin: input.bpmMin,
    bpmMax: input.bpmMax,
  };
  if (!isStudyCafe) return { values: v, warnings };

  const normalizedAllowed = normalizePolicySlugs(v.allowedGenres);
  if (normalizedAllowed.length > 0) {
    const kept = normalizedAllowed.filter((g) => STUDY_CAFE_POLICY_GENRES.includes(g));
    if (kept.length !== normalizedAllowed.length) warnings.push('allowed_genres_clamped_to_study');
    v.allowedGenres = kept;
  }
  if (v.vocalPolicy !== 'instrumental_only') {
    warnings.push('vocal_forced_instrumental_only');
    v.vocalPolicy = 'instrumental_only';
  }
  if (v.energyMax == null || v.energyMax > STUDY_CAFE_HARD.energyMax) {
    if (v.energyMax != null && v.energyMax > STUDY_CAFE_HARD.energyMax) warnings.push('energy_max_clamped_0.5');
    v.energyMax = Math.min(v.energyMax ?? STUDY_CAFE_HARD.energyMax, STUDY_CAFE_HARD.energyMax);
  }
  if (v.bpmMax == null || v.bpmMax > STUDY_CAFE_HARD.bpmMax) {
    if (v.bpmMax != null && v.bpmMax > STUDY_CAFE_HARD.bpmMax) warnings.push('bpm_max_clamped_110');
    v.bpmMax = Math.min(v.bpmMax ?? STUDY_CAFE_HARD.bpmMax, STUDY_CAFE_HARD.bpmMax);
  }
  if (v.energyMin != null && v.energyMax != null && v.energyMin > v.energyMax) v.energyMin = v.energyMax;
  if (v.bpmMin != null && v.bpmMax != null && v.bpmMin > v.bpmMax) v.bpmMin = v.bpmMax;

  return { values: v, warnings };
}

// ---------------------------------------------------------------------------
// Client-side pre-validation (fail fast before the RPC round-trip)
// ---------------------------------------------------------------------------

export interface PolicyValidationResult {
  ok: boolean;
  /** First human-readable error, if any. */
  error?: string;
}

/**
 * Validate a would-be custom policy the same way the server does, so the studio can block a
 * doomed save locally. Only structural checks the server also enforces are reproduced here;
 * study-cafe clamping is NOT an error (it is applied silently server-side).
 */
export function validateCustomPolicy(input: {
  allowedGenres: string[];
  blockedGenres: string[];
  preferredGenres: string[];
  blockedMoods: string[];
  preferredMoods: string[];
  energyMin: number | null;
  energyMax: number | null;
  bpmMin: number | null;
  bpmMax: number | null;
}): PolicyValidationResult {
  const allowed = normalizePolicySlugs(input.allowedGenres);
  const blocked = normalizePolicySlugs(input.blockedGenres);
  const preferred = normalizePolicySlugs(input.preferredGenres);
  const bMoods = normalizePolicySlugs(input.blockedMoods);
  const pMoods = normalizePolicySlugs(input.preferredMoods);

  for (const g of [...allowed, ...blocked, ...preferred]) {
    if (!isValidPolicyGenre(g)) return { ok: false, error: `허용되지 않은 장르 슬러그: ${g}` };
  }
  for (const m of [...bMoods, ...pMoods]) {
    if (!isValidPolicyMood(m)) return { ok: false, error: `허용되지 않은 무드 슬러그: ${m}` };
  }
  if (allowed.some((a) => blocked.includes(a))) {
    return { ok: false, error: '허용 장르와 차단 장르가 겹칩니다.' };
  }
  const { energyMin, energyMax, bpmMin, bpmMax } = input;
  if (energyMin != null && (energyMin < 0 || energyMin > 1)) return { ok: false, error: '에너지 최소값은 0~1 범위여야 합니다.' };
  if (energyMax != null && (energyMax < 0 || energyMax > 1)) return { ok: false, error: '에너지 최대값은 0~1 범위여야 합니다.' };
  if (energyMin != null && energyMax != null && energyMin > energyMax) return { ok: false, error: '에너지 최소값이 최대값보다 큽니다.' };
  if (bpmMin != null && (bpmMin < 0 || bpmMin > 300)) return { ok: false, error: 'BPM 최소값은 0~300 범위여야 합니다.' };
  if (bpmMax != null && (bpmMax < 0 || bpmMax > 300)) return { ok: false, error: 'BPM 최대값은 0~300 범위여야 합니다.' };
  if (bpmMin != null && bpmMax != null && bpmMin > bpmMax) return { ok: false, error: 'BPM 최소값이 최대값보다 큽니다.' };
  return { ok: true };
}
