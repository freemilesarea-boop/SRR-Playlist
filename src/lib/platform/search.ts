// WEB-OPS-10 — Unified Search. Pure client-side search across the already-loaded platform entities
// (stores, enterprise brands, incidents, releases, recommendations, approvals, decisions). Read-only; it
// filters what the operator already has permission to see — it never fetches beyond the loaded bundle.

import { SEARCH_MIN_QUERY, SEARCH_MAX_RESULTS } from './thresholds';
import type { SearchResult, SearchKind } from './types';

export interface SearchableEntity { kind: SearchKind; id: string; label: string; detail: string; }

/** Filter the provided entities by a case-insensitive substring match on id/label/detail. */
export function searchPlatform(query: string, entities: SearchableEntity[]): SearchResult[] {
  const q = query.trim().toLowerCase();
  if (q.length < SEARCH_MIN_QUERY) return [];
  const out: SearchResult[] = [];
  for (const e of entities) {
    if (out.length >= SEARCH_MAX_RESULTS) break;
    const hay = `${e.id} ${e.label} ${e.detail}`.toLowerCase();
    if (hay.includes(q)) out.push({ kind: e.kind, id: e.id, label: e.label, detail: e.detail });
  }
  return out;
}
