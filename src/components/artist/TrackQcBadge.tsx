/**
 * TrackQcBadge — 트랙 카드의 QC 결과 미니 뱃지 (X6.36)
 *
 * 표시 규칙 (qc_score 기반):
 *   - has_report=false      → "분석 중" (gray)
 *   - score >= 90           → "우수" (emerald)
 *   - 80 ~ 89               → "양호" (sky)
 *   - 70 ~ 79               → "보통" (yellow)
 *   - < 70                  → "낮음" (red)
 *   - clipping_count > 0    → 추가 ⚠ 표시 (orange dot)
 */
import { ShieldCheck, AlertCircle, Activity, AlertTriangle, Loader2 } from 'lucide-react';

interface Props {
  hasReport: boolean;
  qcScore: number | null;
  clippingCount: number | null;
  /** 클릭 시 상세 페이지 / 모달 등으로 이동 시 핸들러 — 옵션 */
  onClick?: () => void;
  className?: string;
}

export default function TrackQcBadge({
  hasReport, qcScore, clippingCount, onClick, className = '',
}: Props) {
  if (!hasReport) {
    return (
      <span
        className={`inline-flex items-center gap-1 rounded-full bg-bg-soft px-1.5 py-0.5 text-[10px] font-medium text-ink-dim ring-1 ring-line/10 ${className}`}
        title="QC 분석 진행 중 — 보통 업로드 후 5분 이내 완료"
      >
        <Loader2 size={9} className="animate-spin" /> 음질 분석 중
      </span>
    );
  }

  const score = qcScore ?? 0;
  let label = '낮음';
  let tone = 'bg-red-100 text-red-900 dark:bg-red-500/25 dark:text-red-300';
  let Icon = AlertCircle;
  if (score >= 90) {
    label = '우수'; tone = 'bg-emerald-100 text-emerald-900 dark:bg-emerald-500/25 dark:text-emerald-300';
    Icon = ShieldCheck;
  } else if (score >= 80) {
    label = '양호'; tone = 'bg-sky-100 text-sky-900 dark:bg-sky-500/25 dark:text-sky-300';
    Icon = Activity;
  } else if (score >= 70) {
    label = '보통'; tone = 'bg-yellow-100 text-yellow-900 dark:bg-yellow-500/25 dark:text-yellow-200';
    Icon = AlertTriangle;
  }

  const hasClipping = (clippingCount ?? 0) > 0;
  const title =
    `음질 종합 점수: ${Math.round(score)} / 100` +
    (hasClipping ? ` · 클리핑 ${clippingCount}회 감지 (마스터링 점검 권장)` : '');

  const Wrapper: 'button' | 'span' = onClick ? 'button' : 'span';

  return (
    <Wrapper
      onClick={onClick}
      title={title}
      className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${tone} ${onClick ? 'hover:opacity-80 cursor-pointer' : ''} ${className}`}
    >
      <Icon size={9} />
      <span>음질 {label}</span>
      <span className="font-mono">{Math.round(score)}</span>
      {hasClipping && (
        <span
          className="ml-0.5 inline-block h-1.5 w-1.5 rounded-full bg-orange-500"
          title={`클리핑 ${clippingCount}회 감지`}
        />
      )}
    </Wrapper>
  );
}
