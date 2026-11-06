import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase', () => ({ supabase: { rpc: vi.fn() } }));

import { composeReason, formatSeconds, parseProblemTimes } from './reviewSymptoms';

describe('검수 문제 시점·사유 문장', () => {
  it('시점 입력을 초로 바꾼다', () => {
    expect(parseProblemTimes('1:30, 2:05~2:40, 95')).toEqual([90, 95, 125, 160]);
    expect(parseProblemTimes('3:10 / 0:45 3:10')).toEqual([45, 190]);
    expect(parseProblemTimes('abc, 9:99, 1:5')).toEqual([]);
    expect(parseProblemTimes('')).toEqual([]);
  });
  it('초를 분:초로', () => {
    expect(formatSeconds(125)).toBe('2:05');
  });
  it('아티스트에게 갈 문장', () => {
    expect(composeReason('음질 부족', ['noise', 'vocal_crack'], [150, 190], '')).toBe('음질 부족: 노이즈, 보컬 갈라짐 (2:30·3:10 부근)');
    expect(composeReason('음질 부족', [], [], '')).toBe('음질 부족');
    expect(composeReason('음질 부족', ['late_degradation'], [], '공지 참고')).toBe('음질 부족: 후반부로 갈수록 음질 저하 / 공지 참고');
    expect(composeReason('음질 부족', [], [100], '')).toBe('음질 부족: 1:40 부근');
  });
});
