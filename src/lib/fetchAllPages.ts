/**
 * 페이지 단위로 끝까지 받아 이어 붙인다 — "내 곡·내 목록"처럼 전부 봐야 하는 화면용.
 *
 * 2026-11-21: 아티스트 음원 관리가 최신 200곡만 받아 오래된 발매곡이 사라져 보였다.
 * 개수 제한으로 목록을 자르지 말고, PostgREST 최대 행 수(기본 1000) 안쪽 크기로 나눠 전부 받는다.
 *
 * 첫 페이지가 실패하면 에러를 던지고, 이후 페이지가 실패하면 그때까지 받은 것을 돌려준다
 * (일부라도 보여주는 편이 빈 목록보다 낫다).
 */
export const ALL_PAGES_PAGE_SIZE = 500;
/** 안전 상한 — 무한 루프 방지 (500 × 40 = 20,000행). */
export const ALL_PAGES_MAX_PAGES = 40;
/** RPC 가 자체 p_limit 을 받는 경우 넘길 값 — 사실상 무제한, 실제 분할은 range() 가 한다. */
export const RPC_NO_LIMIT = 1_000_000;
/**
 * 본사·매장 jsonb RPC(get_my_enterprise_* 등)에 넘길 '전부' 개수 — 서버 상한도 10000 (0556).
 * jsonb 한 덩어리로 오므로 PostgREST 최대 행 수와 무관하다.
 */
export const HQ_LIST_ALL = 10_000;

export async function fetchAllPages<T>(
  fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  pageSize = ALL_PAGES_PAGE_SIZE,
  maxPages = ALL_PAGES_MAX_PAGES,
): Promise<T[]> {
  const all: T[] = [];
  for (let page = 0; page < maxPages; page++) {
    const from = page * pageSize;
    const { data, error } = await fetchPage(from, from + pageSize - 1);
    if (error) {
      if (page === 0) throw error;
      break;
    }
    const rows = data ?? [];
    all.push(...rows);
    if (rows.length < pageSize) break;
  }
  return all;
}
