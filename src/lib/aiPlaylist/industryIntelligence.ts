// AI-MUSIC-2 — Industry Intelligence. STATIC per-industry playlist rules (카페/병원/헬스/와인바/쇼룸/호텔/
// 오피스/네일샵/스터디카페) → target genres/moods, energy profile, instrumental target. RULE-based only —
// NO LLM. Shapes a *proposed* playlist; it never changes the real Player/Playlist.

import type { IndustryPlaylistRule, EnergyProfile } from './types';

interface Rule { genres: string[]; moods: string[]; energy: EnergyProfile; instrumental: number; note: string; }

// Keys are normalized industry slugs. Korean labels map onto these via ALIASES below.
const RULES: Record<string, Rule> = {
  cafe: { genres: ['jazz', 'acoustic', 'bossa', 'pop'], moods: ['calm', 'bright', 'warm'], energy: 'CURVE', instrumental: 0.5, note: '차분→밝음 흐름, 대화 방해 없는 배경음' },
  hospital: { genres: ['classical', 'ambient', 'acoustic'], moods: ['calm', 'ambient'], energy: 'LOW', instrumental: 0.85, note: '불안 완화 — 자극/보컬 최소' },
  gym: { genres: ['edm', 'hiphop', 'pop'], moods: ['energetic', 'upbeat'], energy: 'HIGH', instrumental: 0.2, note: '높은 BPM/에너지 유지' },
  winebar: { genres: ['jazz', 'soul', 'lounge'], moods: ['warm', 'lounge', 'jazz'], energy: 'MEDIUM', instrumental: 0.4, note: '무드 있는 저녁 — 재즈/보컬 중심' },
  showroom: { genres: ['pop', 'electronic', 'upbeat'], moods: ['bright', 'upbeat'], energy: 'MEDIUM', instrumental: 0.35, note: '활기 — 브랜드 톤 유지' },
  hotel: { genres: ['lounge', 'jazz', 'ambient', 'classical'], moods: ['calm', 'warm', 'lounge'], energy: 'LOW', instrumental: 0.6, note: '품격 — 은은한 로비/라운지' },
  office: { genres: ['lofi', 'ambient', 'focus'], moods: ['focus', 'calm'], energy: 'LOW', instrumental: 0.8, note: '집중 지원 — 가사 최소' },
  nailshop: { genres: ['pop', 'acoustic', 'bossa'], moods: ['bright', 'calm', 'warm'], energy: 'MEDIUM', instrumental: 0.45, note: '편안+산뜻 — 케어 시간 배경' },
  studycafe: { genres: ['lofi', 'ambient', 'classical'], moods: ['focus', 'calm'], energy: 'LOW', instrumental: 0.85, note: '집중/정적 — 매우 낮은 자극' },
};

// Korean / synonym labels → canonical slug.
const ALIASES: Record<string, string> = {
  '카페': 'cafe', 'coffee': 'cafe', '병원': 'hospital', 'clinic': 'hospital', '헬스': 'gym', '헬스장': 'gym', 'fitness': 'gym',
  '와인바': 'winebar', 'bar': 'winebar', '쇼룸': 'showroom', 'retail': 'showroom', 'store': 'showroom', '호텔': 'hotel',
  '오피스': 'office', '사무실': 'office', '네일샵': 'nailshop', 'nail': 'nailshop', '스터디카페': 'studycafe', 'study': 'studycafe',
};

const GENERAL: Rule = { genres: ['pop', 'acoustic', 'chill'], moods: ['calm', 'bright', 'warm'], energy: 'CURVE', instrumental: 0.5, note: '무난한 균형 — 업종 미지정' };

function normalizeSlug(storeType: string | null): string | null {
  if (!storeType) return null;
  const raw = storeType.trim().toLowerCase();
  if (RULES[raw]) return raw;
  if (ALIASES[storeType.trim()]) return ALIASES[storeType.trim()];
  if (ALIASES[raw]) return ALIASES[raw];
  return null;
}

/** Return the rule-based playlist rule for an industry (falls back to a general rule). */
export function industryPlaylistRule(storeType: string | null): IndustryPlaylistRule {
  const slug = normalizeSlug(storeType);
  const r = (slug && RULES[slug]) || GENERAL;
  return {
    storeType: slug ?? 'general',
    targetGenres: r.genres, targetMoods: r.moods, energyProfile: r.energy, instrumentalTarget: r.instrumental,
    note: r.note, source: 'RULE',
  };
}

export function allIndustryRuleTypes(): string[] { return Object.keys(RULES); }
