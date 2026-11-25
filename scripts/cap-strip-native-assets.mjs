#!/usr/bin/env node
/**
 * cap-strip-native-assets.mjs — 앱 번들에 넣을 필요 없는 큰 웹 자산을 빼낸다.
 *
 * Capacitor 는 `cap copy` / `cap sync` 때 dist/ 를 통째로 앱에 복사한 뒤,
 * package.json 의 `capacitor:copy:after` 스크립트로 이 파일을 실행한다.
 *
 * 빼는 것:
 *   - ffmpeg/ (약 31MB) — 관리자·아티스트 업로드의 음원 변환에만 쓰인다. 앱에서는
 *     필요할 때 운영 사이트에서 받는다(src/lib/audioTranscode.ts 의 ffmpegBase).
 *
 * 웹 배포(dist/)는 건드리지 않는다 — 앱 쪽 복사본만 지운다.
 */
import { rmSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const WEB_DIRS = {
  android: 'android/app/src/main/assets/public',
  ios: 'ios/App/App/public',
};

const STRIP = ['ffmpeg'];

// Capacitor 가 대상 플랫폼을 알려 준다. 없으면(직접 실행) 둘 다.
const platform = process.env.CAPACITOR_PLATFORM_NAME;
const targets = platform && WEB_DIRS[platform] ? [platform] : Object.keys(WEB_DIRS);

for (const p of targets) {
  for (const rel of STRIP) {
    const target = resolve(root, WEB_DIRS[p], rel);
    if (!existsSync(target)) continue;
    rmSync(target, { recursive: true, force: true });
    console.log(`[cap-strip] ${p}: ${rel}/ 제외`);
  }
}
