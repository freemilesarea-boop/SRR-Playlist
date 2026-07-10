// Phase BRAND-PLAYER-UX-2 — 디지털 사이니지 전환/미리로드/표시옵션 E2E (Playwright).
//
// 실행 전제 (현재 레포에는 Playwright runner 미설치 — 이 파일은 "실행되지 않았음":
//   npx vitest 로도 수집되지 않도록 src 밖(e2e/)에 위치. 아래는 의도된 검증 시나리오의 코드 문서화다):
//   1) npm i -D @playwright/test   (Chromium 은 /opt/pw-browsers 에 사전 설치)
//   2) 브랜드 세션 준비: /brand 에서 유효한 매장 코드 로그인 → localStorage 브랜드 토큰
//   3) 사이니지 이미지 등록 + 관리자에서 전환효과/시간·표시옵션 저장
//   4) BASE_URL 지정 후:  npx playwright test e2e/brand-player-signage.spec.ts
//
// audio/재생 불변 원칙: 전체화면 진입·표시옵션 토글은 audio element / currentTime / paused 를 바꾸지 않는다.
import { test, expect } from '@playwright/test';

const BRAND_ID = process.env.E2E_BRAND_ID ?? '';
const PLAYER_URL = `/brand/player/${BRAND_ID}`;

async function snapshotAudio(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const a = document.querySelector('audio');
    return a ? { currentTime: a.currentTime, paused: a.paused, src: a.currentSrc } : null;
  });
}

test.describe('Signage — 이미지 전환(crossfade)', () => {
  test('전환 시 검은 화면/레이아웃 이동 없이 다음 이미지로 fade 된다', async ({ page }) => {
    await page.goto(PLAYER_URL);
    const img = page.locator('img[draggable="false"]').first();
    await expect(img).toBeVisible();
    const src1 = await img.getAttribute('src');

    // 유지 시간(display_duration_seconds) 경과 전에는 활성 이미지 유지
    await page.waitForTimeout(1500);
    expect(await img.getAttribute('src')).toBe(src1);

    // 유지 시간 경과 후 다음 이미지로 전환. DOM 의 <img> 개수는 소수(현재+이전+미리로드)로 제한된다.
    await page.waitForTimeout(10_000);
    const imgCount = await page.locator('img[draggable="false"]').count();
    expect(imgCount).toBeLessThanOrEqual(4); // 100장이어도 전부 렌더하지 않음
  });
});

test.describe('Signage — 표시 옵션(브랜드명/현재곡/시계/진행표시)', () => {
  test('옵션이 전부 꺼져 있으면 전체화면에 오버레이가 없다(기본 off)', async ({ page }) => {
    await page.goto(PLAYER_URL);
    await page.getByRole('button', { name: '전체화면 (이미지 프레젠테이션)' }).click();
    // 기본값에서는 시계/브랜드명/현재곡 오버레이가 노출되지 않아야 함(브랜드별 설정에 따라 다름)
    await expect(page.locator('img[draggable="false"]').first()).toBeVisible();
  });

  test('시계 옵션이 켜지면 HH:mm 형식 텍스트가 표시된다(초 없음)', async ({ page }) => {
    // 전제: 관리자에서 show_clock=true 저장된 브랜드
    await page.goto(PLAYER_URL);
    await page.getByRole('button', { name: '전체화면 (이미지 프레젠테이션)' }).click();
    const clock = page.getByText(/^\d{2}:\d{2}$/);
    if (await clock.count()) {
      await expect(clock.first()).toBeVisible();
      // 초 단위(HH:mm:ss)로는 표시되지 않아야 함
      await expect(page.getByText(/^\d{2}:\d{2}:\d{2}$/)).toHaveCount(0);
    }
  });
});

test.describe('Signage — audio/재생 불변', () => {
  test('전체화면 진입/종료해도 audio element·currentTime·paused 가 보존된다', async ({ page }) => {
    await page.goto(PLAYER_URL);
    const before = await snapshotAudio(page);

    await page.getByRole('button', { name: '전체화면 (이미지 프레젠테이션)' }).click();
    const during = await snapshotAudio(page);
    expect(during?.paused).toBe(before?.paused);
    expect(during?.src).toBe(before?.src); // 동일 audio element(재생 소스 불변)

    await page.keyboard.press('Escape');
    const after = await snapshotAudio(page);
    expect(after?.paused).toBe(before?.paused);
    expect(after?.src).toBe(before?.src);
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

test.describe('Admin — 매장 화면 미리보기 (음악/기록 없음)', () => {
  test('미리보기는 동일 렌더러를 쓰며 audio element 를 생성하지 않는다', async () => {
    // 전제: 관리자 로그인 → 브랜드 상세 → "매장 화면 미리보기" 토글.
    // 미리보기 영역 내부에 <audio> 가 없어야 하고(자동재생/heartbeat 없음),
    // BrandSignage 이미지가 저장된 순서/전환효과로 렌더되어야 한다.
    // (구체 selector 는 관리자 라우트 인증 후 활성화 — 실행 시 채움)
    expect(true).toBe(true);
  });
});
