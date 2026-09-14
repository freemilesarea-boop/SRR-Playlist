// PWA-BUILD-IDENTITY-OBSERVABILITY-16A §12 — 14개 시나리오를 1:1 로 옮긴다.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  classifyBuildFreshness, isPageSwBuildMismatch, resolveBuildMatrix,
  scriptPathOf, IDENTITY_PAYLOAD_KEYS,
  type NavigationType,
} from './pwaBuildIdentity';

const R = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf-8');
const sql0523 = R('supabase/migrations/0523_pwa_build_identity.sql');
const swSrc = R('src/sw.ts');
const apiSrc = R('src/lib/api/brandPlayerApi.ts');
const hookSrc = R('src/hooks/useBrandPlayerHeartbeat.ts');
const viteSrc = R('vite.config.ts');

const NEW = '837a38cbe9ec';
const OLD = 'aabbccddeeff';

describe('1. heartbeat 에 pageBuildHash 를 싣는다', () => {
  it('RPC 호출에 p_page_build_hash 가 들어간다', () => {
    expect(apiSrc).toContain('p_page_build_hash: identity?.pageBuildHash ?? null');
    expect(apiSrc).toContain('p_sw_build_hash');
    expect(apiSrc).toContain('p_sw_controlled');
    expect(apiSrc).toContain('p_navigation_type');
  });

  it('두 heartbeat 경로(트랙 변경 · 60초 주기) 모두 identity 를 싣는다', () => {
    const calls = hookSrc.match(/brandPlayerHeartbeat\([^)]*buildIdentityPayload\(\)\)/g) ?? [];
    expect(calls.length).toBe(2);
  });

  it('서버 기대값을 복사해 보내지 않는다 — 자기 빌드 해시만 보낸다', () => {
    // pageBuildHash() 는 빌드 시 주입된 값. 서버에서 받은 값을 되돌려주는 경로가 없어야 한다.
    expect(hookSrc).toContain('pageBuildHash: pageBuildHash()');
    expect(hookSrc).not.toMatch(/expected[A-Za-z]*BuildHash/);
  });
});

describe('2. 구버전 클라이언트가 buildHash 를 안 보내도 heartbeat 는 정상', () => {
  it('새 인자는 전부 default null 이다', () => {
    for (const arg of ['p_page_build_hash text default null',
      'p_sw_build_hash text default null',
      'p_sw_controlled boolean default null',
      'p_navigation_type text default null']) {
      expect(sql0523).toContain(arg);
    }
  });

  it('옛 4인자 시그니처를 새 함수 **생성 전에** 지운다', () => {
    // 공존하면 4개짜리 호출이 두 후보를 다 만족해 ambiguous 로 실패한다 —
    // 정작 보호하려던 구버전 매장의 heartbeat 가 끊긴다.
    const dropAt = sql0523.indexOf(
      'drop function if exists public.brand_player_heartbeat(uuid, text, uuid, text);');
    const createAt = sql0523.indexOf('create or replace function public.brand_player_heartbeat(');
    expect(dropAt).toBeGreaterThan(-1);
    expect(dropAt).toBeLessThan(createAt);
  });

  it('null 을 보내도 마지막으로 알던 값을 지우지 않는다', () => {
    expect(sql0523).toContain(
      "page_build_hash = coalesce(nullif(btrim(p_page_build_hash),''), page_build_hash)");
  });
});

