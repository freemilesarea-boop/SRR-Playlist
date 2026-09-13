import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Phase BRAND-PLAYER-UX-1/2 — 순수 로직 단위 테스트용 최소 설정.
// src/lib 의 DOM 비의존 순수 함수 대상(node 환경). '@/' 별칭을 앱과 동일하게 해석.
//
// HARD-RECOVERY-6 — .test.tsx 도 포함한다. 오디오 엘리먼트 identity 교체처럼
// React DOM 이 있어야만 증명되는 것이 있다. 해당 파일만 상단 docblock 으로
// `@vitest-environment jsdom` 을 선언하므로, 기존 node 테스트 동작은 그대로다.
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    globals: false,
  },
});
