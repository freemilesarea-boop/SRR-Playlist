// AI-MUSIC-1 — AI Music Director. STATIC industry rule catalog (카페/병원/헬스장/와인바 …) mapping a store
// type + day-part to a recommended mood/energy. RULE-based only — NO LLM. It produces a *plan
// recommendation*; it never builds, deploys, or plays a playlist.

import type { DirectorPlan, DirectorSlot } from './types';

const RULES: Record<string, DirectorSlot[]> = {
  cafe: [
    { part: '오전', hours: '07-11', mood: ['calm', 'acoustic', 'jazz'], energy: 'low', note: '차분한 시작 — 대화 방해 없는 배경음' },
    { part: '점심', hours: '11-14', mood: ['bright', 'bossa', 'pop'], energy: 'medium', note: '밝고 가벼운 분위기' },
    { part: '오후', hours: '14-18', mood: ['chill', 'lofi'], energy: 'low-medium', note: '집중/휴식 지원' },
    { part: '저녁', hours: '18-22', mood: ['warm', 'soul', 'acoustic'], energy: 'medium', note: '아늑한 마무리' },
  ],
  hospital: [
    { part: '대기시간', hours: '전일', mood: ['calm', 'ambient', 'classical'], energy: 'low', note: '불안 완화 — 자극 낮은 음악, 보컬 최소' },
  ],
  gym: [
    { part: '운동시간', hours: '06-22', mood: ['energetic', 'edm', 'hiphop'], energy: 'high', note: '높은 BPM/에너지 — 운동 리듬 유지' },
  ],
  winebar: [
    { part: '저녁', hours: '18-24', mood: ['jazz', 'soul', 'lounge'], energy: 'low-medium', note: '무드 있는 저녁 — 보컬/재즈 중심' },
  ],
  retail: [
    { part: '영업시간', hours: '10-21', mood: ['pop', 'upbeat'], energy: 'medium-high', note: '활기 — 회전율/체류 균형' },
  ],
  office: [
    { part: '업무시간', hours: '09-18', mood: ['focus', 'ambient', 'lofi'], energy: 'low', note: '집중 지원 — 가사 최소' },
  ],
  spa: [
    { part: '전일', hours: '전일', mood: ['ambient', 'nature', 'meditation'], energy: 'low', note: '이완 — 매우 낮은 에너지' },
  ],
};

const GENERAL: DirectorSlot[] = [
  { part: '오전', hours: '07-12', mood: ['calm', 'bright'], energy: 'low-medium', note: '무난한 시작' },
  { part: '오후', hours: '12-18', mood: ['pop', 'chill'], energy: 'medium', note: '균형' },
  { part: '저녁', hours: '18-23', mood: ['warm', 'soul'], energy: 'medium', note: '마무리' },
];

/** Return the rule-based day-part plan for a store type (falls back to a general plan). */
export function musicDirectorPlan(storeType: string | null): DirectorPlan {
  const key = (storeType ?? '').toLowerCase();
  const slots = RULES[key] ?? GENERAL;
  return { storeType: storeType ?? 'general', slots, source: 'RULE' };
}

export function allDirectorRuleTypes(): string[] { return Object.keys(RULES); }
