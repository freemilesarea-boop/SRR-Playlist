/** 본사 브랜드 콘텐츠 화면의 날짜 표시·입력 변환. */

/** 'YYYY-MM-DD' → 그날 0시(또는 끝이면 23:59:59) KST ISO. 비어 있으면 null. */
export function dateInputToIso(v: string, endOfDay = false): string | null {
  if (!v) return null;
  return new Date(`${v}T${endOfDay ? '23:59:59' : '00:00:00'}+09:00`).toISOString();
}

export function formatPeriod(starts: string | null, ends: string | null): string {
  const f = (iso: string) => {
    const d = new Date(iso);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  };
  if (!starts && !ends) return '기간 제한 없음';
  if (starts && ends) return `${f(starts)} ~ ${f(ends)}`;
  return starts ? `${f(starts)}부터` : `${f(ends as string)}까지`;
}

export function formatWhen(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
