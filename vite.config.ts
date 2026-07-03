import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';

// 빌드 시점 BUILD_ID — main.tsx 의 SW_RELOAD_KEY + src/sw.ts 의 __SW_BUILD_ID__ 가 공유.
// 같은 빌드 안에서 한 번 평가되어 양쪽 모두 같은 값을 가짐.
const BUILD_ID = Date.now().toString(36);

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // injectManifest 로 전환 — custom src/sw.ts 에 push handler 통합.
      // workbox 의 precache 기능은 그대로 (precacheAndRoute(self.__WB_MANIFEST)).
      // 오디오 runtimeCaching 은 절대 안 함 (Range 요청 206 깨짐 방지) — 이전 generateSW 와 동일 정책.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      // 등록은 main.tsx 에서 명시적으로 수행 (updateViaCache:'none' + focus/interval update).
      // vite-plugin-pwa 자동 registerSW.js 와의 충돌 방지 — 이중 registration 회피.
      injectRegister: null,
      includeAssets: [
        'favicon.svg',
        'favicon.ico',
        'favicon.png',
        'favicon-32.png',
        'apple-touch-icon.png',
        'og-image.png',
      ],
      manifest: {
        id: '/',
        name: '듣다',
        short_name: '듣다',
        description: '상황 기반 감성 플레이리스트 + 매장 BGM',
        theme_color: '#0a0a0a',
        background_color: '#0a0a0a',
        display: 'standalone',
        // 매장 PC/태블릿(가로) 지원 — kiosk 재생 모드에서 방향 제약 없음
        orientation: 'any',
        scope: '/',
        start_url: '/',
        // 설치 앱 바로가기: 매장 재생 모드로 바로 진입
        shortcuts: [
          {
            name: '매장 재생 모드',
            short_name: '매장 재생',
            description: '전체화면 매장 BGM 플레이어로 바로 가기',
            url: '/business/player',
          },
        ],
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
      },
      // injectManifest 모드: precache 매니페스트만 inject 하고, runtimeCaching 같은
      // workbox 옵션은 src/sw.ts 안에서 직접 제어. 오디오는 절대 SW 가 가로채지 않음
      // (이전 supabase storage CacheFirst 규칙이 오디오 Range 요청을 opaque 로 캐싱 → 206 깨짐).
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          supabase: ['@supabase/supabase-js'],
          dnd: ['@dnd-kit/core', '@dnd-kit/sortable', '@dnd-kit/utilities'],
          icons: ['lucide-react'],
          recharts: ['recharts'],
        },
      },
    },
  },
  optimizeDeps: {
    // ffmpeg.wasm 은 dynamic import + CDN 로드. Vite 가 미리 번들 처리하면
    // worker/wasm 로딩이 깨지므로 제외.
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'],
  },
  server: {
    host: true,
    port: 5173,
  },
  // production 빌드 시 console.log/debug 자동 제거 — DEV 가드 없는 80+ 호출 노이즈 일괄 청소.
  // console.warn/error 는 의도적 표시 가능성 있어 유지 (Sentry capture 와 함께 운영자 가시화).
  esbuild: {
    pure: process.env.NODE_ENV === 'production' ? ['console.log', 'console.debug', 'console.info'] : [],
  },
  // SW reload 식별자 — main.tsx (import.meta.env.VITE_BUILD_ID) 와 src/sw.ts (__SW_BUILD_ID__) 공유
  define: {
    'import.meta.env.VITE_BUILD_ID': JSON.stringify(BUILD_ID),
    __SW_BUILD_ID__: JSON.stringify(BUILD_ID),
  },
});
