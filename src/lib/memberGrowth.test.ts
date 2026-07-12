// Phase ADMIN-MEMBER-GROWTH-1 — 회원 성장 대시보드 순수 로직 단위 테스트.
import { describe, it, expect } from 'vitest';
import {
  formatPct, formatNum, momDisplay, relativeTimeKo, formatKstDateTime, formatBucketLabel,
  maskEmail, accountTypeLabel, memberDisplayName, sumByType,
  seriesIntegrityWarnings, kpiIntegrityWarnings, recentMembersOverLimit,
  PAY_STATUS_LABEL, MEMBER_STATUS_LABEL, MEMBER_STATUS_TONE,
} from './memberGrowth';
import type { MemberGrowthKpis, MemberGrowthSeries, MemberGrowthPoint, RecentMember } from './adminApi';

function point(over: Partial<MemberGrowthPoint>): MemberGrowthPoint {
  return { bucket: '2026-07-01', new_total: 0, new_general: 0, new_business: 0, new_artist: 0, new_unknown: 0, cumulative: 0, ...over };
}
function kpis(over: Partial<MemberGrowthKpis>): MemberGrowthKpis {
  return {
    today_signups: 0, last_7d: 0, last_30d: 0, this_month: 0, last_month: 0,
    mom_growth_rate: null, mom_status: 'flat',
    active_paid_members: 0, total_valid_members: 0, unpaid_users: 0,
    paid_conversion_rate: 0, general_conversion_rate: 0, business_conversion_rate: 0,
    general_total: 0, general_paid: 0, business_total: 0, business_paid: 0,
    last30_signups: 0, last30_paid: 0, last30_conversion_rate: 0,
    free_to_paid_history_supported: false, free_to_paid_count: null, generated_at: null, ...over,
  };
}
function series(over: Partial<MemberGrowthSeries>): MemberGrowthSeries {
  return { range: '30d', unit: 'day', start: null, end: null, total_new: 0, unknown_total: 0, points: [], generated_at: null, ...over };
}

describe('formatPct — 소수점 첫째 자리', () => {
  it('일반 값', () => { expect(formatPct(43.3)).toBe('43.3%'); expect(formatPct(0)).toBe('0.0%'); expect(formatPct(100)).toBe('100.0%'); });
  it('반올림', () => { expect(formatPct(34.75)).toBe('34.8%'); });
  it('NaN/Infinity/null → —', () => {
    expect(formatPct(NaN)).toBe('—');
    expect(formatPct(Infinity)).toBe('—');
    expect(formatPct(null)).toBe('—');
    expect(formatPct(undefined)).toBe('—');
  });
});

describe('formatNum', () => {
  it('천단위', () => { expect(formatNum(1234567)).toBe('1,234,567'); });
  it('null/NaN → 0', () => { expect(formatNum(null)).toBe('0'); expect(formatNum(NaN)).toBe('0'); });
});

describe('momDisplay — 전월 대비 (Infinity/NaN 금지)', () => {
  it('지난달 0 · 이번달 >0 → 신규 성장', () => {
    expect(momDisplay(kpis({ mom_status: 'new_growth', mom_growth_rate: null }))).toEqual({ text: '신규 성장', tone: 'success' });
  });
  it('지난달 0 · 이번달 0 → 0.0%', () => {
    expect(momDisplay(kpis({ mom_status: 'flat', mom_growth_rate: null }))).toEqual({ text: '0.0%', tone: 'neutral' });
  });
  it('증가 → +N% success', () => {
    expect(momDisplay(kpis({ mom_status: 'normal', mom_growth_rate: 180 }))).toEqual({ text: '+180.0%', tone: 'success' });
  });
  it('감소 → -N% danger', () => {
    expect(momDisplay(kpis({ mom_status: 'normal', mom_growth_rate: -25 }))).toEqual({ text: '-25.0%', tone: 'danger' });
  });
  it('변화 없음(0) → neutral', () => {
    expect(momDisplay(kpis({ mom_status: 'normal', mom_growth_rate: 0 }))).toEqual({ text: '0.0%', tone: 'neutral' });
  });
});

describe('relativeTimeKo — 몇 분/시간/일 전', () => {
  const now = new Date('2026-07-12T12:00:00+09:00').getTime();
  it('방금', () => { expect(relativeTimeKo('2026-07-12T11:59:30+09:00', now)).toBe('방금'); });
  it('N분 전', () => { expect(relativeTimeKo('2026-07-12T11:30:00+09:00', now)).toBe('30분 전'); });
  it('N시간 전', () => { expect(relativeTimeKo('2026-07-12T09:00:00+09:00', now)).toBe('3시간 전'); });
  it('N일 전', () => { expect(relativeTimeKo('2026-07-07T12:00:00+09:00', now)).toBe('5일 전'); });
  it('미래는 방금으로 안전 처리', () => { expect(relativeTimeKo('2026-07-12T13:00:00+09:00', now)).toBe('방금'); });
  it('null → —', () => { expect(relativeTimeKo(null, now)).toBe('—'); });
});

describe('formatKstDateTime — KST 정확 시각', () => {
  it('UTC 저장 → KST 표시(+9)', () => {
    // 2026-07-11T12:15:38Z = KST 2026-07-11 21:15
    const s = formatKstDateTime('2026-07-11T12:15:38.000Z');
    expect(s).toMatch(/2026/); expect(s).toMatch(/21:15/);
  });
  it('null → —', () => { expect(formatKstDateTime(null)).toBe('—'); });
});

