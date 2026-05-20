import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(url && anon);

/**
 * 모든 Supabase 요청에 hard timeout 적용.
 *
 * 배경: supabase-js 의 기본 fetch 는 timeout 이 없어, Slow 3G / 토큰 refresh
 * deadlock / 네트워크 불안정 시 Promise 가 영원히 pending → 페이지의 loading
 * state 가 finally 에 도달하지 못하고 "불러오는 중…" 무한 고착 (P0).
 *
 * 정책:
 * - 호출자가 이미 signal 을 넘기면 그대로 존중 (취소 로직 보존)
 * - 아니면 25초 AbortController 를 부착 → 초과 시 reject → 페이지 catch/finally 동작
 * - 25s 는 일반 RPC/select(수백ms) 에 충분하고, 대용량 업로드도 대부분 커버.
 *   진짜 hang 만 끊어 무한 로딩을 방지.
 */
const REQUEST_TIMEOUT_MS = 25_000;

function fetchWithTimeout(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  // 호출자가 signal 을 명시했으면 우리 timeout 을 강제하지 않음
  if (init?.signal) {
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
