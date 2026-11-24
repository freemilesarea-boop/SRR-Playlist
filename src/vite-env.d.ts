/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  readonly VITE_ENABLE_DEMO_MODE?: string;
  readonly VITE_DEMO_AUDIO_URLS?: string;
  /** '1' = Android 빌드에 google-services.json 포함(FCM 사용 가능). vite.config.ts 가 빌드할 때 정한다. */
  readonly VITE_ANDROID_PUSH_READY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface WakeLockSentinel extends EventTarget {
  readonly released: boolean;
  readonly type: 'screen';
  release(): Promise<void>;
}

interface WakeLock {
  request(type: 'screen'): Promise<WakeLockSentinel>;
}

interface Navigator {
  wakeLock?: WakeLock;
}
