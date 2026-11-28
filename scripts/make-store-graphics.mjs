/**
 * make-store-graphics.mjs — 플레이스토어 등록정보용 그래픽을 만든다 (npm run store-graphics).
 *
 * 플레이는 두 이미지를 규격에 딱 맞게 요구하고, 1px 만 어긋나도 업로드를 거부한다:
 *   앱 아이콘    512 x 512     PNG, 1MB 이하
 *   그래픽 이미지 1024 x 500    PNG, 15MB 이하
 *
 * 아이콘은 알파를 없앤다. 플레이가 투명 배경을 검정으로 합성해 버리는 일이 있어서다.
 *
 * 글자(듣다 / 매장 배경음악)는 앱과 같은 Pretendard 로 그린다. 폰트를 못 찾으면
 * 엉뚱한 폰트로 렌더되느니 글자를 빼고 마크만 그린다 — 브랜드 그래픽에
 * 깨진 타이포가 들어가는 것보다 낫다.
 */
import sharp from 'sharp';
import { mkdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(root, 'store');
const SRC = resolve(root, 'assets/icon-only.png');            // 배경까지 들어간 정사각 아이콘
const SRC_MARK = resolve(root, 'assets/icon-foreground.png'); // 투명 배경 위의 마크만

// 브랜드 보라 — assets/icon-background.png 에서 뽑은 값이다.
const BRAND = '#7B3FF2';
const BRAND_DEEP = '#5A28C8';

function hasPretendard() {
  try {
    return execFileSync('fc-list', { encoding: 'utf8' }).toLowerCase().includes('pretendard');
  } catch {
    return false; // fc-list 가 없는 환경(맥 등)에서는 조용히 글자 없이 간다
  }
}

const withText = hasPretendard();

async function icon512() {
  const out = resolve(outDir, 'play-icon-512.png');
  await sharp(SRC)
    .resize(512, 512, { fit: 'cover' })
    .flatten({ background: BRAND })   // 알파 제거
    .png({ compressionLevel: 9 })
    .toFile(out);
  return out;
}

async function feature1024x500() {
  const out = resolve(outDir, 'play-feature-1024x500.png');
  const W = 1024, H = 500;

  // 글자는 잘릴 수 있는 가장자리에서 떨어뜨리고 가운데 쪽에 모은다.
  const text = withText
    ? `<text x="404" y="232" font-family="Pretendard" font-weight="700"
             font-size="104" fill="#FFFFFF" letter-spacing="-2">듣다</text>
       <text x="408" y="296" font-family="Pretendard" font-weight="600"
             font-size="38" fill="#FFFFFF" fill-opacity="0.82" letter-spacing="-1">매장 배경음악</text>`
    : '';

  const bg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="${BRAND}"/>
        <stop offset="100%" stop-color="${BRAND_DEEP}"/>
      </linearGradient>
    </defs>
    <rect width="${W}" height="${H}" fill="url(#g)"/>
    <circle cx="880" cy="70" r="240" fill="#FFFFFF" fill-opacity="0.06"/>
    <circle cx="120" cy="450" r="190" fill="#FFFFFF" fill-opacity="0.05"/>
    ${text}
  </svg>`);

  // icon-only 를 쓰면 그 자체의 보라 배경이 그라디언트 위에 네모로 도드라진다.
  // 투명 배경인 foreground 를 쓰고, 어댑티브 아이콘용 여백은 trim 으로 털어낸다.
  const mark = await sharp(SRC_MARK)
    .trim()
    .resize(196, 196, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .toBuffer();

  await sharp(bg)
    .composite([{ input: mark, left: 152, top: 152 }])
    .png({ compressionLevel: 9 })
    .toFile(out);
  return out;
}

for (const f of [SRC, SRC_MARK]) {
  if (!existsSync(f)) {
    console.error(`✗ 원본이 없습니다: ${f}`);
    process.exit(1);
  }
}
mkdirSync(outDir, { recursive: true });

const files = [await icon512(), await feature1024x500()];
for (const f of files) {
  const m = await sharp(f).metadata();
  console.log(`✓ ${f.replace(root + '/', '')} — ${m.width}x${m.height}`);
}
if (!withText) {
  console.log('! Pretendard 를 못 찾아 그래픽 이미지에 글자를 넣지 않았습니다.');
}