describe('3~5. stale 분류 — CURRENT / STALE / UNKNOWN', () => {
  it('3. 기대값과 같으면 CURRENT', () => {
    expect(classifyBuildFreshness(NEW, NEW)).toBe('CURRENT');
  });

  it('4. 다르면 STALE', () => {
    expect(classifyBuildFreshness(NEW, OLD)).toBe('STALE');
  });

  it('5. 안 보냈으면 UNKNOWN — CURRENT 로 취급하지 않는다', () => {
    // 2026-09-14 09:52 숙대점이 정확히 이 경우다. CURRENT 로 세면 사고가 사라진다.
    for (const missing of [null, undefined, '', '   ']) {
      expect(classifyBuildFreshness(NEW, missing)).toBe('UNKNOWN');
    }
  });

  it('기대값이 없으면 비교 자체가 불가 — UNKNOWN', () => {
    expect(classifyBuildFreshness(null, NEW)).toBe('UNKNOWN');
    expect(classifyBuildFreshness('', NEW)).toBe('UNKNOWN');
  });

  it('SQL 도 같은 규칙을 쓴다 (UNKNOWN 을 CURRENT 로 흘리지 않는다)', () => {
    expect(sql0523).toContain("when coalesce(btrim(s.page_build_hash),'') = '' then 'UNKNOWN'");
    expect(sql0523).toContain("when coalesce(btrim(p_expected_build_hash),'') = '' then 'UNKNOWN'");
  });
});

describe('6. SW identity 메시지 응답', () => {
  it('SW 가 GET_SW_IDENTITY 에 SW_IDENTITY 로 답한다', () => {
    expect(swSrc).toContain("event.data.type === 'GET_SW_IDENTITY'");
    expect(swSrc).toContain("type: 'SW_IDENTITY'");
  });

  it('compile-time build hash 를 주입받는다 — scriptURL 로는 구분 불가하므로', () => {
    expect(viteSrc).toContain('__SW_BUILD_HASH__: JSON.stringify(BUILD_HASH)');
    expect(swSrc).toContain('__SW_BUILD_HASH__');
  });

  it('precacheEntryCount · scope · activatedAt 을 함께 답한다', () => {
    expect(swSrc).toContain('precacheEntryCount: PRECACHE_ENTRY_COUNT');
    expect(swSrc).toContain('scope: self.registration.scope');
    expect(swSrc).toContain('activatedAt,');
  });

  it('SKIP_WAITING 경로를 망가뜨리지 않는다 (early return)', () => {
    const i = swSrc.indexOf("event.data.type === 'SKIP_WAITING'");
    const j = swSrc.indexOf("event.data.type === 'GET_SW_IDENTITY'");
    expect(i).toBeGreaterThan(-1);
    expect(i).toBeLessThan(j);
    expect(swSrc.slice(i, j)).toContain('return;');
  });
});

describe('7~9. page ↔ SW 매트릭스', () => {
  it('7. page NEW / sw NEW → A', () => {
    expect(resolveBuildMatrix({
      expected: NEW, pageBuildHash: NEW, swBuildHash: NEW, controlled: true,
    })).toBe('A_PAGE_NEW_SW_NEW');
  });

  it('8. page OLD / sw NEW → B (복원·HTTP 캐시 의심 구간)', () => {
    expect(resolveBuildMatrix({
      expected: NEW, pageBuildHash: OLD, swBuildHash: NEW, controlled: true,
    })).toBe('B_PAGE_OLD_SW_NEW');
  });

  it('page NEW / sw OLD → C, 둘 다 OLD → D', () => {
    expect(resolveBuildMatrix({
      expected: NEW, pageBuildHash: NEW, swBuildHash: OLD, controlled: true,
    })).toBe('C_PAGE_NEW_SW_OLD');
    expect(resolveBuildMatrix({
      expected: NEW, pageBuildHash: OLD, swBuildHash: OLD, controlled: true,
    })).toBe('D_PAGE_OLD_SW_OLD');
  });

  it('9. controller 없음 → E (해시보다 먼저 판정된다)', () => {
    expect(resolveBuildMatrix({
      expected: NEW, pageBuildHash: NEW, swBuildHash: NEW, controlled: false,
    })).toBe('E_NO_CONTROLLER');
  });

  it('하나라도 모르면 UNKNOWN — 추측으로 A 를 만들지 않는다', () => {
    expect(resolveBuildMatrix({
      expected: NEW, pageBuildHash: null, swBuildHash: NEW, controlled: true,
    })).toBe('UNKNOWN');
    expect(resolveBuildMatrix({
      expected: NEW, pageBuildHash: NEW, swBuildHash: null, controlled: true,
    })).toBe('UNKNOWN');
  });
});

