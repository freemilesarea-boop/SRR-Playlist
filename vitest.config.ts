import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// 순수 로직(node) + 컴포넌트(jsdom, 파일별 @vitest-environment) 테스트 공용 설정.
// 기본 환경은 node 유지 — 컴포넌트 테스트 파일 상단에 `// @vitest-environment jsdom` 선언.
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    setupFiles: ['src/test/setup.ts'],
    globals: false,
  },
});
