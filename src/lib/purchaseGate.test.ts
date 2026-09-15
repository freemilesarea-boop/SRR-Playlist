// 스토어 결제 정책 회귀 방지.
//
// 구글 플레이/앱스토어는 앱 안의 디지털 구독을 자사 결제로만 팔게 하고, 외부 결제
// 페이지로 내보내는 것을 금지한다. 우리 결제는 PayApp 웹 결제창이라, 앱에 결제
// 버튼이 하나라도 남아 있으면 심사에서 반려된다.
//
// 반려는 코드가 아니라 사람이 앱을 만져보고 내리는 판정이라 단위 테스트로 잡을 수
// 없다. 대신 "결제창을 여는 코드는 전부 게이트를 거친다" 는 구조만 강제한다 —
// 새 결제 화면을 만들면서 게이트를 빠뜨리는 것이 현실적으로 가장 위험한 실수다.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const isNativeApp = vi.fn(() => false);
vi.mock('@/lib/native', () => ({
  isNativeApp: () => isNativeApp(),
  nativePlatform: () => 'web',
}));

const { canShowPurchaseUi } = await import('./purchaseGate');

function src(rel: string): string {
  return readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');
}

describe('canShowPurchaseUi', () => {
  beforeEach(() => isNativeApp.mockReturnValue(false));

  it('웹/PWA 에서는 결제 UI 를 보여준다 — 스토어 정책 대상이 아니다', () => {
    expect(canShowPurchaseUi()).toBe(true);
  });

  it('네이티브 앱에서는 감춘다', () => {
    isNativeApp.mockReturnValue(true);
    expect(canShowPurchaseUi()).toBe(false);
  });
});

describe('결제창을 여는 화면은 모두 게이트를 거친다', () => {
  // PayApp 결제 URL(payurl)을 실제로 여는 파일들. 새로 생기면 여기에 추가할 것.
  const CHECKOUT_FILES = [
    'pages/SubscriptionPage.tsx',
    'pages/PricingPage.tsx',
    'pages/EnterprisePayPage.tsx',
    'pages/ArtistDashboardPage.tsx',
  ];

  it.each(CHECKOUT_FILES)('%s 가 purchaseGate 를 부른다', (rel) => {
    const code = src(rel);
    expect(code).toContain("from '@/lib/purchaseGate'");
    expect(code).toContain('canShowPurchaseUi');
  });

  it.each(CHECKOUT_FILES)('%s 에 게이트 없는 조기 이탈이 있다', (rel) => {
    // 결제 시작 함수가 네이티브에서 그냥 return 하는지 — UI 를 빠뜨려도 여기서 막힌다.
    const code = src(rel);
    expect(code).toMatch(/if \(!(canShowPurchaseUi\(\)|showPurchase)\) return/);
  });

  it('payurl 을 여는 파일이 위 목록 밖에 새로 생기지 않았다', () => {
    // 목록을 손으로 관리하면 반드시 낡는다. src 를 실제로 훑어서 확인한다.
    const srcDir = fileURLToPath(new URL('..', import.meta.url));
    const found: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) { walk(full); continue; }
        if (!/\.tsx?$/.test(entry.name) || /\.test\./.test(entry.name)) continue;
        const code = readFileSync(full, 'utf8');
        // payurl 을 '쓰는' 곳만 — 타입 선언(enterprisePaymentApi)은 결제창을 열지 않는다.
        if (/res\.payurl/.test(code)) found.push(relative(srcDir, full));
      }
    };
    walk(srcDir);
    expect(found.sort()).toEqual([...CHECKOUT_FILES].sort());
  });
});

describe('결제 라우트는 앱에서 막힌다', () => {
  const app = src('App.tsx');

  it('/pricing 과 /enterprise/pay 가 RequireWebPurchase 로 감싸여 있다', () => {
    expect(app).toMatch(/path="\/pricing"[^\n]*RequireWebPurchase/);
    expect(app).toMatch(/path="\/enterprise\/pay"[^\n]*RequireWebPurchase/);
  });

  it('RequireWebPurchase 가 게이트를 실제로 본다', () => {
    expect(app).toContain('if (!canShowPurchaseUi()) return <PurchaseUnavailable />;');
  });
});

describe('앱에서 감춰야 할 구독 유도 지점', () => {
  // 결제 화면으로 데려가는 버튼들. 링크만 남아도 "외부 결제로 유도" 로 본다.
  const CTA_FILES = [
    'components/TrialBanner.tsx',
    'components/player/SubscriptionGate.tsx',
    'components/player/PlaybackBlockedOverlay.tsx',
    'pages/ProfilePage.tsx',
    'pages/BusinessPage.tsx',
    'pages/ServicePreviewPage.tsx',
  ];

  it.each(CTA_FILES)('%s 의 구독 CTA 가 게이트에 걸려 있다', (rel) => {
    expect(src(rel)).toContain('canShowPurchaseUi');
  });
});
