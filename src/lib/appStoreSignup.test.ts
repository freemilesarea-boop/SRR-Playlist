// App Store 심사 5.1.1 / 2.1.0 (2026-11-28) — 회원가입에서 필요 없는 개인정보를 필수로 받지 않고,
// 가짜(mock) 본인인증이나 'MVP' 같은 미완성 표시를 화면에 내지 않는다.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');
const SIGNUP_FORMS = ['components/auth/IndividualSignupForm.tsx', 'components/auth/ArtistSignupForm.tsx'];

describe('회원가입 필수 항목 (App Store 5.1.1)', () => {
  for (const f of SIGNUP_FORMS) {
    it(`${f}: 생년월일·전화번호·주소·본인인증을 받지 않는다`, () => {
      const src = read(f);
      for (const label of ['생년월일 *', '전화번호 *', '주소 *', '본인인증 *']) {
        expect(src, label).not.toContain(label);
      }
      expect(src).not.toContain('verifyIdentityNow');
    });
  }
});

describe('사업자 가입 (App Store 5.1.1(v) — 주소·전화번호 필수 금지)', () => {
  it('BusinessSignupForm: 전화번호는 선택, 주소·생년월일 입력칸이 없다', () => {
    const src = read('components/auth/BusinessSignupForm.tsx');
    expect(src).not.toContain('전화번호 *');
    expect(src).not.toContain('label="주소 *"');
    expect(src).not.toContain('생년월일 *');
    expect(src).toContain('전화번호 (선택)');
  });
});

describe('미완성 표시 (App Store 2.1.0)', () => {
  const VISIBLE = [
    ...SIGNUP_FORMS,
    'components/auth/BusinessSignupForm.tsx',
    'pages/ProfilePage.tsx',
    'components/artist/dashboard/parts.tsx',
  ];
  for (const f of VISIBLE) {
    it(`${f}: 화면 문구에 MVP·mock 이 없다`, () => {
      // 주석은 빼고 본다.
      const code = read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
      expect(code).not.toMatch(/MVP|\bmock\b/);
    });
  }
});

describe('앱에서 요금 안내 숨김 (App Store 3.1.1)', () => {
  it('아티스트 가입 화면의 요금은 canShowPurchaseUi 가 참일 때만 보인다', () => {
    const src = read('components/auth/ArtistSignupForm.tsx');
    expect(src).toContain('const showPrices = canShowPurchaseUi();');
    // 금액 문자열은 모두 showPrices 삼항 안에만 있다.
    const amounts = src.match(/[^\n]*[0-9],[0-9]{3}원[^\n]*/g) ?? [];
    expect(amounts.length).toBeGreaterThan(0);
    for (const line of amounts) expect(line, line.trim()).toContain('showPrices ?');
  });
});
