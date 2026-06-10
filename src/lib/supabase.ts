import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(url && anon);

/** 현재 연결된 Supabase project ref (예: nsoesrvwkxqifjcxzvol). UI/로그 진단용. */
export const supabaseProjectRef: string = (() => {
  try {
    const host = new URL(url ?? '').host; // <ref>.supabase.co
    return host.split('.')[0] || 'unknown';
  } catch {
    return 'unknown';
  }
})();

// 어떤 프로젝트/DB 에 연결됐는지 즉시 확인 (배포본에서도 출력) — 업로드 미반영 진단용
 
console.log('[SupabaseEnv]', {
  url: url ?? '(missing)',
  projectRef: supabaseProjectRef,
  anonKeySet: Boolean(anon),
  configured: isSupabaseConfigured,
});

/**
 * 모든 Supabase 요청에 hard timeout 적용 (Storage 업로드는 예외).
 *
 * 배경: supabase-js 의 기본 fetch 는 timeout 이 없어, Slow 3G / 토큰 refresh
 * deadlock / 네트워크 불안정 시 Promise 가 영원히 pending → 페이지의 loading
 * state 가 finally 에 도달하지 못하고 "불러오는 중…" 무한 고착 (P0).
 *
 * 정책:
 * - 호출자가 이미 signal 을 넘기면 그대로 존중 (취소 로직 보존)
 * - Storage 객체 요청(/storage/v1/object/...)은 timeout 미적용.
 *   대용량/다중/느린 업로드를 25초 timeout 이 강제 abort 하면서
 *   "signal is aborted without reason" 으로 업로드가 실패하던 P0 를 방지.
 *   업로드는 완료까지 유지하고, 진짜 hang 은 앱 단(artistApi withTimeout)에서
 *   넉넉한 상한(10분)으로만 제어.
 * - 그 외 일반 RPC/select/auth 는 기존 25초 유지 → 무한 로딩 방지.
 */
const REQUEST_TIMEOUT_MS = 25_000;

/** input(string | URL | Request)에서 요청 URL 문자열을 안전하게 추출. */
function requestUrl(input: RequestInfo | URL): string {
  try {
    if (typeof input === 'string') return input;
    if (input instanceof URL) return input.href;
    if (typeof Request !== 'undefined' && input instanceof Request) return input.url;
  } catch {
    /* noop */
  }
  return String(input ?? '');
}

/** Storage 객체 업로드/다운로드 요청 여부 — timeout 미적용 대상. */
function isStorageObjectRequest(input: RequestInfo | URL): boolean {
  return requestUrl(input).includes('/storage/v1/object');
}

function fetchWithTimeout(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  // 호출자가 signal 을 명시했으면 우리 timeout 을 강제하지 않음
  if (init?.signal) {
    return fetch(input, init);
  }
  // Storage 객체 업로드는 timeout 미적용 (대용량/느린 업로드 abort 방지)
  if (isStorageObjectRequest(input)) {
    return fetch(input, init);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  return fetch(input, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
}

// Untyped client — 우리는 자체 Row 타입(@/types/db)으로 캐스팅해 사용합니다.
export const supabase = createClient(
  url || 'http://localhost:54321',
  anon || 'public-anon-key',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
    global: {
      fetch: fetchWithTimeout,
    },
  },
);