describe('formatBucketLabel — 한글 날짜 라벨', () => {
  it('일 단위 M/D', () => { expect(formatBucketLabel('2026-07-01', 'day')).toBe('7/1'); expect(formatBucketLabel('2026-12-25', 'day')).toBe('12/25'); });
  it('월 단위 YYYY.MM', () => { expect(formatBucketLabel('2026-07-01', 'month')).toBe('2026.07'); });
  it('UTC 파싱 오차 없음 — 문자열 직접 분해', () => {
    // new Date('2026-01-01') 는 UTC 자정이라 KST 로 보면 전날이 될 수 있음. 우리 구현은 문자열 기준.
    expect(formatBucketLabel('2026-01-01', 'day')).toBe('1/1');
  });
});

describe('maskEmail — 과도 노출 방지', () => {
  it('local 앞 2자만', () => { expect(maskEmail('wuddl124@gmail.com')).toBe('wu******@gmail.com'); });
  it('짧은 local', () => { expect(maskEmail('a@b.com')).toBe('a@b.com'); });
  it('null → —', () => { expect(maskEmail(null)).toBe('—'); });
});

describe('accountTypeLabel — null/unknown = 미분류', () => {
  it('알려진 유형', () => {
    expect(accountTypeLabel('artist')).toBe('아티스트');
    expect(accountTypeLabel('business')).toBe('사업자');
    expect(accountTypeLabel('individual')).toBe('일반');
  });
  it('null/빈/알수없음 → 미분류', () => {
    expect(accountTypeLabel(null)).toBe('미분류');
    expect(accountTypeLabel('')).toBe('미분류');
    expect(accountTypeLabel('weird')).toBe('미분류');
  });
});

describe('memberDisplayName', () => {
  it('nickname 우선', () => { expect(memberDisplayName({ display_name: 'OONOTON', email: 'x@y.com' })).toBe('OONOTON'); });
  it('없으면 email local', () => { expect(memberDisplayName({ display_name: null, email: 'foo@bar.com' })).toBe('foo'); });
  it('둘 다 없으면 placeholder', () => { expect(memberDisplayName({ display_name: '  ', email: null })).toBe('(이름 없음)'); });
});

describe('sumByType — 유형 합계', () => {
  it('구간 합산', () => {
    const pts = [
      point({ new_general: 2, new_business: 1, new_artist: 3, new_unknown: 1, new_total: 7 }),
      point({ new_general: 0, new_business: 0, new_artist: 5, new_unknown: 0, new_total: 5 }),
    ];
    expect(sumByType(pts)).toEqual({ general: 2, business: 1, artist: 8, unknown: 1, total: 12 });
  });
});

describe('seriesIntegrityWarnings — 유형 합계 = 신규 합계', () => {
  it('정합 → 경고 없음', () => {
    const s = series({ points: [point({ new_total: 4, new_general: 1, new_business: 1, new_artist: 1, new_unknown: 1 })] });
    expect(seriesIntegrityWarnings(s)).toEqual([]);
  });
  it('불일치 → 경고', () => {
    const s = series({ points: [point({ bucket: '2026-07-05', new_total: 5, new_general: 1, new_business: 1, new_artist: 1, new_unknown: 1 })] });
    expect(seriesIntegrityWarnings(s).length).toBe(1);
  });
});

describe('kpiIntegrityWarnings', () => {
  it('정상 → 경고 없음', () => {
    expect(kpiIntegrityWarnings(kpis({ active_paid_members: 68, total_valid_members: 157, last30_paid: 24, last30_signups: 69 }))).toEqual([]);
  });
  it('활성 유료 > 총 회원 → 경고', () => {
    expect(kpiIntegrityWarnings(kpis({ active_paid_members: 200, total_valid_members: 157 })).length).toBe(1);
  });
  it('최근30일 유료 > 최근30일 가입 → 경고', () => {
    expect(kpiIntegrityWarnings(kpis({ last30_paid: 80, last30_signups: 69 })).length).toBe(1);
  });
});

describe('recentMembersOverLimit', () => {
  const mk = (n: number): RecentMember[] => Array.from({ length: n }, (_, i) => ({
    id: String(i), display_name: null, email: null, account_type: null,
    membership_tier: 'free', subscription_type: 'free', pay_status: 'free',
    email_verified: false, status: 'active', created_at: '2026-07-01T00:00:00Z',
  }));
  it('limit 이하 → false', () => { expect(recentMembersOverLimit(mk(10), 10)).toBe(false); });
  it('limit 초과 → true', () => { expect(recentMembersOverLimit(mk(11), 10)).toBe(true); });
});

describe('라벨 매핑 완전성', () => {
  it('결제/상태 라벨 존재', () => {
    expect(PAY_STATUS_LABEL.paid).toBe('유료');
    expect(PAY_STATUS_LABEL.unpaid).toBe('미결제');
    expect(PAY_STATUS_LABEL.free).toBe('무료');
    expect(MEMBER_STATUS_LABEL.withdrawn).toBe('탈퇴');
    expect(MEMBER_STATUS_TONE.disabled).toBe('danger');
  });
});
