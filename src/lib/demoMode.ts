/**
 * 데모 모드 — 시연용으로 빈 audio_url 트랙에 임시 URL을 부여합니다.
 *
 * 작동 조건:
 *   - VITE_ENABLE_DEMO_MODE === 'true'
 *   - VITE_DEMO_AUDIO_URLS 에 콤마(,)로 구분한 1개 이상의 URL이 있어야 함
 *
 * 저작권 안내:
 *   본 저장소는 데모용 음원 파일을 포함하지 않습니다.
 *   직접 권리를 확보한 음원의 공개 URL을 .env 에 직접 넣어주세요.
 *   예) Creative Commons / Royalty-Free / 본인 작곡.
 *
 * 프로덕션 기본값은 false. 운영 트래픽에서는 활성화하지 마세요.
 */
import type { TrackRow } from '@/types/db';
import { isPlayableUrl } from './audio';

export function isDemoModeEnabled(): boolean {
  return import.meta.env.VITE_ENABLE_DEMO_MODE === 'true';
}

function parseDemoUrls(): string[] {
  const raw = import.meta.env.VITE_DEMO_AUDIO_URLS ?? '';
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => isPlayableUrl(s));
}

const DEMO_URLS = parseDemoUrls();

/**
 * 빈 audio_url 을 가진 트랙에 데모 URL을 라운드 로빈으로 부여합니다.
 * 이미 audio_url 이 있는 트랙은 그대로 둡니다.
 */
export function applyDemoMode<T extends Pick<TrackRow, 'audio_url'>>(tracks: T[]): T[] {
  if (!isDemoModeEnabled() || DEMO_URLS.length === 0) return tracks;
  let i = 0;
  return tracks.map((t) => {
    if (isPlayableUrl(t.audio_url)) return t;
    const url = DEMO_URLS[i % DEMO_URLS.length];
    i += 1;
    return { ...t, audio_url: url };
  });
}

export function demoStatus(): { enabled: boolean; urlCount: number } {
  return { enabled: isDemoModeEnabled(), urlCount: DEMO_URLS.length };
}
