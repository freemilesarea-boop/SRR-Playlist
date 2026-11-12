import { describe, it, expect } from 'vitest';
import { buildRule, describeRule, parseRule, slotMinutes, validateRule } from './announcementRecurrence';

describe('announcementRecurrence', () => {
  it('기존 단일 시간 규칙을 그대로 읽고 다시 같은 문자열로 만든다', () => {
    for (const r of ['daily:22:30', 'weekly:MON,WED,FRI:09:00', 'once:2026-11-20T18:00']) {
      const p = parseRule(r);
      expect(p).not.toBeNull();
      expect(buildRule(p!)).toBe(r);
    }
  });

  it('여러 시간과 시간 반복을 함께 쓴다', () => {
    const p = parseRule('daily:09:30,10:00-12:00/60,18:30');
    expect(p).toEqual({ mode: 'daily', items: [
      { kind: 'at', time: '09:30' },
      { kind: 'every', from: '10:00', to: '12:00', stepMin: 60 },
      { kind: 'at', time: '18:30' },
    ] });
    expect(buildRule(p!)).toBe('daily:09:30,10:00-12:00/60,18:30');
    if (p?.mode === 'daily') expect(slotMinutes(p.items)).toEqual([570, 600, 660, 720, 1110]);
  });

  it('겹치는 시각은 한 번만 센다', () => {
    expect(slotMinutes([{ kind: 'at', time: '10:00' }, { kind: 'every', from: '10:00', to: '11:00', stepMin: 30 }]))
      .toEqual([600, 630, 660]);
  });

  it('요일은 월요일 순서로 직렬화', () => {
    expect(buildRule({ mode: 'weekly', dows: ['SUN', 'SAT'], items: [{ kind: 'every', from: '11:00', to: '20:00', stepMin: 30 }] }))
      .toBe('weekly:SAT,SUN:11:00-20:00/30');
  });

  it('잘못된 입력은 저장하지 않는다', () => {
    expect(validateRule({ mode: 'daily', items: [] })).toMatch(/1개 이상/);
    expect(validateRule({ mode: 'weekly', dows: [], items: [{ kind: 'at', time: '10:00' }] })).toMatch(/요일/);
    expect(validateRule({ mode: 'daily', items: [{ kind: 'every', from: '10:00', to: '11:00', stepMin: 10 }] })).toMatch(/15분/);
    expect(validateRule({ mode: 'daily', items: [{ kind: 'every', from: '12:00', to: '10:00', stepMin: 30 }] })).toMatch(/끝 시간/);
    expect(buildRule({ mode: 'daily', items: [] })).toBeNull();
    expect(parseRule('daily:25:00')).toBeNull();
    expect(parseRule('monthly:01:09:00')).toBeNull();
  });

  it('설명 문구', () => {
    expect(describeRule('daily:22:30')).toBe('매일 22:30');
    expect(describeRule('daily:10:00,14:00')).toBe('매일 10:00, 14:00 (하루 2회)');
    expect(describeRule('daily:10:00-22:00/60')).toBe('매일 10:00~22:00 1시간마다 (하루 13회)');
    expect(describeRule('weekly:SAT,SUN:11:00-12:00/30')).toBe('매주 토·일 11:00~12:00 30분마다 (하루 3회)');
    expect(describeRule('once:2026-11-20T18:00')).toBe('11/20 18:00 한 번');
    expect(describeRule(null)).toBe('반복 없음');
  });
});
