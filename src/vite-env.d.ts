/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  readonly VITE_ENABLE_DEMO_MODE?: string;
  readonly VITE_DEMO_AUDIO_URLS?: string;
  // WEB-OBS-1 — Runtime telemetry pipeline (all optional; safe defaults if unset).
  readonly VITE_APP_ENV?: string;
  readonly VITE_BUILD_ID?: string;
  readonly VITE_TELEMETRY_ENABLED?: string;
  readonly VITE_TELEMETRY_TRANSPORT_ENABLED?: string;
  readonly VITE_TELEMETRY_ENDPOINT?: string;
  readonly VITE_TELEMETRY_SAMPLE_RATE?: string;
  readonly VITE_TELEMETRY_BATCH_SIZE?: string;
  readonly VITE_TELEMETRY_FLUSH_MS?: string;
  readonly VITE_TELEMETRY_MAX_BUFFER?: string;
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
