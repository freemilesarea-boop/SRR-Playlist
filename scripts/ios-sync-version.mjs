#!/usr/bin/env node
/**
 * ios-sync-version.mjs — iOS 버전·빌드 번호를 package.json 에 맞춘다.
 *
 *   MARKETING_VERSION      = package.json version          (예: 1.0.4)
 *   CURRENT_PROJECT_VERSION = major*10000 + minor*100 + patch (예: 10004)
 *
 * 빌드 번호 공식은 안드로이드 versionCode(build.gradle)와 같다. App Store Connect 는
 * 같은 버전 안에서 같은 빌드 번호를 두 번 받지 않으므로, 버전을 올리면 자동으로 올라간다.
 * 같은 버전으로 다시 올려야 할 때는 package.json 의 patch 를 하나 올린다.
 *
 * 실행 시점: `cap copy`/`cap sync` 직후(capacitor:copy:after) 와 `npm version` 때.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const version = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version;
const parts = String(version).split('.').map(Number);
if (parts.length !== 3 || parts.some((n) => !Number.isInteger(n) || n < 0)) {
  console.error(`[ios-version] package.json version 은 x.y.z 형식이어야 합니다: ${version}`);
  process.exit(1);
}
if (parts[1] > 99 || parts[2] > 99) {
  console.error(`[ios-version] minor/patch 는 99 를 넘을 수 없습니다: ${version}`);
  process.exit(1);
}
const build = parts[0] * 10000 + parts[1] * 100 + parts[2];

const pbxPath = resolve(root, 'ios/App/App.xcodeproj/project.pbxproj');
const before = readFileSync(pbxPath, 'utf8');
const after = before
  .replace(/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${version};`)
  .replace(/CURRENT_PROJECT_VERSION = [^;]+;/g, `CURRENT_PROJECT_VERSION = ${build};`);
if (after !== before) {
  writeFileSync(pbxPath, after);
  console.log(`[ios-version] ${version} (${build})`);
}
