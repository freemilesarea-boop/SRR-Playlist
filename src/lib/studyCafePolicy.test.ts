import { describe, it, expect } from 'vitest';
import {
  STUDY_CAFE_STORE_TYPE,
  STUDY_CAFE_ALLOWED_GENRES,
  STUDY_CAFE_POLICY_DESCRIPTOR,
  isStudyCafeStoreType,
  canonicalStudyGenre,
  isAllowedStudyCafeGenre,
  resolveHasVocal,
  isVocalConfirmedFalse,
  isCalmEnoughForStudyCafe,
  evaluateStudyCafeTrack,
  isStudyCafeEligible,
  filterStudyCafeEligible,
  type StudyCafeTrack,
} from '@/lib/studyCafePolicy';

/**
 * A fully-eligible baseline track: allowed genre, confirmed instrumental, very calm.
 * Individual tests override single fields to isolate each gate.
 */
function track(overrides: Partial<StudyCafeTrack> = {}): StudyCafeTrack {
  return {
    mainGenre: 'Lo-fi',
    subGenre: null,
    genre: null,
    genreTags: null,
    mood: 'calm',
    aiMoods: null,
    instrumental: true,
    vocalType: 'instrumental',
    vocalPresence: 0.05,
    speechiness: 0.02,
    instrumentalness: 0.95,
    energy: 0.3,
    bpm: 80,
    danceability: 0.3,
    brightness: 0.4,
    loudness: -14,
    ...overrides,
  };
}

describe('store-type identity (spec §1)', () => {
  it('exposes the internal code study_cafe', () => {
    expect(STUDY_CAFE_STORE_TYPE).toBe('study_cafe');
  });
  it('recognizes study-cafe aliases (free-text business_category / industry_type)', () => {
    for (const label of ['study_cafe', 'Study Cafe', '스터디카페', '스터디 카페', '독서실', '  스터디카페 ']) {
      expect(isStudyCafeStoreType(label)).toBe(true);
    }
  });
  it('does not match other store types or empty', () => {
    for (const label of ['cafe', '카페', 'hospital', '', null, undefined]) {
      expect(isStudyCafeStoreType(label)).toBe(false);
    }
  });
});

describe('canonical allowed genres (spec §2/§3)', () => {
  it('allows exactly Lo-fi / Ambient / Jazz canonical codes', () => {
    expect([...STUDY_CAFE_ALLOWED_GENRES].sort()).toEqual(['ambient', 'jazz', 'lofi']);
  });
  it('maps display names to canonical codes', () => {
    expect(canonicalStudyGenre('Lo-fi')).toBe('lofi');
    expect(canonicalStudyGenre('Ambient')).toBe('ambient');
    expect(canonicalStudyGenre('Ambience')).toBe('ambient');
    expect(canonicalStudyGenre('Jazz')).toBe('jazz');
  });
  it('returns null for non-allowed / hard-block genres', () => {
    for (const g of ['Pop', 'Pop Instrumental', 'Classical', 'New Age', 'Cinematic', 'Bossa Nova', 'Chillhop', 'Jazzhop']) {
      expect(canonicalStudyGenre(g)).toBeNull();
    }
  });
});

describe('genre gate (spec §3)', () => {
  it('Lo-fi / Ambient / Jazz pass the genre gate', () => {
    expect(isAllowedStudyCafeGenre(track({ mainGenre: 'Lo-fi' }))).toBe(true);
    expect(isAllowedStudyCafeGenre(track({ mainGenre: 'Ambient' }))).toBe(true);
    expect(isAllowedStudyCafeGenre(track({ mainGenre: 'Jazz' }))).toBe(true);
  });

  const blocked = [
    'Pop', 'Pop Instrumental', 'Acoustic Pop', 'Acoustic Instrumental', 'Ballad', 'R&B',
    'Hip-hop', 'Rock', 'EDM', 'House', 'Classical', 'New Age', 'Cinematic', 'Funk', 'Soul',
    'Indie', 'K-pop', 'J-pop', 'Bossa Nova',
  ];
  it.each(blocked)('blocks non-allowed genre: %s', (g) => {
    expect(isAllowedStudyCafeGenre(track({ mainGenre: g }))).toBe(false);
    expect(evaluateStudyCafeTrack(track({ mainGenre: g })).reason).toBe('STUDY_CAFE_GENRE_NOT_ALLOWED');
  });

  it('blocks unclassified genre and null genre (spec §3)', () => {
    expect(isAllowedStudyCafeGenre(track({ mainGenre: null, genre: null, subGenre: null, genreTags: null }))).toBe(false);
    expect(isAllowedStudyCafeGenre(track({ mainGenre: '', genre: '', subGenre: '' }))).toBe(false);
  });

  it('blocks a multi-genre track where any genre is non-allowed', () => {
    // Jazz primary but tagged Pop → blocked
    expect(isAllowedStudyCafeGenre(track({ mainGenre: 'Jazz', genreTags: ['Pop'] }))).toBe(false);
    expect(isAllowedStudyCafeGenre(track({ mainGenre: 'Lo-fi', subGenre: 'Hip-hop' }))).toBe(false);
  });

  it('Pop Instrumental is blocked even though it is instrumental (spec §3)', () => {
    const t = track({ mainGenre: 'Pop Instrumental', instrumental: true, vocalType: 'instrumental' });
    expect(evaluateStudyCafeTrack(t).reason).toBe('STUDY_CAFE_GENRE_NOT_ALLOWED');
  });
});

