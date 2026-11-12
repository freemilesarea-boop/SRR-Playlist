/**
 * 안내방송 예약 규칙(recurrence_rule) — 파싱 · 직렬화 · 설명.
 *
 * 서버 해석기(0550 `_announcement_rule_parts`)와 같은 문법:
 *   once:YYYY-MM-DDTHH:MM
 *   daily:<시간들>
 *   weekly:MON,WED:<시간들>
 *   <시간들> = 항목(,항목)*
 *   항목     = HH:MM                 — 그 시각에 1회
 *            | HH:MM-HH:MM/N         — 시작~끝(포함) 사이 N분마다 반복
 *
 * 예) daily:10:00,14:00,18:30        매일 3회
 *     daily:10:00-22:00/60           매일 10시~22시 1시간마다 (13회)
 *     weekly:SAT,SUN:11:00-20:00/30,21:30
 *
 * 기존 규칙(daily:HH:MM, weekly:DOW:HH:MM)은 항목 1개짜리로 그대로 해석된다.
 */

export type DowToken = 'SUN' | 'MON' | 'TUE' | 'WED' | 'THU' | 'FRI' | 'SAT';
export const DOW_ORDER: DowToken[] = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
export const DOW_KO: Record<DowToken, string> = {
  MON: '월', TUE: '화', WED: '수', THU: '목', FRI: '금', SAT: '토', SUN: '일',
};

/** 반복 간격 하한 — 서버의 재생 허용창(15분)보다 짧으면 회차가 겹친다. */
export const MIN_INTERVAL_MIN = 15;
export const MAX_INTERVAL_MIN = 720;
/** 하루 최대 회차 (15분 간격 24시간 = 96). */
export const MAX_SLOTS_PER_DAY = 96;

export type TimeItem =
  | { kind: 'at'; time: string }                                   // 'HH:MM'
  | { kind: 'every'; from: string; to: string; stepMin: number };  // 'HH:MM', 'HH:MM', 분

export type ParsedRule =
  | { mode: 'once'; onceDt: string }                       // 'YYYY-MM-DDTHH:MM'
  | { mode: 'daily'; items: TimeItem[] }
  | { mode: 'weekly'; dows: DowToken[]; items: TimeItem[] };

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

