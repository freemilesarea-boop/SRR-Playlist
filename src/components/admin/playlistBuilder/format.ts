/** playlistBuilder UI 표시용 포맷 helper(컴포넌트 아님 — react-refresh 분리). */
export function pctText(v: number | null): string {
  return v == null ? '—' : `${Math.round(v * 100)}%`;
}
export function numText(v: number | null): string {
  return v == null ? '—' : String(Math.round(v));
}
