#!/usr/bin/env node
// .env 와 Supabase 연결 가능 여부를 점검합니다.
// 사용:  node scripts/check-env.mjs

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const reset = '\x1b[0m';
const dim = '\x1b[2m';
const red = '\x1b[31m';
const green = '\x1b[32m';
const yellow = '\x1b[33m';
const cyan = '\x1b[36m';

function ok(msg) {
  console.log(`${green}✓${reset} ${msg}`);
}
function warn(msg) {
  console.log(`${yellow}!${reset} ${msg}`);
}
function err(msg) {
  console.log(`${red}✗${reset} ${msg}`);
}
function info(msg) {
  console.log(`${dim}${msg}${reset}`);
}

function parseEnv(path) {
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, 'utf8');
  const env = {};
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
  return env;
}

console.log(`\n${cyan}스르륵 플리 — 환경 점검${reset}\n`);

const envPath = resolve(process.cwd(), '.env');
const env = parseEnv(envPath);

if (!env) {
  err('.env 파일이 없어요.');
  info('  cp .env.example .env  로 만든 뒤 값을 채워주세요.');
  process.exit(1);
}

const url = env.VITE_SUPABASE_URL;
const anon = env.VITE_SUPABASE_ANON_KEY;
let fail = 0;

if (!url || url.includes('your-project')) {
  err('VITE_SUPABASE_URL 가 비어있거나 자리표시자 그대로예요.');
  fail++;
} else if (!/^https:\/\/[a-z0-9-]+\.supabase\.co/i.test(url)) {
  warn(`VITE_SUPABASE_URL 형식이 이상해요: ${url}`);
} else {
  ok(`VITE_SUPABASE_URL = ${url}`);
}

if (!anon || anon === 'your-anon-key') {
  err('VITE_SUPABASE_ANON_KEY 가 비어있거나 자리표시자 그대로예요.');
  fail++;
} else if (anon.length < 40) {
  warn('VITE_SUPABASE_ANON_KEY 가 너무 짧아요 — JWT 가 아닐 수 있어요.');
} else {
  ok(`VITE_SUPABASE_ANON_KEY = ${anon.slice(0, 12)}…${anon.slice(-6)}`);
}

const demoOn = env.VITE_ENABLE_DEMO_MODE === 'true';
if (demoOn) {
  const urls = (env.VITE_DEMO_AUDIO_URLS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (urls.length === 0) {
    warn('VITE_ENABLE_DEMO_MODE=true 인데 VITE_DEMO_AUDIO_URLS 가 비어있어요.');
  } else {
    ok(`데모 모드 ON · 데모 URL ${urls.length}개`);
  }
}

if (fail === 0 && url && anon) {
  console.log(`\n${cyan}Supabase /rest/v1/ 연결을 확인합니다…${reset}`);
  try {
    const res = await fetch(`${url}/rest/v1/`, {
      headers: { apikey: anon, Authorization: `Bearer ${anon}` },
    });
    if (res.ok || res.status === 404) {
      ok(`Supabase 응답 OK (HTTP ${res.status})`);
    } else {
      warn(`HTTP ${res.status} ${res.statusText} — 키 또는 URL 확인 필요`);
    }
  } catch (e) {
    warn(`연결 실패: ${e?.message ?? e}`);
  }
}

console.log();
if (fail > 0) {
  err('환경 변수가 비었어요. .env 파일을 채운 뒤 다시 실행해주세요.');
  process.exit(1);
}

console.log(`${green}준비 완료. 다음 단계:${reset}`);
console.log(`  ${dim}1.${reset} supabase 대시보드 SQL Editor 에서 ${cyan}supabase/schema.sql${reset} 실행`);
console.log(`  ${dim}2.${reset} (선택) ${cyan}supabase/seed.sql${reset} 실행 — 더미 플리`);
console.log(`  ${dim}3.${reset} Storage 에 ${cyan}audio${reset}, ${cyan}covers${reset} 버킷 (Public) 생성`);
console.log(`  ${dim}4.${reset} 본인 계정으로 가입 → SQL 로 role='admin' 변경`);
console.log(`  ${dim}5.${reset} ${cyan}npm run dev${reset}\n`);