function toMin(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function fromMin(n: number): string {
  return `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
}

function normTime(t: string): string | null {
  const m = /^(\d{1,2}):(\d{1,2})$/.exec(t.trim());
  if (!m) return null;
  const s = `${m[1].padStart(2, '0')}:${m[2].padStart(2, '0')}`;
  return TIME_RE.test(s) ? s : null;
}

function parseItems(body: string): TimeItem[] | null {
  const out: TimeItem[] = [];
  for (const raw of body.split(',')) {
    const part = raw.trim();
    const every = /^(\d{1,2}:\d{1,2})-(\d{1,2}:\d{1,2})\/(\d{1,3})$/.exec(part);
    if (every) {
      const from = normTime(every[1]);
      const to = normTime(every[2]);
      if (!from || !to) return null;
      out.push({ kind: 'every', from, to, stepMin: Number(every[3]) });
      continue;
    }
    const at = normTime(part);
    if (!at) return null;
    out.push({ kind: 'at', time: at });
  }
  return out.length ? out : null;
}

export function parseRule(raw: string | null | undefined): ParsedRule | null {
  if (!raw) return null;
  const rule = raw.trim();
  const once = /^once:(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/.exec(rule);
  if (once) return { mode: 'once', onceDt: `${once[1]}T${once[2]}:${once[3]}` };
  const daily = /^daily:(.+)$/.exec(rule);
  if (daily) {
    const items = parseItems(daily[1]);
    return items ? { mode: 'daily', items } : null;
  }
  const weekly = /^weekly:([A-Za-z,]+):(.+)$/.exec(rule);
  if (weekly) {
    const dows = weekly[1].split(',').map((d) => d.trim().toUpperCase())
      .filter((d): d is DowToken => (DOW_ORDER as string[]).includes(d));
    const items = parseItems(weekly[2]);
    return items && dows.length ? { mode: 'weekly', dows, items } : null;
  }
  return null;
}

function itemToString(it: TimeItem): string {
  return it.kind === 'at' ? it.time : `${it.from}-${it.to}/${it.stepMin}`;
}

/** 저장 가능한 규칙 문자열. 입력이 틀리면 null (validateRule 로 사유 확인). */
export function buildRule(p: ParsedRule): string | null {
  if (validateRule(p)) return null;
  if (p.mode === 'once') return `once:${p.onceDt}`;
  const items = p.items.map(itemToString).join(',');
  if (p.mode === 'daily') return `daily:${items}`;
  const dows = DOW_ORDER.filter((d) => p.dows.includes(d)).join(',');
  return `weekly:${dows}:${items}`;
}

/** 하루에 울리는 시각(분 단위, 오름차순, 중복 제거). */
export function slotMinutes(items: TimeItem[]): number[] {
  const set = new Set<number>();
  for (const it of items) {
    if (it.kind === 'at') { set.add(toMin(it.time)); continue; }
    const a = toMin(it.from);
    const b = toMin(it.to);
    if (it.stepMin < 1 || b < a) continue;
    for (let t = a; t <= b; t += it.stepMin) set.add(t);
  }
  return [...set].sort((x, y) => x - y);
}

/** 문제가 있으면 사용자에게 보여줄 문장, 없으면 null. */
export function validateRule(p: ParsedRule): string | null {
  if (p.mode === 'once') return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(p.onceDt) ? null : '실행 일시를 선택해 주세요.';
  if (p.mode === 'weekly' && p.dows.length === 0) return '재생 요일을 1개 이상 선택해 주세요.';
  if (p.items.length === 0) return '재생 시간을 1개 이상 넣어 주세요.';
  for (const it of p.items) {
    if (it.kind === 'at') {
      if (!TIME_RE.test(it.time)) return '시간 형식이 올바르지 않아요.';
      continue;
    }
    if (!TIME_RE.test(it.from) || !TIME_RE.test(it.to)) return '반복 구간의 시간 형식이 올바르지 않아요.';
    if (toMin(it.to) < toMin(it.from)) return '반복 구간의 끝 시간이 시작 시간보다 빨라요.';
    if (!Number.isInteger(it.stepMin) || it.stepMin < MIN_INTERVAL_MIN || it.stepMin > MAX_INTERVAL_MIN) {
      return `반복 간격은 ${MIN_INTERVAL_MIN}분 ~ ${MAX_INTERVAL_MIN / 60}시간 사이로 정해 주세요.`;
    }
  }
  const n = slotMinutes(p.items).length;
  if (n > MAX_SLOTS_PER_DAY) return `하루 ${MAX_SLOTS_PER_DAY}회를 넘을 수 없어요. (지금 ${n}회)`;
  return null;
}

function stepLabel(min: number): string {
  if (min % 60 === 0) return `${min / 60}시간마다`;
  if (min > 60) return `${Math.floor(min / 60)}시간 ${min % 60}분마다`;
  return `${min}분마다`;
}

function describeItems(items: TimeItem[]): string {
  return items.map((it) => (it.kind === 'at' ? it.time : `${it.from}~${it.to} ${stepLabel(it.stepMin)}`)).join(', ');
}

/** 사람이 읽는 한 줄 설명. 하루 2회 이상이면 횟수도 붙인다. */
export function describeRule(raw: string | null | undefined): string {
  if (!raw) return '반복 없음';
  const p = parseRule(raw);
  if (!p) return raw;
  if (p.mode === 'once') {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}:\d{2})$/.exec(p.onceDt);
    return m ? `${Number(m[2])}/${Number(m[3])} ${m[4]} 한 번` : p.onceDt;
  }
  const n = slotMinutes(p.items).length;
  const count = n > 1 ? ` (하루 ${n}회)` : '';
  const when = p.mode === 'daily'
    ? '매일'
    : `매주 ${DOW_ORDER.filter((d) => p.dows.includes(d)).map((d) => DOW_KO[d]).join('·')}`;
  return `${when} ${describeItems(p.items)}${count}`;
}

/** 미리보기용 — 하루 실제 재생 시각 목록 (최대 limit 개). */
export function previewSlots(items: TimeItem[], limit = 12): { times: string[]; total: number } {
  const all = slotMinutes(items);
  return { times: all.slice(0, limit).map(fromMin), total: all.length };
}
