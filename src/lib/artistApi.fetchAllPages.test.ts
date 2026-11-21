import { describe, it, expect, vi } from 'vitest';

vi.mock('./supabase', () => ({ supabase: {}, supabaseProjectRef: 'test' }));

import { fetchAllPages } from './artistApi';

function source(total: number) {
  const rows = Array.from({ length: total }, (_, i) => i);
  const calls: Array<[number, number]> = [];
  const fetchPage = async (from: number, to: number) => {
    calls.push([from, to]);
    return { data: rows.slice(from, to + 1), error: null };
  };
  return { fetchPage, calls };
}

describe('fetchAllPages — 음원 관리 200곡 제한 제거', () => {
  it('200곡을 넘어도 전부 받는다 (NORE 계정 265곡)', async () => {
    const { fetchPage, calls } = source(265);
    const all = await fetchAllPages(fetchPage, 100);
    expect(all).toHaveLength(265);
    expect(all[264]).toBe(264);
    expect(calls).toEqual([[0, 99], [100, 199], [200, 299]]);
  });

  it('정확히 페이지 크기의 배수면 빈 페이지를 한 번 더 보고 멈춘다', async () => {
    const { fetchPage, calls } = source(200);
    expect(await fetchAllPages(fetchPage, 100)).toHaveLength(200);
    expect(calls).toHaveLength(3);
  });

  it('첫 페이지 실패는 에러, 이후 실패는 받은 만큼 돌려준다', async () => {
    await expect(fetchAllPages(async () => ({ data: null, error: new Error('boom') }), 10)).rejects.toThrow('boom');
    let n = 0;
    const partial = await fetchAllPages(async (from, to) => {
      n += 1;
      return n === 1 ? { data: Array.from({ length: to - from + 1 }, (_, i) => from + i), error: null } : { data: null, error: new Error('x') };
    }, 10);
    expect(partial).toHaveLength(10);
  });

  it('안전 상한을 넘지 않는다', async () => {
    const { fetchPage, calls } = source(10_000);
    expect(await fetchAllPages(fetchPage, 10, 3)).toHaveLength(30);
    expect(calls).toHaveLength(3);
  });
});