describe('9b. mismatch 는 관측 이벤트일 뿐', () => {
  it('둘 다 알 때만 mismatch 라고 말한다', () => {
    expect(isPageSwBuildMismatch(NEW, OLD)).toBe(true);
    expect(isPageSwBuildMismatch(NEW, NEW)).toBe(false);
    expect(isPageSwBuildMismatch(NEW, null)).toBe(false);
    expect(isPageSwBuildMismatch(null, NEW)).toBe(false);
  });

  it('mismatch 발견이 리로드·복구를 부르지 않는다', () => {
    const i = hookSrc.indexOf('isPageSwBuildMismatch');
    const seg = hookSrc.slice(i, i + 600);
    expect(seg).not.toMatch(/reloadApp|location\.reload|handleRemoteCommand|hardRecovery/);
  });
});

describe('10. navigation type 직렬화', () => {
  it('알려진 값만 저장한다 — 자유 텍스트를 쌓지 않는다', () => {
    expect(sql0523).toContain(
      "v_nav := case when p_navigation_type in ('navigate','reload','back_forward','prerender','unknown')");
  });

  it('타입 목록이 PerformanceNavigationTiming 과 일치한다', () => {
    const all: NavigationType[] = ['navigate', 'reload', 'back_forward', 'prerender', 'unknown'];
    for (const t of all) expect(sql0523).toContain(`'${t}'`);
  });
});

describe('11. PII 없음', () => {
  it('payload 키가 네 개로 고정돼 있다', () => {
    expect([...IDENTITY_PAYLOAD_KEYS].sort()).toEqual(
      ['navigationType', 'pageBuildHash', 'swBuildHash', 'swControlled']);
  });

  it('scriptURL 은 경로만 남기고 origin·쿼리를 버린다', () => {
    expect(scriptPathOf('https://deudda.com/sw.js?v=1#x')).toBe('/sw.js');
    expect(scriptPathOf(null)).toBeNull();
    expect(scriptPathOf('not a url')).toBeNull();
  });

  it('식별 가능한 값을 새로 수집하지 않는다', () => {
    const src = R('src/lib/pwaBuildIdentity.ts');
    for (const bad of ['navigator.userAgent', 'geolocation', 'advertisingId',
      'ANDROID_ID', 'getSerial', 'email']) {
      expect(src).not.toContain(bad);
    }
  });
});

describe('12. 기존 heartbeat 하위호환', () => {
  it('identity 인자는 선택적이다 — 안 넘겨도 컴파일·동작한다', () => {
    expect(apiSrc).toContain('identity?: HeartbeatBuildIdentity');
  });

  it('반환 계약(success/command/command_id/session_id)을 그대로 둔다', () => {
    for (const k of ["'success', true", "'command', v_cmd",
      "'command_id', v_cmd_id", "'session_id', v_sid"]) {
      expect(sql0523).toContain(k);
    }
  });

  it('권한이 기존과 같다 — 매장 클라이언트(authenticated)가 부른다', () => {
    expect(sql0523).toContain('to authenticated, service_role;');
    expect(sql0523).toMatch(/revoke all on function public\.brand_player_heartbeat[\s\S]{0,120}from public, anon;/);
  });
});

