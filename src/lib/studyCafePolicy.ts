/**
 * studyCafePolicy — pure, framework-free evaluation core for the STUDY-CAFE
 * strict music policy (Phase STUDY-CAFE-STRICT-MUSIC-POLICY-1).
 *
 * A study cafe (내부 코드 `study_cafe`) is a "study / focus" venue. Its policy is a
 * HARD FILTER, not a recommendation weight: a track that fails ANY gate is *blocked*
 * from ever entering the candidate pool, the resolver, the queue, fallback, shuffle or
 * auto-play — it is never merely down-ranked (spec §7).
 *
 * Evaluation order (spec §6):
 *   store_type == study_cafe
 *     → canonical genre ∈ {Lo-fi, Ambient, Jazz}   (else STUDY_CAFE_GENRE_NOT_ALLOWED)
 *     → vocal *confirmed* false                     (else STUDY_CAFE_VOCAL_NOT_ALLOWED)
 *     → calm enough (energy/tempo/intensity/mood)   (else STUDY_CAFE_NOT_CALM_ENOUGH)
 *     → STUDY_CAFE_ELIGIBLE
 *
 * This module is the single source of truth for the thresholds/genre-set/vocal-states.
 * The server runtime (SQL `_study_cafe_track_eligible`, wired into
 * `_ai_check_store_guardrails` / `_brand_generate_playlist` / `_check_store_genre_placement`
 * in migration 0463) mirrors these EXACT values so the same track is judged identically
 * whether the decision is made in Postgres (candidate pool / queue) or in the client
 * (final runtime guardrail). Keep the two in lock-step when tuning.
 *
 * Intentionally NO I/O and NO framework imports — unit-testable without a DB or browser.
 */

// ---------------------------------------------------------------------------
// Store-type identity
// ---------------------------------------------------------------------------

/** Internal store-type code for a study cafe. Matches the DB taxonomy slug. */
export const STUDY_CAFE_STORE_TYPE = 'study_cafe' as const;

/**
 * Raw labels that denote a study cafe (mirrors public.store_type_alias seeds in 0240).
 * Normalized (lower + trim) before comparison so free-text `industry_type` /
 * `business_category` values resolve to the study-cafe policy.
 */
const STUDY_CAFE_ALIASES: ReadonlySet<string> = new Set([
  'study_cafe',
  'study cafe',
  'studycafe',
  '스터디카페',
  '스터디 카페',
  '독서실',
]);

/** True when a free-text store label denotes a study cafe. */
export function isStudyCafeStoreType(label: string | null | undefined): boolean {
  if (!label) return false;
  return STUDY_CAFE_ALIASES.has(label.trim().toLowerCase());
}

// ---------------------------------------------------------------------------
// Allowed genres (spec §2/§3) — display names vs. canonical runtime codes
// ---------------------------------------------------------------------------

/** The 3 study-cafe families keyed by canonical code, with their display names. */
export const STUDY_CAFE_ALLOWED_GENRE_DISPLAY: ReadonlyArray<{ code: StudyCafeGenre; label: string }> = [
  { code: 'lofi', label: 'Lo-fi' },
  { code: 'ambient', label: 'Ambient / Ambience' },
  { code: 'jazz', label: 'Jazz' },
];

export type StudyCafeGenre = 'lofi' | 'ambient' | 'jazz';

/** Canonical runtime genre codes allowed for study cafe (fixed; cannot be widened by users). */
export const STUDY_CAFE_ALLOWED_GENRES: ReadonlySet<StudyCafeGenre> = new Set<StudyCafeGenre>([
  'lofi',
  'ambient',
  'jazz',
]);

/**
 * Genres that must ALWAYS be blocked even if they co-occur with an allowed genre
 * (spec §3: "복수 장르 중 미허용 장르로 판정된 곡 → Blocked"). This is a belt-and-suspenders
 * list of well-known non-allowed music genres; the primary gate is the whitelist, so a
 * genre absent from this set is still blocked when it is not an allowed family.
 */
const STUDY_CAFE_HARD_BLOCK_GENRES: ReadonlySet<string> = new Set([
  'pop', 'popinstrumental', 'acousticpop', 'kpop', 'jpop', 'citypop', 'ballad',
  'rnb', 'krnb', 'hiphop', 'rap', 'trap', 'drill', 'rock', 'metal', 'punk',
  'edm', 'house', 'techno', 'trance', 'dubstep', 'electronic', 'synthwave', 'hyperpop',
  'classical', 'newage', 'cinematic', 'funk', 'soul', 'blues', 'indie', 'bossanova',
  'reggae', 'latin', 'kids', 'chillhop', 'jazzhop', 'lounge', 'disco',
]);

