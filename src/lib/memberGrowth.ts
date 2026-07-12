/**
 * memberGrowth — 회원 성장 대시보드 순수 로직 (표시/정합성/시간 포맷).
 *
 * DB 집계는 0472 RPC 가 담당하고, 여기서는 프론트 표시용 순수 함수만 둔다
 * (단위 테스트 대상). 시간대는 KST(Asia/Seoul) — RPC 와 동일 기준을 프론트에서
 * 재계산하지 않고, RPC 가 돌려준 KST 버킷/집계를 "그대로" 포맷만 한다.
 */
import type {
  MemberGrowthKpis, MemberGrowthSeries, MemberGrowthPoint, RecentMember,
  RecentMemberPayStatus, RecentMemberStatus,
} from './adminApi';

/** 소수점 첫째 자리 퍼센트. 유한수만, NaN/Infinity 는 '—'. */
export function formatPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${n.toFixed(1)}%`;
}

/** ko-KR 천단위 구분. */
export function formatNum(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '0';
  return n.toLocaleString('ko-KR');
}

/** 전월 대비 표시 — Infinity/NaN 없이 상태별 라벨/톤. */
export function momDisplay(kpis: Pick<MemberGrowthKpis, 'mom_growth_rate' | 'mom_status'>): {
  text: string;
  tone: 'success' | 'danger' | 'neutral';
} {
  if (kpis.mom_status === 'new_growth') return { text: '신규 성장', tone: 'success' };
  if (kpis.mom_status === 'flat' || kpis.mom_growth_rate == null) return { text: '0.0%', tone: 'neutral' };
  const r = kpis.mom_growth_rate;
  const sign = r > 0 ? '+' : '';
  return { text: `${sign}${r.toFixed(1)}%`, tone: r > 0 ? 'success' : r < 0 ? 'danger' : 'neutral' };
}

/**
 * 상대 시간(“방금 / N분 전 / N시간 전 / N일 전”). now 주입 가능(테스트).
 * 미래 시각은 '방금' 으로 안전 처리.
 */
export function relativeTimeKo(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '—';
  const sec = Math.floor((now - t) / 1000);
  if (sec < 60) return '방금';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}일 전`;
  const mon = Math.floor(day / 30);
  if (mon < 12) return `${mon}개월 전`;
  return `${Math.floor(mon / 12)}년 전`;
}

/** KST 정확 일시 (툴팁/보조 텍스트). */
export function formatKstDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(d);
}

/**
 * 차트 축 라벨 — 한글 날짜. day 는 'M/D', month 는 'YYYY.MM'.
 * bucket 은 RPC 가 KST 로 계산한 날짜 문자열('YYYY-MM-DD')이므로 UTC 파싱 오차가
 * 없도록 문자열을 직접 분해한다(new Date 파싱에 의존하지 않음).
 */
export function formatBucketLabel(bucket: string, unit: 'day' | 'month'): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(bucket ?? '');
  if (!m) return bucket ?? '';
  const [, yyyy, mm, dd] = m;
  return unit === 'month' ? `${yyyy}.${mm}` : `${Number(mm)}/${Number(dd)}`;
}

/** 이메일 부분 마스킹 — 과도 노출 방지. local 앞 2자만 노출. */
export function maskEmail(email: string | null | undefined): string {
  if (!email) return '—';
  const at = email.indexOf('@');
  if (at <= 0) return email;
  const local = email.slice(0, at);
  const domain = email.slice(at);
  const head = local.slice(0, 2);
  const stars = Math.max(0, local.length - 2);
  return `${head}${'*'.repeat(stars)}${domain}`;
}

// 라벨 매핑 ─────────────────────────────────────────────
export const PAY_STATUS_LABEL: Record<RecentMemberPayStatus, string> = {
  paid: '유료', unpaid: '미결제', free: '무료',
};
export const MEMBER_STATUS_LABEL: Record<RecentMemberStatus, string> = {
  active: '활성', email_unverified: '이메일 미인증', disabled: '정지', withdrawn: '탈퇴',
};
export const MEMBER_STATUS_TONE: Record<RecentMemberStatus, 'success' | 'warning' | 'danger' | 'neutral'> = {
  active: 'success', email_unverified: 'warning', disabled: 'danger', withdrawn: 'neutral',
};

/** account_type → 한글 유형(널/미지정 = 미분류). */
export function accountTypeLabel(t: string | null | undefined): string {
  switch (t) {
    case 'artist': return '아티스트';
    case 'business': return '사업자';
    case 'individual': return '일반';
    case null:
    case undefined:
    case '': return '미분류';
    default: return '미분류';
  }
}

/** 표시명 — nickname 우선, 없으면 이메일 local, 둘 다 없으면 '(이름 없음)'. */
export function memberDisplayName(m: Pick<RecentMember, 'display_name' | 'email'>): string {
  if (m.display_name && m.display_name.trim()) return m.display_name.trim();
  if (m.email) return m.email.split('@')[0];
  return '(이름 없음)';
}

// 정합성 검증 ───────────────────────────────────────────
/** 시계열: 각 버킷 new_total = 일반+사업자+아티스트+unknown. 불일치 버킷 라벨 목록. */
export function seriesIntegrityWarnings(series: MemberGrowthSeries): string[] {
  const warnings: string[] = [];
  for (const p of series.points) {
    const parts = p.new_general + p.new_business + p.new_artist + p.new_unknown;
    if (parts !== p.new_total) {
      warnings.push(`${formatBucketLabel(p.bucket, series.unit)} 신규 합계 ${parts} ≠ ${p.new_total}`);
    }
  }
  return warnings;
}

/** KPI: active_paid <= total, last30_paid <= last30_signups. */
export function kpiIntegrityWarnings(k: MemberGrowthKpis): string[] {
  const w: string[] = [];
  if (k.active_paid_members > k.total_valid_members) {
    w.push(`활성 유료 ${k.active_paid_members} > 총 회원 ${k.total_valid_members}`);
  }
  if (k.last30_paid > k.last30_signups) {
    w.push(`최근 30일 유료 ${k.last30_paid} > 최근 30일 가입 ${k.last30_signups}`);
  }
  return w;
}

/** 최근 가입 목록 인원 <= 요청 limit. */
export function recentMembersOverLimit(rows: RecentMember[], limit: number): boolean {
  return rows.length > limit;
}

/** 유형별 총 신규(구간 합계) — 범례/요약용. */
export function sumByType(points: MemberGrowthPoint[]): {
  general: number; business: number; artist: number; unknown: number; total: number;
} {
  return points.reduce(
    (a, p) => ({
      general: a.general + p.new_general,
      business: a.business + p.new_business,
      artist: a.artist + p.new_artist,
      unknown: a.unknown + p.new_unknown,
      total: a.total + p.new_total,
    }),
    { general: 0, business: 0, artist: 0, unknown: 0, total: 0 },
  );
}
