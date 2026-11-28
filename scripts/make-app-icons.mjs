/**
 * make-app-icons — 앱 아이콘 · 스플래시 원본(assets/*.png)을 브랜드 마크에서 만든다.
 *
 * 왜 스크립트냐: 마크는 SVG 한 벌뿐이고(Logo.tsx 의 Construction Sheet 와 같은 좌표),
 * 나머지는 전부 그것을 크기·색만 바꿔 얹은 것이다. 손으로 만든 PNG 를 저장소에 쌓으면
 * 다음에 로고가 바뀔 때 무엇을 다시 만들어야 하는지 아무도 모른다. 여기서 다시 돌리면 된다.
 *
 *   node scripts/make-app-icons.mjs        # assets/*.png 생성
 *   npx capacitor-assets generate --android --ios   # 그걸 각 플랫폼 해상도로 펼침
 *
 * PWA 아이콘(public/pwa-*.png)은 건드리지 않는다 — vite-plugin-pwa 가 따로 관리한다.
 */
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'assets');

/** theme.css `--color-accent: 123 63 242`. 브랜드 보라. */
const ACCENT = '#7b3ff2';
/** index.html theme-color / PWA background_color. 앱의 검정. */
const INK = '#0a0a0a';
const WHITE = '#ffffff';

/**
 * 듣다 마크 — Logo.tsx LogoMark 와 같은 좌표(viewBox 220×200, stroke 16, round cap).
 * box 는 stroke 를 포함한 실제 잉크 범위다. 이걸 기준으로 가운데를 맞춘다.
 */
const MARK = {
  paths: [
    'M 100 15 A 85 85 0 0 1 100 185',
    'M 27 58 H 92',
    'M 56 100 H 92',
    'M 27 142 H 92',
  ],
  box: { x: 19, y: 7, w: 174, h: 186 },
};

/**
 * 정사각 캔버스에 마크를 얹은 SVG.
 * @param size    캔버스 한 변(px)
 * @param color   마크 색
 * @param scale   마크 높이가 캔버스의 몇 배인지
 * @param bg      배경색. null 이면 투명(adaptive icon foreground 용)
 */
function markSvg({ size, color, scale, bg = null }) {
  const { x, y, w, h } = MARK.box;
  const k = (size * scale) / h;
  const dx = (size - w * k) / 2 - x * k;
  const dy = (size - h * k) / 2 - y * k;
  const back = bg ? `<rect width="${size}" height="${size}" fill="${bg}"/>` : '';
  const strokes = MARK.paths.map((d) => `<path d="${d}"/>`).join('');
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
      back +
      `<g transform="translate(${dx} ${dy}) scale(${k})" fill="none" stroke="${color}" ` +
      `stroke-width="16" stroke-linecap="round" stroke-linejoin="round">${strokes}</g>` +
    `</svg>`,
  );
}

/** 단색 정사각 — adaptive icon 의 배경 레이어. */
function solidSvg({ size, color }) {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">` +
    `<rect width="${size}" height="${size}" fill="${color}"/></svg>`,
  );
}

/** SVG 는 width/height 를 그대로 쓴다. resize 로 최종 크기를 못 박아 둔다. */
const png = (svg, file, size) =>
  sharp(svg).resize(size, size, { fit: 'fill' }).png({ compressionLevel: 9 }).toFile(resolve(OUT, file));

await mkdir(OUT, { recursive: true });

await Promise.all([
  // 런처 아이콘(구형 · iOS) — 보라 바탕에 흰 마크. 마스킹은 플랫폼이 알아서 한다.
  png(markSvg({ size: 1024, color: WHITE, scale: 0.56, bg: ACCENT }), 'icon-only.png', 1024),

  // 안드로이드 adaptive — 배경/전경 두 장.
  // capacitor-assets 가 두 장을 108dp 레이어 안쪽 72dp(=보이는 영역)에 맞춰 넣으므로
  // 여기서의 scale 은 곧 "보이는 아이콘에서 마크가 차지하는 비율" 이다. 0.62 는
  // 원형 마스크 안에 여유 있게 들어가면서(마크의 최외곽 반지름은 높이의 0.52 배)
  // 런처 목록에서 다른 아이콘들과 비슷한 존재감이 나오는 값이다.
  png(markSvg({ size: 1024, color: WHITE, scale: 0.62 }), 'icon-foreground.png', 1024),
  png(solidSvg({ size: 1024, color: ACCENT }), 'icon-background.png', 1024),

  // 스플래시 — 라이트는 흰 바탕에 보라 마크, 다크는 앱의 검정에 흰 마크.
  png(markSvg({ size: 2732, color: ACCENT, scale: 0.18, bg: WHITE }), 'splash.png', 2732),
  png(markSvg({ size: 2732, color: WHITE, scale: 0.18, bg: INK }), 'splash-dark.png', 2732),
]);

console.log(`생성 완료 → ${OUT}`);
