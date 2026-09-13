// Slack/이메일 장애 알림에 붙는 Recovery Console 링크의 계약.
//
// Edge Function(Deno)과 같은 파일을 검사한다 — 링크 규칙이 두 벌로 갈라지면
// 한쪽만 고쳐지고 다른 쪽이 남는다.
import { describe, it, expect } from 'vitest';
import {
  buildRecoveryConsoleUrl, recoveryConsolePath, normalizeAdminBaseUrl,
  shouldAttachRecovery, RECOVERY_CONSOLE_TAB,
} from '../../supabase/functions/_shared/recoveryConsoleLink.ts';

const STORE = '682c08e1-1111-4222-8333-444444444444';
const BASE = 'https://deudda.com';

describe('13. 링크는 정확히 그 매장을 지목한다', () => {
  it('store_user_id 가 쿼리에 그대로 실린다', () => {
    const url = buildRecoveryConsoleUrl(BASE, STORE);
    expect(url).toBe(`https://deudda.com/admin?tab=${RECOVERY_CONSOLE_TAB}&store=${STORE}`);
  });

  it('탭 key 는 Admin 라우팅과 같은 값이어야 한다', () => {
    // AdminPage 의 ?tab= 값. 바뀌면 링크가 엉뚱한 화면을 연다.
    expect(RECOVERY_CONSOLE_TAB).toBe('brand-player');
  });

  it('다른 매장 id 는 다른 링크가 된다 (링크 하나가 여러 매장을 가리키지 않는다)', () => {
    const other = '11111111-2222-4333-8444-555555555555';
    expect(buildRecoveryConsoleUrl(BASE, other)).not.toBe(buildRecoveryConsoleUrl(BASE, STORE));
  });

  it('매장을 모르면 링크를 만들지 않는다 — 전 매장 목록으로 보내지 않는다', () => {
    for (const bad of [null, undefined, '', '   ', 'not-a-uuid', '682c08e1']) {
      expect(buildRecoveryConsoleUrl(BASE, bad)).toBeNull();
    }
  });

  it('푸시용 내부 경로도 같은 규칙을 쓴다', () => {
    expect(recoveryConsolePath(STORE)).toBe(`/admin?tab=${RECOVERY_CONSOLE_TAB}&store=${STORE}`);
    expect(recoveryConsolePath('nope')).toBeNull();
  });
});

describe('14. URL 에 secret / PII 가 없다', () => {
  it('쿼리 파라미터는 tab 과 store 둘뿐이다', () => {
    const u = new URL(buildRecoveryConsoleUrl(BASE, STORE)!);
    expect([...u.searchParams.keys()].sort()).toEqual(['store', 'tab']);
  });

  it('토큰·이메일·전화번호로 보이는 문자열이 들어가지 않는다', () => {
    const url = buildRecoveryConsoleUrl(BASE, STORE)!;
    for (const forbidden of ['token', 'secret', 'key', 'apikey', 'jwt', 'password', '@', 'email']) {
      expect(url.toLowerCase()).not.toContain(forbidden);
    }
    // URL 에서 고정 부분을 걷어내면 남는 것은 UUID 하나뿐이다 — 전화번호·이메일 같은
    // 개인정보가 끼어들 자리가 아예 없다는 뜻이다.
    const variable = url.replace(`https://deudda.com/admin?tab=${RECOVERY_CONSOLE_TAB}&store=`, '');
    expect(variable).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it('store_user_id 는 UUID 라서 매장 이름·사업자정보를 드러내지 않는다', () => {
    expect(buildRecoveryConsoleUrl(BASE, STORE)).not.toContain('숙대');
  });
});

describe('open redirect 방지 — base 는 허용 목록에서만 나온다', () => {
  it('허용되지 않은 호스트로는 링크를 만들지 않는다', () => {
    for (const bad of [
      'https://evil.example.com',
      'https://deudda.com.evil.example.com',
      'https://evil.example.com/deudda.com',
      'http://deudda.com',                    // 운영 도메인은 https 만
      'javascript:alert(1)',
      '//deudda.com',
      'not a url',
      '',
      null,
    ]) {
      expect(buildRecoveryConsoleUrl(bad, STORE), String(bad)).toBeNull();
    }
  });

  it('URL 에 박힌 자격증명은 통째로 거부한다', () => {
    expect(normalizeAdminBaseUrl('https://user:pass@deudda.com')).toBeNull();
  });

  it('base 의 경로·쿼리·해시는 버리고 origin 만 쓴다', () => {
    expect(normalizeAdminBaseUrl('https://deudda.com/whatever?x=1#y')).toBe('https://deudda.com');
  });

  it('로컬 개발 주소는 http 로도 허용한다', () => {
    expect(normalizeAdminBaseUrl('http://localhost:5173')).toBe('http://localhost:5173');
  });
});

describe('16. 기존 알림 회귀 없음 — 매장 재생 알림에만 붙는다', () => {
  it('brand_player 알림에만 링크를 붙인다', () => {
    expect(shouldAttachRecovery('brand_player_down')).toBe(true);
    expect(shouldAttachRecovery('brand_player_recovered')).toBe(true);
  });

  it('정산·문의·결제 등 다른 운영 알림은 손대지 않는다', () => {
    for (const kind of [
      'settlement_ready', 'support_inquiry', 'billing_recording_drift',
      'moderation_flag', 'contract_signed', '', null, undefined,
    ]) {
      expect(shouldAttachRecovery(kind), String(kind)).toBe(false);
    }
  });
});
