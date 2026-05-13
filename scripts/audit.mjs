#!/usr/bin/env node
/**
 * scripts/audit.mjs
 *
 * SRR Playlist 환경 감사 스크립트.
 *
 * 사용법:
 *   # .env 가 프로젝트 루트에 있으면 자동 로드
 *   npm run audit
 *
 *   # 또는 직접
 *   VITE_SUPABASE_URL=... VITE_SUPABASE_ANON_KEY=... node scripts/audit.mjs
 *
 * 확인 항목:
 *   1) 환경 변수
 *   2) Supabase REST 접속
 *   3) 필수 public 테이블 (anon RLS 통과하는 것)
 *   4) 필수 RPC (anon 권한)
 *   5) Storage 버킷 public 여부 (audio, covers — 알려진 더미 경로 HEAD)
 *
 * 한계:
 *   - anon key 만 사용 — admin_* / RLS 보호 테이블은 verifying 불가
 *   - "RPC 존재" vs "데이터 0행" 구분만 가능 (PGRST202 vs 빈 결과)
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// ---------- .env 자동 로드 (단순 파서) ----------
const envPath = resolve(ROOT, '.env');
if (existsSync(envPath)) {
  const raw = readFileSync(envPath, 'utf8');
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) {
      let v = m[2];
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      process.env[m[1]] = v;
    }
  }
}

const URL_ = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const KEY = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

// ---------- 출력 유틸 ----------
const OK = '\x1b[32m✅\x1b[0m';
const FAIL = '\x1b[31m❌\x1b[0m';
const WARN = '\x1b[33m🟡\x1b[0m';
const DIM = (s) => `\x1b[2m${s}\x1b[0m`;

let totalChecks = 0;
let pass = 0;
let fail = 0;
let warn = 0;

function logCheck(name, status, detail = '') {
  totalChecks++;
  const icon = status === 'pass' ? OK : status === 'warn' ? WARN : FAIL;
  if (status === 'pass') pass++;
  else if (status === 'warn') warn++;
  else fail++;
  console.log(`  ${icon} ${name}${detail ? ` ${DIM(`— ${detail}`)}` : ''}`);
}

function section(title) {
  console.log('\n\x1b[1m' + title + '\x1b[0m');
}

// ---------- 1) env 체크 ----------
section('1) 환경 변수');
if (!URL_) {
  logCheck('VITE_SUPABASE_URL', 'fail', '누락');
  console.log('\n.env 또는 환경변수에 VITE_SUPABASE_URL 을 설정하세요.');
  process.exit(1);
}
if (!KEY) {
  logCheck('VITE_SUPABASE_ANON_KEY', 'fail', '누락');
  process.exit(1);
}
logCheck('VITE_SUPABASE_URL', 'pass', URL_.replace(/^https:\/\//, '').slice(0, 40));
logCheck('VITE_SUPABASE_ANON_KEY', 'pass', `${KEY.slice(0, 12)}…`);

// ---------- 2) REST 접속 ----------
section('2) Supabase REST 접속');
async function restGet(path) {
  const r = await fetch(`${URL_}/rest/v1/${path}`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
  });
  return { status: r.status, json: r.status < 500 ? await r.json().catch(() => null) : null };
}

const ping = await restGet('?select=*').catch((e) => ({ status: -1, error: e.message }));
if (ping.status === 200 || ping.status === 404) {
  logCheck('REST 응답', 'pass', `status ${ping.status}`);
} else {
  logCheck('REST 응답', 'fail', `status ${ping.status}`);
  process.exit(1);
}

// ---------- 3) 필수 테이블 ----------
section('3) 필수 테이블 (anon select 가능 여부)');
const TABLES = [
  // anon 가 SELECT 가능한 것만 — RLS 로 막힌 건 'warn' 처리
  ['users', 'protected'],
  ['tracks', 'public'],
  ['playlists', 'public'],
  ['playlist_tracks', 'public'],
  ['likes', 'protected'],
  ['recent_plays', 'protected'],
  ['subscription_requests', 'protected'],
  ['visitor_events', 'protected'],
  ['stream_events', 'protected'],
  ['revenue_events', 'protected'],
  ['daily_metrics', 'protected'],
  ['share_events', 'protected'],
  ['liked_tracks', 'protected'],
  ['recently_played_tracks', 'protected'],
  ['continue_listening', 'protected'],
  ['playlist_follows', 'protected'],
  ['business_profiles', 'protected'],
  ['business_music_schedules', 'protected'],
  ['business_schedule_events', 'protected'],
  ['curator_profiles', 'public'],
];

for (const [tbl, expected] of TABLES) {
  try {
    const r = await fetch(`${URL_}/rest/v1/${tbl}?select=*&limit=1`, {
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, Prefer: 'count=exact' },
    });
    if (r.status === 200) {
      const cnt = r.headers.get('content-range')?.split('/')[1] ?? '?';
      logCheck(tbl, 'pass', `count=${cnt}`);
    } else if (r.status === 401 || r.status === 403) {
      // RLS 로 막혔지만 테이블은 존재 — protected 면 정상
      logCheck(tbl, expected === 'protected' ? 'pass' : 'warn', `RLS 차단 (${r.status})`);
    } else if (r.status === 404) {
      const body = await r.json().catch(() => ({}));
      if (String(body.code || '').match(/42P01|PGRST205/) || String(body.message || '').includes('does not exist')) {
        logCheck(tbl, 'fail', `테이블 없음 (마이그레이션 미적용)`);
      } else {
        logCheck(tbl, 'fail', `status 404`);
      }
    } else {
      logCheck(tbl, 'fail', `status ${r.status}`);
    }
  } catch (e) {
    logCheck(tbl, 'fail', e.message);
  }
}

// ---------- 4) 필수 RPC ----------
section('4) 필수 RPC (anon 권한)');
const RPCS = [
  // [name, args, allow_empty]
  ['search_catalog', { q: 'a', limit_count: 1 }],
  ['get_track_chart', { period: 'daily', limit_count: 1 }],
  ['get_genre_chart', { period: 'weekly' }],
  ['get_track_chart_by_genre', { genre_filter: '', period: 'weekly', limit_count: 1 }],
  ['recommend_tracks_by_context', { p_limit: 1 }],
  ['recommend_similar_tracks', { p_track_id: '00000000-0000-0000-0000-000000000000', p_limit: 1 }],
  ['recommend_playlists_by_context', { p_limit: 1 }],
  ['get_playlist_follow_counts', { p_playlist_ids: [] }],
  ['get_popular_playlists_by_follows', { p_limit: 1 }],
  ['get_curator_profile', { p_handle: 'no-such-handle' }],
  ['get_featured_curators', { p_limit: 1 }],
  ['search_curators', { p_query: 'a' }],
];

async function callRpc(name, args) {
  const r = await fetch(`${URL_}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}

for (const [name, args] of RPCS) {
  try {
    const r = await callRpc(name, args);
    if (r.status === 200 || r.status === 204) {
      const sz = Array.isArray(r.body) ? r.body.length : r.body ? 1 : 0;
      logCheck(name, 'pass', `→ ${sz} rows`);
    } else if (r.status === 404 || (r.body && /PGRST202|function .+ does not exist/.test(JSON.stringify(r.body)))) {
      logCheck(name, 'fail', `RPC 없음 (마이그레이션 확인)`);
    } else if (r.status === 401 || r.status === 403) {
      logCheck(name, 'warn', `권한 거부 (status ${r.status})`);
    } else {
      const msg = r.body?.message || `status ${r.status}`;
      logCheck(name, 'warn', msg.slice(0, 70));
    }
  } catch (e) {
    logCheck(name, 'fail', e.message);
  }
}

// ---------- 5) Storage 버킷 public ----------
section('5) Storage 버킷 public 여부');
for (const bucket of ['audio', 'covers']) {
  try {
    // 존재하지 않을 path 라도 public bucket 이면 404, private 면 400 반환
    const r = await fetch(`${URL_}/storage/v1/object/public/${bucket}/__probe__.bin`, {
      method: 'HEAD',
    });
    if (r.status === 404) {
      logCheck(`bucket '${bucket}'`, 'pass', 'public (HEAD 404 = 정상)');
    } else if (r.status === 400) {
      logCheck(`bucket '${bucket}'`, 'fail', 'private 일 가능성 — 대시보드에서 public 토글');
    } else {
      logCheck(`bucket '${bucket}'`, 'warn', `status ${r.status}`);
    }
  } catch (e) {
    logCheck(`bucket '${bucket}'`, 'fail', e.message);
  }
}

// ---------- 요약 ----------
section('요약');
console.log(`  총 ${totalChecks}개 — ${OK} ${pass} 통과, ${WARN} ${warn} 경고, ${FAIL} ${fail} 실패`);
if (fail > 0) {
  console.log(`\n${FAIL} 실패 항목이 있어요. 위 로그의 'fail' 줄을 확인하세요.`);
  process.exit(1);
} else {
  console.log(`\n${OK} 환경 확인 완료.`);
}
