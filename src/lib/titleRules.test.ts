import { describe, expect, it } from 'vitest';
import { checkTrackTitle } from './titleRules';

const codes = (t: string) => checkTrackTitle(t).issues.map((i) => i.code);

describe('곡 제목 자동 검사 — 실제 거절 사례', () => {
  it('앞 순번', () => {
    for (const t of ['07 Almost Gone', '10.Quietly Yours', '01바람이 스치는 언덕', '9. a Quiet kind of Life', '02.Linen&Light', '07거기서도 들리니']) {
      expect(codes(t)).toContain('track_number');
    }
    expect(checkTrackTitle('10.Quietly Yours').suggestion).toBe('Quietly Yours');
    expect(checkTrackTitle('01바람이 스치는 언덕').suggestion).toBe('바람이 스치는 언덕');
  });

  it('언어 중복·발음/해석 병기', () => {
    for (const t of ['Petrichor (雨の匂い)', 'Tonight (투나잇)오늘밤', 'Closer(클로저)점점가까워져', 'Warm Milk (ホットミルク)', 'Invisible Border(透明な境界線)']) {
      expect(codes(t)).toContain('mixed_language');
    }
  });

  it('한글·한자 중복', () => {
    for (const t of ['월광단 月光丹', '三更 삼경', '月下情人 월하정인']) {
      expect(codes(t)).toContain('hangul_hanja');
    }
  });

  it('작업 메타', () => {
    expect(codes('On Read master balanced 14LUFS')).toContain('work_metadata');
    expect(codes('Cold Between Us master balanced 14LUFS preview')).toContain('work_metadata');
    expect(codes('늦봄의 창가 master kpop loud 9LUFS')).toContain('work_metadata');
    expect(checkTrackTitle('늦봄의 창가 master kpop loud 9LUFS').suggestion).toBe('늦봄의 창가');
    expect(checkTrackTitle('One Percent master balanced 14LUFS').suggestion).toBe('One Percent');
  });
});

describe('곡 제목 자동 검사 — 정상 제목은 건드리지 않는다', () => {
  it('한 언어 제목', () => {
    for (const t of ['雲の低い朝', 'タクシー相乗り', '바람이 스치는 언덕', 'Quietly Yours', '24 Hours', '1984', 'Love Song', '君のとなりまで']) {
      expect(codes(t)).toEqual([]);
    }
  });
  it('빈 제목', () => {
    expect(checkTrackTitle('   ')).toEqual({ issues: [], suggestion: null });
  });
});
