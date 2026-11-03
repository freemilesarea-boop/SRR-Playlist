import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase', () => ({ supabase: { rpc: vi.fn(), storage: { from: vi.fn() } } }));

import { describeRecurrence, describeScope, hqUploadFolder, summarizeRequest } from './hqContentApi';

describe('본사 콘텐츠 요청 — 표시', () => {
  it('반복 규칙을 사람 말로', () => {
    expect(describeRecurrence('daily:22:30')).toBe('매일 22:30');
    expect(describeRecurrence('weekly:MON,WED,FRI:09:00')).toBe('매주 월·수·금 09:00');
    expect(describeRecurrence('once:2026-11-20T18:00')).toBe('11/20 18:00 한 번');
    expect(describeRecurrence(null)).toBe('반복 없음');
  });

  it('방송 범위', () => {
    expect(describeScope('enterprise', {})).toBe('전체 가맹점');
    expect(describeScope('region', { regionName: '서울' })).toBe('서울 매장');
    expect(describeScope('store', { storeCount: 3 })).toBe('선택한 매장 3곳');
  });

  it('요청 한 줄 요약', () => {
    expect(summarizeRequest({ kind: 'music_policy', payload: { policy_mode: 'inherit' } })).toBe('업종 기본 음악으로');
    expect(summarizeRequest({ kind: 'music_policy', payload: { policy_mode: 'custom', allowed_genres: ['jazz', 'lofi'] } })).toBe('허용 장르 2개');
    expect(summarizeRequest({ kind: 'playback_policy', payload: { playback_mode: 'business_hours', open_time: '10:00', close_time: '23:00' } }))
      .toBe('영업시간에만 10:00~23:00');
    expect(summarizeRequest({ kind: 'media_add', payload: { asset_type: 'video', title: '겨울 프로모션' } })).toBe('영상 "겨울 프로모션"');
    expect(summarizeRequest(
      { kind: 'schedule_create', payload: { name: '마감 안내', recurrence_rule: 'daily:22:30', scope_type: 'enterprise' } },
      { assetTitle: '마감 30분 전' },
    )).toBe('"마감 안내" · 매일 22:30 · 전체 가맹점 · 음원 "마감 30분 전"');
    expect(summarizeRequest({ kind: 'schedule_update', payload: { schedule_id: 'x', status: 'paused' } })).toBe('일시중지');
  });

  it('업로드 폴더는 스토리지 정책(hq/<본사 id>/)과 같아야 한다', () => {
    expect(hqUploadFolder('abc')).toBe('hq/abc');
  });
});
