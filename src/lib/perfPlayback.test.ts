/**
 * 재생 지연 계측 회귀.
 *
 * 수십 초가 어디서 쓰이는지 모르면 최적화가 추측이 된다. 이 계측이 구간을
 * 정확히 나누는지, 그리고 **소리가 안 난 채 끝난 사건도** 어디까지 갔는지
 * 남기는지를 잡는다 — 후자가 이번 조사의 핵심이다.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { perfStart, perfMark, perfFlush, readPerfSession, resetPerf, meta } from './perfPlayback';
import { thumbnailSource, COVER_WIDTH, scaledWidth } from './imageUrl';

describe('구간 측정', () => {
  beforeEach(() => {
    resetPerf();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('탭이 사건을 연다', () => {
    perfStart('playlist:미용실');
    expect(readPerfSession()?.label).toBe('playlist:미용실');
    expect(readPerfSession()?.marks.map(([m]) => m)).toEqual(['tap']);
  });

  it('사건이 열리지 않았으면 mark 는 조용히 무시된다', () => {
    expect(() => perfMark('canplay')).not.toThrow();
    expect(readPerfSession()).toBeNull();
  });

  it('같은 전이는 한 번만 기록한다 — 재시도가 첫 측정을 덮지 않도록', () => {
    perfStart('x');
    perfMark('srcSet');
    const first = readPerfSession()!.marks.find(([m]) => m === 'srcSet')![1];
    perfMark('srcSet');
    expect(readPerfSession()!.marks.find(([m]) => m === 'srcSet')![1]).toBe(first);
  });

  it('첫 진행에 도달하면 자동으로 한 줄 내보내고 닫는다', () => {
    perfStart('playlist:식당');
    perfMark('setQueue'); perfMark('srcSet'); perfMark('canplay');
    perfMark('playCall'); perfMark('playing'); perfMark('firstProgress');
    expect(console.warn).toHaveBeenCalledTimes(1);
    const line = (console.warn as unknown as { mock: { calls: string[][] } }).mock.calls[0][0];
    expect(line).toContain('[PERF_PLAYBACK]');
    expect(line).toContain('what=playlist:식당');
    expect(line).toContain('tap→실제재생=');
    expect(line).toContain('ok');
  });

  // 소리가 안 난 채 끝난 사건 — 이게 안 찍히면 조사할 게 없다.
  it('도달하지 못한 단계를 이름으로 남긴다', () => {
    perfStart('playlist:편집샵');
    perfMark('setQueue'); perfMark('srcSet');
    perfFlush();
    const line = (console.warn as unknown as { mock: { calls: string[][] } }).mock.calls[0][0];
    expect(line).toContain('도달못함=');
    expect(line).toContain('canplay');
    expect(line).toContain('playing');
    expect(line).toContain('firstProgress');
    expect(line).toContain('tap→실제재생=—');
  });

  it('닫힌 사건은 두 번 찍지 않는다', () => {
    perfStart('x'); perfFlush(); perfFlush();
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it('캐시본 여부 같은 맥락을 같이 남긴다', () => {
    perfStart('x');
    meta({ 캐시본: true });
    perfFlush();
    expect((console.warn as unknown as { mock: { calls: string[][] } }).mock.calls[0][0]).toContain('캐시본=true');
  });
});

describe('커버 썸네일', () => {
  const PUBLIC = 'https://p.supabase.co/storage/v1/object/public/covers/a/b_cover.jpg';

  it('저장소 URL 을 리사이즈 엔드포인트로 바꾼다', () => {
    const t = thumbnailSource(PUBLIC, 320)!;
    expect(t.src).toContain('/storage/v1/render/image/public/covers/a/b_cover.jpg');
    expect(t.src).toContain('width=320');
    expect(t.src).toContain('resize=cover');
  });

  // 변환은 유료 기능이다. 실패했을 때 되돌아갈 원본이 반드시 있어야 한다.
  it('원본을 fallback 으로 같이 준다', () => {
    expect(thumbnailSource(PUBLIC, 320)!.fallback).toBe(PUBLIC);
  });

  it('저장소 URL 이 아니면 손대지 않는다', () => {
    const ext = 'https://example.com/x.png';
    const t = thumbnailSource(ext, 320)!;
    expect(t.src).toBe(ext);
    expect(t.fallback).toBe(ext);
  });

  it('빈 값은 null', () => {
    expect(thumbnailSource(null, 320)).toBeNull();
  });

  it('너무 작은 폭은 하한을 둔다', () => {
    expect(thumbnailSource(PUBLIC, 1)!.src).toContain('width=64');
  });

  it('홈 카드가 전체화면보다 작은 이미지를 받는다', () => {
    expect(COVER_WIDTH.md).toBeLessThan(COVER_WIDTH.xl);
    expect(COVER_WIDTH.sm).toBeLessThan(COVER_WIDTH.md);
  });

  it('기기 픽셀비는 2배에서 끊는다 — 4배 기기에서 원본만큼 커지지 않도록', () => {
    expect(scaledWidth(320, 1)).toBe(320);
    expect(scaledWidth(320, 3)).toBe(640);
  });
});
