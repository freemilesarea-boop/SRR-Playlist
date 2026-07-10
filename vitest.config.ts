import { defineConfig } from 'vitest/config';

// Phase BRAND-PLAYER-UX-1 — 순수 로직 단위 테스트용 최소 설정.
// 현재는 src/lib/brandSlideshow 등 DOM 비의존 순수 함수만 대상(node 환경).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    globals: false,
  },
});
