/**
 * 행 목록(SETOF / RETURNS TABLE)을 돌려주는 RPC 를 끝까지 받는다.
 *
 * PostgREST 는 한 번 응답에 최대 1000행만 준다. p_limit 을 크게 넘겨도 1000행에서 잘리므로,
 * p_limit 은 사실상 무제한(RPC_NO_LIMIT)으로 두고 range() 로 500행씩 나눠 받는다.
 * 서버 정렬은 마지막에 id 같은 고유 열로 순서가 고정돼 있어야 페이지가 겹치거나 빠지지 않는다 (0560).
 */
import { supabase } from './supabase';
import { fetchAllPages, ALL_PAGES_PAGE_SIZE, RPC_NO_LIMIT } from './fetchAllPages';

export async function fetchAllRpcRows<T>(
  fn: string,
  args: Record<string, unknown> = {},
  opts: { withLimit?: boolean } = {},
): Promise<T[]> {
  const params = opts.withLimit === false ? args : { ...args, p_limit: RPC_NO_LIMIT };
  return fetchAllPages<T>(
    (from, to) =>
      supabase.rpc(fn, params).range(from, to) as unknown as PromiseLike<{ data: T[] | null; error: unknown }>,
    ALL_PAGES_PAGE_SIZE,
  );
}
