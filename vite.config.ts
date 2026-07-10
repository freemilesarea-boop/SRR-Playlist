import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';

// 빌드 시점 BUILD_ID — main.tsx 의 SW_RELOAD_KEY + src/sw.ts 의 __SW_BUILD_ID__ 가 공유.
// 같은 빌드 안에서 한 번 평가되어 양쪽 모두 같은 값을 가짐.
const BUILD_ID = Date.now().toString(36);

// WEB-OPT-7 — 초기 라우트에서 즉시 사용하는 데이터 origin(Supabase REST/RPC/Storage)의
//   TLS/DNS 연결을 HTML 파싱 시점에 미리 준비(preconnect)한다. index.html 에는 font CDN
//   preconnect 만 있고, 정작 가장 먼저 호출되는 데이터 origin 은 누락되어 있었다.
//   origin 은 Vite 가 번들에 baking 하는 것과 동일한 env 값에서 유도한다(환경별 정확).
//   Vercel 은 빌드 시 프로젝트 env 를 process.env 로 노출하므로 여기서 읽는다.
//   env 가 없으면(로컬 등) 아무 것도 주입하지 않는다(no-op).
function safeOrigin(u?: string): string {
  if (!u) return '';
  try {
    return new URL(u).origin;
  } catch {
    return '';
  }
}
const SUPABASE_ORIGIN = safeOrigin(process.env.VITE_SUPABASE_URL);

// WEB-OPT-2 — index.html 의 emergency watchdog 이 build 스코프 가드를 쓸 수 있도록
// %BUILD_ID% placeholder 를 빌드 시 실제 BUILD_ID 로 치환한다. (index.html 은 precache 제외됨)
// WEB-OPT-7 — 위 Supabase origin preconnect 도 함께 주입.
const injectBuildIdIntoHtml = {
  name: 'srr-inject-build-id',
  transformIndexHtml(html: string) {
    const out = html.replace(/%BUILD_ID%/g, BUILD_ID);
    if (!SUPABASE_ORIGIN) return out;
    // supabase-js fetch 는 cors + credential 없음 → anonymous 커넥션이므로 crossorigin preconnect 와 일치.
    return {
      html: out,
      tags: [
        {
          tag: 'link',
          attrs: { rel: 'preconnect', href: SUPABASE_ORIGIN, crossorigin: '' },
          injectTo: 'head-prepend' as const,
        },
      ],
    };
  },
};

export default defineConfig({
  plugins: [
    react(),
    injectBuildIdIntoHtml,
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
        // WEB-OPT-2 — index.html 은 precache 에서 제외.
        // 오래된 SW 가 구버전 index.html(→ 죽은 chunk hash)을 Cache Storage 에서 반환해
        // 새로고침 백지가 되는 문제를 차단. hashed JS/CSS/asset precache 는 유지.
        // NavigationRoute/NetworkFirst 신규 추가 없음 — 최소 수정으로 `/` 는 네트워크에서 최신 HTML.
        globIgnores: ['index.html', '**/index.html'],
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
        // WEB-OPT-3 — recharts 를 manualChunks 에서 제거.
        //   object-form manualChunks 로 recharts 를 단일 vendor chunk 로 강제하면,
        //   recharts 를 쓰는 여러 lazy route(Dashboard/Artist/Salesperson/EnterpriseHqIntel)가
        //   그 공용 vendor chunk 를 공유하면서 Rollup 이 이를 "entry 의 static import"로 hoist →
        //   ~412KB 가 초기 로딩(entry + modulepreload)에 eager 유입되던 원인(WEB-OPT-1 확인).
        //   규칙을 제거하면 Rollup 기본 code-split 이 recharts 를 async(lazy) route chunk 안에 유지 →
        //   차트 route 진입 시에만 다운로드. (react/supabase 는 초기 필수, icons/dnd 는 공용 → 유지)
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          supabase: ['@supabase/supabase-js'],
          dnd: ['@dnd-kit/core', '@dnd-kit/sortable', '@dnd-kit/utilities'],
          icons: ['lucide-react'],
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
