import { describe, expect, it, vi } from 'vitest';

const remove = vi.fn(async () => ({ error: null }));
const rpc = vi.fn();
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a), storage: { from: () => ({ remove }) } } }));

import {
  cleanupMyOrphanUploads, describeRecurrence, describeScope, hqUploadFolder, removeRequestUpload, summarizeRequest,
} from './hqContentApi';

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

describe('본사 업로드 정리', () => {
  it('쓰이지 않는 파일을 버킷별로 묶어 지운다', async () => {
    rpc.mockResolvedValueOnce({ data: [
      { bucket: 'brand-media', path: 'hq/e/a.png' },
      { bucket: 'enterprise-announcements', path: 'hq/e/b.mp3' },
      { bucket: 'brand-media', path: 'hq/e/c.mp4' },
    ], error: null });
    remove.mockClear();
    expect(await cleanupMyOrphanUploads()).toBe(3);
    expect(remove).toHaveBeenCalledWith(['hq/e/a.png', 'hq/e/c.mp4']);
    expect(remove).toHaveBeenCalledWith(['hq/e/b.mp3']);
  });

  it('업로드 요청이 아니거나 hq 폴더 밖이면 아무것도 지우지 않는다', async () => {
    remove.mockClear();
    await removeRequestUpload({ kind: 'music_policy', payload: {} });
    await removeRequestUpload({ kind: 'media_add', payload: { file_path: 'brand/x.png' } });
    expect(remove).not.toHaveBeenCalled();
    await removeRequestUpload({ kind: 'announcement_asset_add', payload: { file_path: 'hq/e/x.mp3' } });
    expect(remove).toHaveBeenCalledWith(['hq/e/x.mp3']);
  });
});
