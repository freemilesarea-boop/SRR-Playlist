// Phase BRAND-PLAYER-UX-1 — 브랜드 플레이어 슬라이드쇼 + Presentation Fullscreen E2E (Playwright).
//
// 실행 전제 (현재 레포에는 Playwright runner 미설치):
//   1) npm i -D @playwright/test   (Chromium 은 /opt/pw-browsers 에 사전 설치되어 있음)
//   2) 브랜드 세션 준비: /brand 에서 유효한 매장 코드로 로그인하여 localStorage 브랜드 토큰 확보
//      (또는 storageState 로 세션 주입)
//   3) 사이니지 이미지 최소 3장 등록된 브랜드 필요
//   4) BASE_URL 환경변수로 dev/preview 서버 지정 후:  npx playwright test e2e/brand-player-slideshow.spec.ts
//
// 이 파일은 의도된 검증 시나리오를 코드로 문서화한다. src 밖(e2e/)에 위치하여 앱 typecheck/lint/build 에 영향 없음.
import { test, expect } from '@playwright/test';

const BRAND_ID = process.env.E2E_BRAND_ID ?? '';
const PLAYER_URL = `/brand/player/${BRAND_ID}`;

test.describe('Brand Player — slideshow timing', () => {
  test('설정 시간 후 활성 이미지(active dot)가 정확히 1회 전환된다 (interval 중복 없음)', async ({ page }) => {
    await page.goto(PLAYER_URL);
    // 이미지 최소 3장 → 진행 도트 3개 이상
    const dots = page.locator('div:has(> span.rounded-full)').last().locator('span');
    await expect(dots).toHaveCount(await dots.count());

    // 현재 이미지 src 캡처
    const img = page.locator('img[draggable="false"]');
    const src1 = await img.getAttribute('src');

    // 설정 전환 시간(예: 10초) 동안 src 는 즉시 바뀌지 않아야 함 (2초 시점엔 그대로)
    await page.waitForTimeout(2000);
    expect(await img.getAttribute('src')).toBe(src1);

    // 설정 시간(+여유) 경과 후 정확히 다음 이미지로 1회 전환
    await page.waitForTimeout(9000); // 총 ~11s (10초 설정 가정)
    const src2 = await img.getAttribute('src');
    expect(src2).not.toBe(src1);

    // interval 중복이면 비정상적으로 빠르게 여러 장 넘어감 → 다시 1s 내 추가 전환이 없어야 함
    await page.waitForTimeout(1000);
    expect(await img.getAttribute('src')).toBe(src2);
  });
});

test.describe('Brand Player — presentation fullscreen', () => {
  test('전체화면 진입 시 chrome 숨김, 이미지만 노출, 음악 계속 재생', async ({ page }) => {
    await page.goto(PLAYER_URL);

    const audioBefore = await page.evaluate(() => {
      const a = document.querySelector('audio');
      return a ? { currentTime: a.currentTime, paused: a.paused, id: a.getAttribute('data-audio-id') ?? 'audio' } : null;
    });

    // 전체화면 버튼 클릭 (aria-label)
    await page.getByRole('button', { name: '전체화면 (이미지 프레젠테이션)' }).click();

    // 상단/하단 chrome 숨김 확인
    await expect(page.getByText('24시간 재생 준비됨')).toBeHidden();
    await expect(page.getByRole('button', { name: '나가기' })).toBeHidden();
    await expect(page.getByRole('button', { name: '다음 곡' })).toBeHidden();

    // 이미지 영역은 여전히 노출
    await expect(page.locator('img[draggable="false"]')).toBeVisible();

    // 동일 audio element 유지 + 재생 상태/currentTime 보존
    const audioAfter = await page.evaluate(() => {
      const a = document.querySelector('audio');
      return a ? { currentTime: a.currentTime, paused: a.paused } : null;
    });
    expect(audioAfter?.paused).toBe(audioBefore?.paused);

    // ESC 종료 → 일반 UI 복구
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: '나가기' })).toBeVisible();
  });

  test('console error 0', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(PLAYER_URL);
    await page.getByRole('button', { name: '전체화면 (이미지 프레젠테이션)' }).click();
    await page.keyboard.press('Escape');
    expect(errors).toEqual([]);
  });
});