describe('13~14. 재생·SW 동작 무변경 (regression 가드)', () => {
  it('13. navigation caching 전략을 건드리지 않는다', () => {
    // 이번 Phase 는 관측만이다. 원인 증명 전에 재생 가용성 tradeoff 를 만들지 않는다.
    expect(swSrc).not.toContain('NavigationRoute');
    expect(swSrc).not.toContain('NetworkFirst');
    expect(swSrc).not.toContain('navigateFallback');
    expect(swSrc).not.toContain('createHandlerBoundToURL');
  });

  it('14. precache / skipWaiting / clientsClaim 이 그대로다', () => {
    expect(swSrc).toContain('self.skipWaiting();');
    expect(swSrc).toContain('clientsClaim();');
    expect(swSrc).toContain('cleanupOutdatedCaches();');
    // injectManifest 가 `self.__WB_MANIFEST` 를 소스에서 정확히 한 번만 허용하므로
    // 한 번 꺼내 상수에 담고 precache 와 엔트리 수에 함께 쓴다. precache 대상은 그대로다.
    expect(swSrc).toContain('const WB_MANIFEST = self.__WB_MANIFEST;');
    expect(swSrc).toContain('precacheAndRoute(WB_MANIFEST);');
  });

  it('오디오 runtimeCaching 을 여전히 두지 않는다 (Range 206 보호)', () => {
    expect(swSrc).not.toContain('registerRoute(');
    expect(swSrc).not.toContain('CacheFirst');
  });

  it('관측이 실패해도 heartbeat 를 막지 않는다', () => {
    // SW 응답이 없으면 null 로 두고 계속 간다.
    expect(hookSrc).toContain('cachedSwBuildHash = id?.swBuildHash ?? null');
  });
});

describe('관측 전용 — 명령·Slack 자동 발송 없음 (§8)', () => {
  it('build identity 함수 본문이 명령·알림을 만들지 않는다', () => {
    // 범위를 이 함수 본문으로 좁힌다 — heartbeat 함수는 원래 brand_player_commands
    // 를 읽는 것이 정상 동작이라 파일 전체로 보면 안 된다.
    const start = sql0523.indexOf('create or replace function public.brand_player_build_identity(');
    const end = sql0523.indexOf('comment on function public.brand_player_build_identity');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const body = sql0523.slice(start, end);
    for (const bad of ['brand_player_commands', '_notify_brand_player_alert',
      'admin_notifications', 'request_store_recovery', 'insert', 'update ']) {
      expect(body).not.toContain(bad);
    }
  });

  it('service_role 만 조회할 수 있다', () => {
    expect(sql0523).toContain(
      'revoke all on function public.brand_player_build_identity(text, integer) from public, anon, authenticated;');
  });
});

describe('10b. Cache-Control — SPA 문서 경로 (§10)', () => {
  const cfg = JSON.parse(R('vercel.json')) as {
    headers: { source: string; headers: { key: string; value: string }[] }[];
  };
  const ccRules = cfg.headers
    .map((h) => ({ source: h.source, cc: h.headers.find((x) => x.key === 'Cache-Control')?.value }))
    .filter((r): r is { source: string; cc: string } => !!r.cc);

  it('SPA 문서 경로에 재검증 규칙이 생겼다', () => {
    const spa = ccRules.find((r) => r.source === '/((?!assets/|ffmpeg/|api/).*)');
    expect(spa).toBeDefined();
    expect(spa!.cc).toBe('public, max-age=0, must-revalidate');
  });

  it('해시 자산은 여전히 immutable — 부정 전방탐색으로 구문상 겹칠 수 없다', () => {
    const assets = ccRules.find((r) => r.source === '/assets/(.*)');
    expect(assets!.cc).toBe('public, max-age=31536000, immutable');
    // 새 규칙은 assets/ 를 배제한다. 문자열로 고정해 둔다.
    expect(ccRules.some((r) => r.source.includes('(?!assets/'))).toBe(true);
  });

  it('새 규칙이 /assets/ 보다 앞에 온다 (같은 key 는 뒤가 이긴다)', () => {
    const order = ccRules.map((r) => r.source);
    expect(order.indexOf('/((?!assets/|ffmpeg/|api/).*)'))
      .toBeLessThan(order.indexOf('/assets/(.*)'));
  });

  it('HTML 문서 응답에 장기 immutable 이 붙지 않는다', () => {
    for (const doc of ['/', '/index.html', '/manifest.webmanifest', '/sw.js']) {
      const rule = ccRules.find((r) => r.source === doc);
      expect(rule!.cc).not.toContain('immutable');
      expect(rule!.cc).toContain('must-revalidate');
    }
  });
});