/** Normalize a raw genre string to a comparable canonical token (lower + alnum only). */
export function normalizeGenreToken(raw: string | null | undefined): string {
  return (raw ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Map a normalized genre token to one of the 3 allowed study-cafe families, or null.
 * Family membership is prefix-based on a clean primary genre (e.g. `lofihiphop` → lofi,
 * `ambientdrone` → ambient, `jazzy` → jazz) so descriptive suffixes on an allowed family
 * do not evade the whitelist — the loudness/energy of those variants is caught by the
 * calm gate, not here.
 */
export function canonicalStudyGenre(raw: string | null | undefined): StudyCafeGenre | null {
  const t = normalizeGenreToken(raw);
  if (!t) return null;
  // An explicit hard-block genre is never an allowed family, even if it shares a prefix.
  if (STUDY_CAFE_HARD_BLOCK_GENRES.has(t)) return null;
  if (t === 'lofi' || t.startsWith('lofi')) return 'lofi';
  if (t.startsWith('ambient') || t.startsWith('ambience')) return 'ambient';
  if (t === 'jazz' || t.startsWith('jazz')) return 'jazz';
  return null;
}

// ---------------------------------------------------------------------------
// Calm thresholds (spec §5) — extremely calm, no-drop, no-drama music only
// ---------------------------------------------------------------------------

export const STUDY_CAFE_CALM = {
  /** track_audio_features.energy (0..1). Above → too energetic. */
  energyMax: 0.5,
  /** track_audio_features.bpm. Above → up-tempo (swing/big-band/fusion jazz, driving lofi). */
  bpmMax: 110,
  /** track_audio_features.danceability (0..1). Above → danceable / drop-driven. */
  danceabilityMax: 0.6,
  /** track_audio_features.brightness (0..1). Above → high-frequency stimulation. */
  brightnessMax: 0.72,
  /** track_audio_features.loudness (dBFS, negative). Above → too loud / aggressive. */
  loudnessMaxDb: -7,
} as const;

/**
 * Moods that make a track ineligible regardless of genre/vocal (spec §5: no dark/tense/
 * cinematic/dramatic/danceable moods). Matched as substrings against lower-cased mood text.
 */
const STUDY_CAFE_BLOCK_MOODS: readonly string[] = [
  'dark', 'horror', 'tense', 'tension', 'aggressive', 'intense', 'angry', 'anxious',
  'cinematic', 'epic', 'dramatic', 'grand', 'energetic', 'danceable', 'party', 'exciting',
  'uplifting', 'hype',
];

// ---------------------------------------------------------------------------
// Vocal states (spec §4) — only a *confirmed* no-vocal track may proceed
// ---------------------------------------------------------------------------

/** vocal_type values that positively indicate a human voice / vocal element. */
const VOCAL_TYPE_POSITIVE: ReadonlySet<string> = new Set([
  'vocal', 'rap', 'spoken', 'humming', 'chorus', 'narration',
  'vocalsample', 'vocalchop', 'voice', 'soft_vocal', 'softvocal',
]);
/** vocal_type values that positively indicate NO vocal. */
const VOCAL_TYPE_INSTRUMENTAL: ReadonlySet<string> = new Set(['instrumental', 'none']);

export type HasVocal = true | false | 'unknown';

// ---------------------------------------------------------------------------
// Track input shape (normalized from DB rows; field names mirror the schema)
// ---------------------------------------------------------------------------

/**
 * Normalized track view used by the policy. Mirrors columns from `tracks` +
 * `track_audio_features` + `track_ai_metadata`. All fields are nullable to model
 * missing analysis explicitly (spec §4: missing vocal analysis ⇒ blocked).
 */
export interface StudyCafeTrack {
  /** Primary/canonical genre (tracks.main_genre). */
  mainGenre?: string | null;
  /** Secondary genre (tracks.sub_genre). */
  subGenre?: string | null;
  /** Legacy single genre (tracks.genre). */
  genre?: string | null;
  /** Extra genre tags (tracks.genre_tags). */
  genreTags?: readonly string[] | null;
  /** Mood text (tracks.mood) + any ai mood tags, joined or separate. */
  mood?: string | null;
  aiMoods?: readonly string[] | null;

  /** tracks.instrumental — true positively asserts no vocal. */
  instrumental?: boolean | null;
  /** tracks.vocal_type / track_ai_metadata.ai_vocal_type. */
  vocalType?: string | null;
  /** track_audio_features.vocal_presence (0..1). null = not analyzed. */
  vocalPresence?: number | null;
  /** track_audio_features.speechiness (0..1). null = not analyzed. */
  speechiness?: number | null;
  /** track_audio_features.instrumentalness (0..1). null = not analyzed. */
  instrumentalness?: number | null;

  /** track_audio_features.energy (0..1). null = not analyzed. */
  energy?: number | null;
  /** track_audio_features.bpm. */
  bpm?: number | null;
  /** track_audio_features.danceability (0..1). */
  danceability?: number | null;
  /** track_audio_features.brightness (0..1). */
  brightness?: number | null;
  /** track_audio_features.loudness (dBFS). */
  loudness?: number | null;
}

export type StudyCafeReason =
  | 'STUDY_CAFE_GENRE_NOT_ALLOWED'
  | 'STUDY_CAFE_VOCAL_NOT_ALLOWED'
  | 'STUDY_CAFE_NOT_CALM_ENOUGH'
  | 'STUDY_CAFE_ELIGIBLE';

export interface StudyCafeEligibility {
  eligible: boolean;
  reason: StudyCafeReason;
  /** Optional detail token for logs/telemetry (never a hard contract). */
  detail?: string;
}

// ---------------------------------------------------------------------------
// Gate 1 — genre whitelist
// ---------------------------------------------------------------------------

/** Collect every non-empty genre signal from a track. */
function genreSignals(track: StudyCafeTrack): string[] {
  const raw = [track.mainGenre, track.genre, track.subGenre, ...(track.genreTags ?? [])];
  return raw.map(normalizeGenreToken).filter((t) => t.length > 0);
}

/**
 * True when the track's genres are entirely within the allowed families AND at least one
 * genre signal is present. A null/unclassified genre is NOT calm-safe → blocked (spec §3).
 * Any signal that is a known hard-block genre (or not an allowed family) blocks the track,
 * even when another signal is allowed ("복수 장르 중 미허용 장르").
 */
export function isAllowedStudyCafeGenre(track: StudyCafeTrack): boolean {
  const signals = genreSignals(track);
  if (signals.length === 0) return false; // null / unclassified → block
  // primary must resolve to an allowed family
  const primary =
    canonicalStudyGenre(track.mainGenre) ??
    canonicalStudyGenre(track.genre) ??
    canonicalStudyGenre(track.subGenre);
  if (primary == null) return false;
  // every signal must be an allowed family and none an explicit hard-block genre
  for (const s of signals) {
    if (STUDY_CAFE_HARD_BLOCK_GENRES.has(s)) return false;
    if (canonicalStudyGenre(s) == null) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Gate 2 — vocal (confirmed-false only)
// ---------------------------------------------------------------------------

/**
 * Resolve a tri-state hasVocal. Returns:
 *   true    — a vocal element is positively present
 *   false   — no vocal is *confirmed* by an explicit positive-instrumental signal
 *   unknown — evidence is missing/ambiguous (spec §4 ⇒ must be blocked)
 *
 * A title/tag/genre containing "instrumental" is deliberately NOT sufficient on its own —
 * only a real analysis value (instrumental flag / vocal_type / analyzed vocal_presence)
 * can confirm `false` (spec §4).
 */
export function resolveHasVocal(track: StudyCafeTrack): HasVocal {
  const vt = normalizeGenreToken(track.vocalType);

  // Positive vocal signals → definitely has vocal.
  if (vt && VOCAL_TYPE_POSITIVE.has(vt)) return true;
  if (track.vocalPresence != null && track.vocalPresence > 0.15) return true;
  if (track.speechiness != null && track.speechiness > 0.2) return true;

  // Confirmed-instrumental requires an explicit positive no-vocal signal AND no missing
  // analysis. `instrumental === true` alone is a boolean with a `false` default in the DB,
  // so it must be corroborated by vocal_type or an analyzed vocal_presence to count.
  const analyzedNoVocal =
    track.vocalPresence != null && track.vocalPresence <= 0.15;
  const vocalTypeInstrumental = !!vt && VOCAL_TYPE_INSTRUMENTAL.has(vt);

  if (track.instrumental === true && (vocalTypeInstrumental || analyzedNoVocal)) return false;
  if (vocalTypeInstrumental && analyzedNoVocal) return false;
  if (vocalTypeInstrumental && track.instrumentalness != null && track.instrumentalness >= 0.7) {
    return false;
  }

  // Anything else — missing/ambiguous → unknown.
  return 'unknown';
}

/** Study cafe requires hasVocal === false. true or unknown ⇒ blocked (spec §4). */
export function isVocalConfirmedFalse(track: StudyCafeTrack): boolean {
  return resolveHasVocal(track) === false;
}

// ---------------------------------------------------------------------------
// Gate 3 — calm enough
// ---------------------------------------------------------------------------

function moodText(track: StudyCafeTrack): string {
  return [track.mood ?? '', ...(track.aiMoods ?? [])].join(' ').toLowerCase();
}

/**
 * True only when the track is extremely calm (spec §5). Requires the intensity analysis to
 * exist: a null `energy` means intensity is unknown → NOT calm-safe → blocked. Every other
 * feature blocks only when present and over its ceiling (a missing optional feature does not
 * by itself grant eligibility because `energy` presence is already mandatory).
 */
export function isCalmEnoughForStudyCafe(track: StudyCafeTrack): boolean {
  // intensity must be measured
  if (track.energy == null) return false;
  if (track.energy > STUDY_CAFE_CALM.energyMax) return false;

  if (track.bpm != null && track.bpm > STUDY_CAFE_CALM.bpmMax) return false;
  if (track.danceability != null && track.danceability > STUDY_CAFE_CALM.danceabilityMax) return false;
  if (track.brightness != null && track.brightness > STUDY_CAFE_CALM.brightnessMax) return false;
  if (track.loudness != null && track.loudness > STUDY_CAFE_CALM.loudnessMaxDb) return false;

  const mt = moodText(track);
  if (mt && STUDY_CAFE_BLOCK_MOODS.some((m) => mt.includes(m))) return false;

  return true;
}

// ---------------------------------------------------------------------------
// Top-level evaluation (spec §6)
// ---------------------------------------------------------------------------

/**
 * Evaluate a single track against the full study-cafe hard filter, short-circuiting in the
 * spec's order: genre → vocal → calm. Returns an eligibility with a stable reason code.
 */
export function evaluateStudyCafeTrack(track: StudyCafeTrack): StudyCafeEligibility {
  if (!isAllowedStudyCafeGenre(track)) {
    return { eligible: false, reason: 'STUDY_CAFE_GENRE_NOT_ALLOWED' };
  }
  if (!isVocalConfirmedFalse(track)) {
    return {
      eligible: false,
      reason: 'STUDY_CAFE_VOCAL_NOT_ALLOWED',
      detail: resolveHasVocal(track) === true ? 'vocal_present' : 'vocal_unknown',
    };
  }
  if (!isCalmEnoughForStudyCafe(track)) {
    return { eligible: false, reason: 'STUDY_CAFE_NOT_CALM_ENOUGH' };
  }
  return { eligible: true, reason: 'STUDY_CAFE_ELIGIBLE' };
}

/** Convenience predicate for filtering candidate pools / queues. */
export function isStudyCafeEligible(track: StudyCafeTrack): boolean {
  return evaluateStudyCafeTrack(track).eligible;
}

/**
 * Filter a list of tracks to only study-cafe-eligible ones. This is a HARD filter: there is
 * no fallback to non-eligible tracks (spec §8). Callers that need a substitute must draw
 * another track from the SAME eligible pool or surface an empty state — never widen genre or
 * relax vocal/calm because the pool is thin.
 */
export function filterStudyCafeEligible<T extends StudyCafeTrack>(tracks: readonly T[]): T[] {
  return tracks.filter((t) => isStudyCafeEligible(t));
}

// ---------------------------------------------------------------------------
// Admin/HQ display descriptor (spec §11)
// ---------------------------------------------------------------------------

export interface StudyCafePolicyDescriptor {
  storeType: string;
  storeTypeLabel: string;
  allowedGenres: string[];
  vocalPolicy: string;
  musicIntensity: string;
  candidatePolicy: string;
}

/** Static descriptor shown on admin/HQ status boards for study-cafe stores (spec §11). */
export const STUDY_CAFE_POLICY_DESCRIPTOR: StudyCafePolicyDescriptor = {
  storeType: STUDY_CAFE_STORE_TYPE,
  storeTypeLabel: '스터디카페',
  allowedGenres: STUDY_CAFE_ALLOWED_GENRE_DISPLAY.map((g) => g.label),
  vocalPolicy: '무보컬 전용',
  musicIntensity: 'Very Calm',
  candidatePolicy: 'Strict',
};
