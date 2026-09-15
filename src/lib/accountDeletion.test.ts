/**
 * 계정 삭제 안내 페이지 회귀 테스트.
 *
 * 이 페이지 URL 은 구글 플레이 '데이터 삭제' 선언에 등록돼 있다. 링크가 깨지거나
 * 로그인 뒤로 숨거나 보관 기간이 개인정보처리방침과 어긋나면 정책 위반이 되는데,
 * 앱을 고치다 보면 셋 다 조용히 깨질 수 있어서 여기서 잡는다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const page = read('../pages/legal/AccountDeletionPage.tsx');
const app = read('../App.tsx');
const privacy = read('../pages/legal/PrivacyPage.tsx');
const footer = read('../components/common/Footer.tsx');

const ROUTE = '/account-deletion';

describe('계정 삭제 안내 페이지', () => {
  it('공개 라우트로 등록돼 있다', () => {
    expect(app).toContain(`path="${ROUTE}"`);
  });

  it('로그인 뒤에 숨어 있지 않다', () => {
    const line = app.split('\n').find((l) => l.includes(`path="${ROUTE}"`));
    expect(line).toBeDefined();
    expect(line).not.toContain('RequireAuth');
  });

  it('보호 라우트 구역보다 위에 있다', () => {
    const routeAt = app.indexOf(`path="${ROUTE}"`);
    const guardAt = app.indexOf('보호 (로그인 필요)');
    expect(routeAt).toBeGreaterThan(0);
    expect(guardAt).toBeGreaterThan(0);
    expect(routeAt).toBeLessThan(guardAt);
  });

  it('푸터에서 닿을 수 있다', () => {
    expect(footer).toContain(ROUTE);
  });

  // 플레이가 이 URL 에 요구하는 세 가지.
  it('앱 이름과 개발자 이름을 밝힌다', () => {
    expect(page).toContain('듣다');
    expect(page).toContain('루베르 콘텐츠 스튜디오');
  });

  it('삭제를 요청하는 방법을 적어놨다', () => {
    expect(page).toContain('회원 탈퇴');
    expect(page).toContain('freemilesarea@gmail.com');
  });

  it('삭제되는 데이터와 보관되는 데이터를 나눠 적었다', () => {
    expect(page).toContain('삭제되는 데이터');
    expect(page).toContain('법령에 따라 계속 보관되는 데이터');
  });

  // 개인정보처리방침 4항과 값이 갈리면 어느 쪽이 맞는지 알 수 없게 된다.
  it('보관 기간이 개인정보처리방침과 같다', () => {
    const items = [
      '결제 기록 / 청약철회 등 거래 기록: 5년 (전자상거래법)',
      '소비자 불만 / 분쟁 처리 기록: 3년 (전자상거래법)',
      '로그인 기록 / 접속 로그: 3개월 (통신비밀보호법)',
    ];
    for (const item of items) {
      expect(privacy, `개인정보처리방침에서 사라짐: ${item}`).toContain(item);
      expect(page, `삭제 안내에서 사라짐: ${item}`).toContain(item);
    }
  });

  it('활성 구독이 있으면 먼저 해지해야 한다는 조건을 적었다', () => {
    // user_request_withdrawal 이 active_subscription_exists 로 막는 동작과 같아야 한다.
    expect(page).toContain('구독');
    expect(page).toContain('해지');
  });
});