describe('vocal gate — confirmed-false only (spec §4)', () => {
  it('confirmed instrumental → hasVocal false → eligible path continues', () => {
    expect(resolveHasVocal(track())).toBe(false);
    expect(isVocalConfirmedFalse(track())).toBe(true);
  });

  it('vocal true (vocal_type vocal) → blocked', () => {
    const t = track({ vocalType: 'vocal', instrumental: false, vocalPresence: 0.8 });
    expect(resolveHasVocal(t)).toBe(true);
    expect(evaluateStudyCafeTrack(t).reason).toBe('STUDY_CAFE_VOCAL_NOT_ALLOWED');
  });

  it.each(['rap', 'humming', 'chorus', 'spoken', 'narration', 'vocalsample', 'vocalchop'])(
    'vocal element %s → blocked',
    (vt) => {
      const t = track({ vocalType: vt, instrumental: false, vocalPresence: 0.5 });
      expect(resolveHasVocal(t)).toBe(true);
      expect(evaluateStudyCafeTrack(t).reason).toBe('STUDY_CAFE_VOCAL_NOT_ALLOWED');
    },
  );

  it('vocal unknown (no analysis) → blocked', () => {
    const t = track({ vocalType: null, instrumental: false, vocalPresence: null, speechiness: null, instrumentalness: null });
    expect(resolveHasVocal(t)).toBe('unknown');
    expect(evaluateStudyCafeTrack(t).reason).toBe('STUDY_CAFE_VOCAL_NOT_ALLOWED');
  });

  it('vocal null (vocal analysis value missing) → blocked', () => {
    const t = track({ vocalType: null, instrumental: true, vocalPresence: null });
    // instrumental=true default-boolean alone is NOT a confirmation → unknown → block
    expect(resolveHasVocal(t)).toBe('unknown');
    expect(evaluateStudyCafeTrack(t).reason).toBe('STUDY_CAFE_VOCAL_NOT_ALLOWED');
  });

  it('instrumental TAG + vocal unknown → blocked (spec §4: tag alone insufficient)', () => {
    // "instrumental" metadata hint present, but the actual vocal analysis value is missing
    // (no analyzed vocal_presence, no instrumental flag) → still unknown → blocked.
    const t = track({ mainGenre: 'Lo-fi', vocalType: 'instrumental', instrumental: null, vocalPresence: null, instrumentalness: null });
    expect(isVocalConfirmedFalse(t)).toBe(false);
    expect(evaluateStudyCafeTrack(t).reason).toBe('STUDY_CAFE_VOCAL_NOT_ALLOWED');
  });

  it('high vocal_presence overrides an instrumental flag → blocked', () => {
    const t = track({ instrumental: true, vocalType: 'instrumental', vocalPresence: 0.7 });
    expect(resolveHasVocal(t)).toBe(true);
    expect(evaluateStudyCafeTrack(t).reason).toBe('STUDY_CAFE_VOCAL_NOT_ALLOWED');
  });

  it('Lo-fi + vocal, Ambient + vocal sample, Jazz + humming → all blocked', () => {
    expect(evaluateStudyCafeTrack(track({ mainGenre: 'Lo-fi', vocalType: 'vocal', instrumental: false, vocalPresence: 0.6 })).eligible).toBe(false);
    expect(evaluateStudyCafeTrack(track({ mainGenre: 'Ambient', vocalType: 'vocalsample', instrumental: false, vocalPresence: 0.4 })).eligible).toBe(false);
    expect(evaluateStudyCafeTrack(track({ mainGenre: 'Jazz', vocalType: 'humming', instrumental: false, vocalPresence: 0.3 })).eligible).toBe(false);
  });
});

