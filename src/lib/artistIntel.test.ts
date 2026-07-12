// Phase ADMIN-ARTIST-1 — Artist Intelligence 순수 로직 단위 테스트.
import { describe, it, expect } from 'vitest';
import {
  formatDuration, formatHours, formatKRW, pct, formatPct,
  approvalRate, qcPassRate, streamingCoverage, artistIntegrityWarnings, artistSupportMatrix,
} from './artistIntel';
import { EMPTY_ARTIST_SUMMARY, type ArtistSummary, type ArtistBreakdown } from './adminApi';
import { computeFunnel, finalConversion, monotonicWarnings } from './memberFunnel';
import type { FunnelStep } from './adminApi';

function summary(over: Partial<ArtistSummary>): ArtistSummary { return { ...EMPTY_ARTIST_SUMMARY, ...over }; }

// 실데이터 기반(검증된 값)
const REAL = summary({
  total_artists: 114, approved: 112, pending: 1, rejected: 1,
  first_upload: 36, distributed: 35, streaming: 35, settled: 24, settle_paid: 0,
  avg_qc_score: 93.9, avg_approval_hours: 21.8,
});
const REAL_FUNNEL: FunnelStep[] = [
  { key: 'signup', label: '가입', count: 114, supported: true },
  { key: 'approved', label: '승인', count: 112, supported: true },
  { key: 'upload', label: '첫 음원 업로드', count: 36, supported: true },
  { key: 'qc_review', label: 'QC 진행', count: 36, supported: true },
  { key: 'qc_pass', label: 'QC 통과', count: 35, supported: true },
  { key: 'released', label: '유통', count: 35, supported: true },
  { key: 'stream', label: '첫 스트리밍', count: 35, supported: true },
  { key: 'settle', label: '첫 정산', count: 24, supported: true },
  { key: 'paid', label: '정산 완료', count: 0, supported: true },
];

describe('formatDuration', () => {
  it('초 → m:ss', () => { expect(formatDuration(173)).toBe('2:53'); expect(formatDuration(60)).toBe('1:00'); expect(formatDuration(5)).toBe('0:05'); });
  it('null/음수 → —', () => { expect(formatDuration(null)).toBe('—'); expect(formatDuration(-1)).toBe('—'); });
});

describe('formatHours', () => {
  it('시간', () => { expect(formatHours(21.8)).toBe('21.8시간'); });
  it('48h+ → 일', () => { expect(formatHours(72)).toBe('3.0일'); });
  it('null → —', () => { expect(formatHours(null)).toBe('—'); });
});

describe('formatKRW', () => {
  it('원', () => { expect(formatKRW(69965)).toBe('₩69,965'); expect(formatKRW(0)).toBe('₩0'); });
  it('NaN → ₩0', () => { expect(formatKRW(NaN)).toBe('₩0'); });
});

describe('pct — 0~100, NaN/Infinity 금지', () => {
  it('정상', () => { expect(pct(112, 114)).toBe(98.2); });
  it('분모 0 → null', () => { expect(pct(5, 0)).toBeNull(); });
  it('clamp 100', () => { expect(pct(200, 100)).toBe(100); });
  it('0/0 → null', () => { expect(pct(0, 0)).toBeNull(); });
});

describe('formatPct', () => {
  it('소수1', () => { expect(formatPct(98.2)).toBe('98.2%'); });
  it('null/Infinity → —', () => { expect(formatPct(null)).toBe('—'); expect(formatPct(Infinity)).toBe('—'); });
});

describe('요약 파생 비율', () => {
  it('승인율 112/114 = 98.2%', () => { expect(approvalRate(REAL)).toBe(98.2); });
  it('QC 통과율 (approved 1199 / (1199+1497)) = 44.5%', () => {
    const b = { qc: { approved: 1199, pending: 1497 } } as ArtistBreakdown;
    expect(qcPassRate(b)).toBe(44.5);
  });
  it('스트리밍 커버리지 (35/(35+77)) = 31.3%', () => {
    const b = { streaming: { streamed_artists: 35, no_stream_artists: 77 } } as ArtistBreakdown;
    expect(streamingCoverage(b)).toBe(31.3);
  });
});

describe('artistIntegrityWarnings', () => {
  it('실데이터(단조) → 경고 없음', () => { expect(artistIntegrityWarnings(REAL)).toEqual([]); });
  it('업로드 > 승인 → 경고', () => {
    expect(artistIntegrityWarnings(summary({ total_artists: 114, approved: 112, first_upload: 120 })).length).toBeGreaterThan(0);
  });
  it('지급 > 정산 → 경고', () => {
    expect(artistIntegrityWarnings(summary({ settled: 10, settle_paid: 20 })).some((w) => w.includes('지급'))).toBe(true);
  });
});

describe('artistSupportMatrix', () => {
  const m = artistSupportMatrix({ ai_score: true, qc_history: true, playlist_exposure: true, recommendation_score: true, distribution_history: false, genre_history: false, promotion: false, country: false });
  it('지원 항목', () => { expect(m.find((x) => x.key === 'ai_score')!.supported).toBe(true); });
  it('미지원 항목', () => {
    expect(m.find((x) => x.key === 'distribution_history')!.supported).toBe(false);
    expect(m.find((x) => x.key === 'country')!.supported).toBe(false);
  });
  it('undefined support → 전부 미지원', () => {
    expect(artistSupportMatrix(undefined).every((x) => !x.supported)).toBe(true);
  });
});

describe('아티스트 퍼널 (computeFunnel 재사용) — 실데이터', () => {
  const c = computeFunnel(REAL_FUNNEL);
  it('메인 체인 단조 → 경고 없음', () => { expect(monotonicWarnings(REAL_FUNNEL)).toEqual([]); });
  it('승인 전환율 112/114 = 98.2%', () => { expect(c[1].convFromPrev).toBe(98.2); });
  it('업로드 전환율 36/112 = 32.1%', () => { expect(c[2].convFromPrev).toBe(32.1); });
  it('최종 전환율 = 정산완료 0 / 가입 114 = 0%', () => { expect(finalConversion(REAL_FUNNEL)).toBe(0); });
});
