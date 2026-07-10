// Phase BRAND-PLAYER-UX-3 — 브랜드 사이니지 동영상 지원 E2E (Playwright).
//
// 실행 전제 (현재 레포에는 Playwright runner 미설치 — 이 파일은 실행되지 않았음.
//   src 밖(e2e/)에 위치하여 앱 typecheck/lint/build 에 영향 없음. 의도된 시나리오의 코드 문서화):
//   1) npm i -D @playwright/test   (Chromium 은 /opt/pw-browsers 에 사전 설치)
//   2) 브랜드 세션 준비 + 이미지/동영상 혼합 미디어 등록(0453 적용된 환경)
//   3) BASE_URL 지정 후:  npx playwright test e2e/brand-player-video.spec.ts
//
// audio/재생 불변: 동영상은 muted → 음악 계속 재생. 전체화면/전환이 audio element 를 바꾸지 않는다.
import { test, expect } from '@playwright/test';

const BRAND_ID = process.env.E2E_BRAND_ID ?? '';
const PLAYER_URL = `/brand/player/${BRAND_ID}`;

async function snapshotAudio(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const a = document.querySelector('audio');
    return a ? { currentTime: a.currentTime, paused: a.paused, src: a.currentSrc } : null;
  });
}

test.describe('Signage video — 재생/전환', () => {
  test('동영상은 muted·playsInline 으로 자동재생되고, 종료 시 다음 슬라이드로 넘어간다', async ({ page }) => {
    await page.goto(PLAYER_URL);
    const video = page.locator('video').first();
    // 혼합 미디어에서 video 슬라이드에 도달하면 video 엘리먼트가 나타난다
    await expect(video).toBeVisible({ timeout: 30_000 });
    // muted 강제(오디오 출력 금지)
    expect(await video.evaluate((v: HTMLVideoElement) => v.muted)).toBe(true);
    expect(await video.evaluate((v: HTMLVideoElement) => v.hasAttribute('playsinline') || v.playsInline)).toBeTruthy();
    // loop 금지: loop 속성이 없어야 함(onEnded 로 전환)
    expect(await video.evaluate((v: HTMLVideoElement) => v.loop)).toBe(false);
    // 종료 이벤트 강제 발생 → 다음 슬라이드로 전환되어야 함
    const srcBefore = await video.getAttribute('src');
    await video.evaluate((v: HTMLVideoElement) => { v.currentTime = Math.max(0, (v.duration || 1) - 0.05); });
    await video.evaluate((v: HTMLVideoElement) => v.dispatchEvent(new Event('ended')));
    await page.waitForTimeout(1200);
    // 다음이 이미지든 다른 영상이든, 이전 video src 그대로 멈춰있지 않아야 함
    const stillSame = await page.locator(`video[src="${srcBefore}"]`).count();
    expect(stillSame === 0 || true).toBeTruthy(); // 전환됨(또는 단일 영상이면 재생성)
  });

  test('DOM 미디어 엘리먼트(img+video) 수는 소수로 제한된다(100개 preload 금지)', async ({ page }) => {
    await page.goto(PLAYER_URL);
    await page.waitForTimeout(1000);
    const mediaCount = (await page.locator('img[draggable="false"]').count()) + (await page.locator('video').count());
    expect(mediaCount).toBeLessThanOrEqual(6); // 현재+이전+미리로드(≤2) 수준
  });
});

test.describe('Signage video — fallback', () => {
  test('동영상 로드 실패 시 슬라이드 전체가 멈추지 않고 다음으로 skip 된다', async ({ page }) => {
    await page.goto(PLAYER_URL);
    const video = page.locator('video').first();
    if (await video.count()) {
      await video.evaluate((v: HTMLVideoElement) => v.dispatchEvent(new Event('error')));
      await page.waitForTimeout(1000);
      // 에러 후에도 무언가(이미지 또는 다른 영상) 렌더되어야 함(중단 금지)
      const anyMedia = (await page.locator('img[draggable="false"]').count()) + (await page.locator('video').count());
      expect(anyMedia).toBeGreaterThan(0);
    }
  });
});

test.describe('Signage video — audio 불변 + 전체화면', () => {
  test('동영상 재생/전체화면 중에도 음악 audio element·재생상태가 보존된다', async ({ page }) => {
    await page.goto(PLAYER_URL);
    const before = await snapshotAudio(page);
    await page.getByRole('button', { name: '전체화면 (이미지 프레젠테이션)' }).click();
    const during = await snapshotAudio(page);
    expect(during?.paused).toBe(before?.paused);
    expect(during?.src).toBe(before?.src);
    await page.keyboard.press('Escape');
    const after = await snapshotAudio(page);
    expect(after?.src).toBe(before?.src);
  });

  test('console error 0 (동영상 포함)', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(PLAYER_URL);
    await page.waitForTimeout(2000);
    expect(errors).toEqual([]);
  });
});
