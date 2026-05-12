/**
 * 카테고리/제목으로 결정적인 그라데이션 커버를 생성합니다.
 * 같은 카테고리는 항상 같은 색이 나오도록 해시 기반.
 */

interface Palette {
  from: string;
  via: string;
  to: string;
  ring: string;
}

// 매장/감성에 어울리는 16가지 다크 그라데이션 팔레트
const PALETTES: Palette[] = [
  { from: '#7c3aed', via: '#4338ca', to: '#1e1b4b', ring: '#a78bfa' }, // violet
  { from: '#db2777', via: '#9d174d', to: '#3b0764', ring: '#f472b6' }, // pink-purple
  { from: '#0ea5e9', via: '#1e3a8a', to: '#0c1e3d', ring: '#38bdf8' }, // ocean
  { from: '#10b981', via: '#065f46', to: '#022c22', ring: '#34d399' }, // emerald
  { from: '#f97316', via: '#9a3412', to: '#431407', ring: '#fb923c' }, // sunset
  { from: '#eab308', via: '#854d0e', to: '#1c1917', ring: '#facc15' }, // amber
  { from: '#ef4444', via: '#7f1d1d', to: '#1f0a0a', ring: '#f87171' }, // crimson
  { from: '#06b6d4', via: '#155e75', to: '#0c1e26', ring: '#22d3ee' }, // cyan
  { from: '#a855f7', via: '#581c87', to: '#1e0b3a', ring: '#c084fc' }, // royal violet
  { from: '#d946ef', via: '#86198f', to: '#3b0764', ring: '#e879f9' }, // fuchsia
  { from: '#f43f5e', via: '#881337', to: '#1f0612', ring: '#fb7185' }, // rose
  { from: '#3b82f6', via: '#1e40af', to: '#0a1428', ring: '#60a5fa' }, // sky
  { from: '#14b8a6', via: '#115e59', to: '#042f2e', ring: '#2dd4bf' }, // teal
  { from: '#84cc16', via: '#3f6212', to: '#101a06', ring: '#a3e635' }, // lime
  { from: '#fb7185', via: '#9f1239', to: '#1f0612', ring: '#fda4af' }, // pastel rose
  { from: '#8b5cf6', via: '#6d28d9', to: '#2e1065', ring: '#a78bfa' }, // indigo-violet
];

// 카테고리 → 의미 기반 인덱스 (없으면 해시 폴백)
const CATEGORY_HINTS: Record<string, number> = {
  '새벽 감성': 0,
  '공부 집중': 11,
  '카페 음악': 4,
  '드라이브': 2,
  '운동': 6,
  '수면 음악': 8,
  '카페': 5,
  'PT샵': 6,
  '필라테스': 12,
  '와인바': 10,
  '네일샵': 14,
  '편집샵': 15,
  '재즈': 1,
  '라운지': 12,
};

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export function paletteFor(seed: string): Palette {
  const trimmed = seed?.trim() ?? '';
  if (CATEGORY_HINTS[trimmed] !== undefined) {
    return PALETTES[CATEGORY_HINTS[trimmed]];
  }
  // 부분 매칭 (카테고리 안에 키워드 포함된 경우)
  for (const [k, idx] of Object.entries(CATEGORY_HINTS)) {
    if (trimmed.includes(k)) return PALETTES[idx];
  }
  return PALETTES[hashStr(trimmed) % PALETTES.length];
}

export function gradientStyle(seed: string): React.CSSProperties {
  const p = paletteFor(seed);
  return {
    backgroundImage: `linear-gradient(135deg, ${p.from} 0%, ${p.via} 55%, ${p.to} 100%)`,
  };
}

export function ringColor(seed: string): string {
  return paletteFor(seed).ring;
}
