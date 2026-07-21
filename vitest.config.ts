import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Phase BRAND-PLAYER-UX-1/2 — 순수 로직 단위 테스트용 최소 설정.
// src/lib 의 DOM 비의존 순수 함수 대상(node 환경). '@/' 별칭을 앱과 동일하게 해석.
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'api/**/*.test.ts'],
    globals: false,
  },
});
