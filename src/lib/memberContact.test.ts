/**
 * 관리자 회원 상세의 연락 정보 회귀.
 *
 * 해지 의사를 밝힌 회원에게 연락할 수단이 관리자 화면에 없었다 — 이메일과
 * 닉네임만 내려왔다. 전화번호·실명·주소·사업자 정보는 가입 때 이미 받아
 * 저장돼 있었고 조회 경로만 빠져 있었다.
 *
 * 값이 민감한 만큼 두 가지를 못 박는다: 관리자 게이트가 그대로 있다는 것과,
 * 아티스트처럼 연락처가 다른 테이블에 있는 회원도 화면에 뜬다는 것.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const api = read('./adminApi.ts');
const ui = read('../components/admin/MemberDetail.tsx');

describe('타입', () => {
  it('연락 정보가 MemberDetail 에 들어 있다', () => {
    const t = api.slice(api.indexOf('export interface MemberDetail'));
    for (const f of ['full_name', 'phone', 'address', 'birth_date', 'identity_verified']) {
      expect(t).toContain(f);
    }
  });

  it('사업자 명의 정보가 들어 있다', () => {
    const t = api.slice(api.indexOf('export interface MemberDetail'));
    for (const f of ['business_number', 'representative_name', 'store_name']) {
      expect(t).toContain(f);
    }
  });

  it('관리자 전용 RPC 를 그대로 쓴다 — 새 조회 경로를 열지 않았다', () => {
    expect(api).toContain("supabase.rpc('admin_member_detail'");
  });
});

describe('화면', () => {
  it('전화는 바로 걸 수 있다', () => {
    expect(ui).toContain('tel:');
  });

  it('이메일도 바로 보낼 수 있다', () => {
    expect(ui).toContain('mailto:');
  });

  it('값을 복사할 수 있다 — 통화 중에 받아적지 않아도 되게', () => {
    expect(ui).toContain('clipboard');
  });

  // 아티스트는 가입 경로가 달라 users 가 아니라 artist_profiles 에 연락처가 있다.
  it('아티스트 연락처도 대체값으로 쓴다', () => {
    expect(ui).toContain('artist_phone');
    expect(ui).toContain('artist_real_name');
  });

  it('마스킹된 회원은 그 사실을 알린다', () => {
    expect(ui).toContain('pii_masked_at');
    expect(ui).toContain('마스킹');
  });

  it('연락 정보가 없을 때 빈 화면으로 두지 않는다', () => {
    expect(ui).toContain('저장된 연락 정보가 없습니다');
  });

  // 체험 종료 직전이 해지방어가 가장 급한 시점이다.
  it('무료체험 상태를 같이 보여준다', () => {
    expect(ui).toContain('free_trial_ends_at');
    expect(ui).toContain('무료체험');
  });
});

/**
 * 결제 실패 이력과 재생량 추이 — 연락처만으로는 "누구에게 먼저 전화할지"를
 * 알 수 없어서 같이 붙였다. 둘 다 민감한 값이라 조회 경로는 같은 관리자 RPC 하나다.
 */
describe('해지 신호', () => {
  it('청구 이력과 재생량 추이가 MemberDetail 에 들어 있다', () => {
    const t = api.slice(api.indexOf('export interface MemberDetail'));
    for (const f of ['billing_failures', 'failure_count_90d', 'playback_trend', 'listened_seconds']) {
      expect(t).toContain(f);
    }
  });

  // payapp_raw 는 카드사 응답 원문이다. 관리자 화면에 흘릴 이유가 없다.
  // (주석에서 언급하는 건 괜찮다 — 필드로 선언되거나 렌더되는 걸 막는다.)
  it('카드사 응답 원문은 타입에도 화면에도 없다', () => {
    expect(api).not.toMatch(/payapp_raw\s*[:?]/);
    expect(ui).not.toMatch(/payapp_raw\s*[:?}]/);
  });

  it('실패 판정은 공용 함수 하나를 쓴다 — 화면에서 따로 세지 않는다', () => {
    expect(ui).toContain('isBillingFailure');
    expect(ui).not.toMatch(/'provider_rejected'/);
  });

  it('성공 건까지 같이 보여준다 — 원래 막혀 있던 회원과 구분하려고', () => {
    expect(ui).toContain('마지막 성공');
  });

  it('결제 실패 안내가 전달됐는지도 보여준다', () => {
    expect(ui).toContain('결제 실패 안내 발송');
  });

  // 진행 중인 달을 전월과 비교하면 멀쩡한 회원도 전부 급감으로 찍힌다.
  it('진행 중인 달은 추이 비교에서 뺀다', () => {
    expect(ui).toContain('playbackDrop');
    expect(ui).toContain('진행 중');
  });

  it('추이 막대는 색만으로 읽히지 않는다 — 수치와 라벨이 같이 있다', () => {
    const card = ui.slice(ui.indexOf('function PlaybackTrendCard'));
    expect(card).toContain('aria-label');
    expect(card).toContain('title=');
  });
});