describe('calm gate (spec §5)', () => {
  it('low-energy calm Lo-fi / Ambient / Jazz → eligible', () => {
    expect(evaluateStudyCafeTrack(track({ mainGenre: 'Lo-fi' })).reason).toBe('STUDY_CAFE_ELIGIBLE');
    expect(evaluateStudyCafeTrack(track({ mainGenre: 'Ambient', energy: 0.2, bpm: 70 })).reason).toBe('STUDY_CAFE_ELIGIBLE');
    expect(evaluateStudyCafeTrack(track({ mainGenre: 'Jazz', energy: 0.28, bpm: 90 })).reason).toBe('STUDY_CAFE_ELIGIBLE');
  });

  it('high-energy Lo-fi → blocked', () => {
    expect(evaluateStudyCafeTrack(track({ energy: 0.85 })).reason).toBe('STUDY_CAFE_NOT_CALM_ENOUGH');
  });
  it('strong-drum / danceable Lo-fi → blocked', () => {
    expect(evaluateStudyCafeTrack(track({ danceability: 0.85 })).reason).toBe('STUDY_CAFE_NOT_CALM_ENOUGH');
  });
  it('up-tempo Jazz → blocked', () => {
    expect(evaluateStudyCafeTrack(track({ mainGenre: 'Jazz', bpm: 150 })).reason).toBe('STUDY_CAFE_NOT_CALM_ENOUGH');
  });
  it('swing Jazz (high tempo + energy) → blocked', () => {
    expect(evaluateStudyCafeTrack(track({ mainGenre: 'Jazz', bpm: 140, energy: 0.7 })).reason).toBe('STUDY_CAFE_NOT_CALM_ENOUGH');
  });
  it('dark Ambient → blocked (mood)', () => {
    expect(evaluateStudyCafeTrack(track({ mainGenre: 'Ambient', mood: 'dark tense' })).reason).toBe('STUDY_CAFE_NOT_CALM_ENOUGH');
  });
  it('cinematic Ambient → blocked (mood + brightness)', () => {
    expect(evaluateStudyCafeTrack(track({ mainGenre: 'Ambient', aiMoods: ['cinematic'], brightness: 0.9 })).reason).toBe('STUDY_CAFE_NOT_CALM_ENOUGH');
  });
  it('loud/aggressive bass → blocked', () => {
    expect(evaluateStudyCafeTrack(track({ loudness: -3 })).reason).toBe('STUDY_CAFE_NOT_CALM_ENOUGH');
  });
  it('missing intensity analysis (energy null) → blocked', () => {
    expect(evaluateStudyCafeTrack(track({ energy: null })).reason).toBe('STUDY_CAFE_NOT_CALM_ENOUGH');
  });

  it('isCalmEnoughForStudyCafe direct: calm passes, over-ceiling fails', () => {
    expect(isCalmEnoughForStudyCafe(track({ energy: 0.3, bpm: 80 }))).toBe(true);
    expect(isCalmEnoughForStudyCafe(track({ energy: 0.9 }))).toBe(false);
    expect(isCalmEnoughForStudyCafe(track({ energy: null }))).toBe(false);
  });
});

describe('end-to-end evaluation order & pool filter', () => {
  it('eligible track passes all three gates', () => {
    const r = evaluateStudyCafeTrack(track());
    expect(r.eligible).toBe(true);
    expect(r.reason).toBe('STUDY_CAFE_ELIGIBLE');
  });

  it('genre gate short-circuits before vocal/calm', () => {
    // non-allowed genre + vocal present + not calm → still reports GENRE first
    const t = track({ mainGenre: 'Pop', vocalType: 'vocal', instrumental: false, energy: 0.95 });
    expect(evaluateStudyCafeTrack(t).reason).toBe('STUDY_CAFE_GENRE_NOT_ALLOWED');
  });

  it('filterStudyCafeEligible keeps only eligible tracks (hard filter, no fallback)', () => {
    const pool: StudyCafeTrack[] = [
      track({ mainGenre: 'Lo-fi' }), // eligible
      track({ mainGenre: 'Pop Instrumental' }), // genre block
      track({ mainGenre: 'Ambient', vocalType: 'vocal', instrumental: false, vocalPresence: 0.7 }), // vocal block
      track({ mainGenre: 'Jazz', bpm: 160, energy: 0.8 }), // calm block
      track({ mainGenre: 'Jazz', energy: 0.25, bpm: 85 }), // eligible
    ];
    const kept = filterStudyCafeEligible(pool);
    expect(kept).toHaveLength(2);
    expect(kept.every(isStudyCafeEligible)).toBe(true);
  });

  it('an empty eligible pool never widens to non-eligible tracks', () => {
    const pool: StudyCafeTrack[] = [
      track({ mainGenre: 'Pop Instrumental' }),
      track({ mainGenre: 'Classical' }),
    ];
    expect(filterStudyCafeEligible(pool)).toHaveLength(0);
  });
});

describe('admin/HQ descriptor (spec §11)', () => {
  it('exposes the minimum display fields', () => {
    expect(STUDY_CAFE_POLICY_DESCRIPTOR).toMatchObject({
      storeType: 'study_cafe',
      allowedGenres: ['Lo-fi', 'Ambient / Ambience', 'Jazz'],
      vocalPolicy: '무보컬 전용',
      musicIntensity: 'Very Calm',
      candidatePolicy: 'Strict',
    });
  });
});
