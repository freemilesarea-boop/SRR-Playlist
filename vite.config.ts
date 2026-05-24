import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
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
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/.*\.supabase\.co\/storage\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'supabase-audio-cache',
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 60 * 60 * 24 * 7,
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
              rangeRequests: true,
            },
          },
        ],
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
});
