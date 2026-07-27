/**
 * playlistBuilder/parts — UX-2 공용 표시 컴포넌트(순수 표시).
 *   Tag / Quality Status / 분포 Bar / Stat. 색상만으로 상태 전달 금지 → icon+label+tooltip.
 *   admin/ui 디자인 시스템(AdminBadge/AdminTooltip) 재사용.
 */
import { Check, AlertTriangle, Ban } from 'lucide-react';
import { AdminBadge, AdminTooltip } from '@/components/admin/ui';
import type { AdminToneName } from '@/components/admin/ui';
import type { RecommendationTag } from '@/lib/playlistBuilderSelection';
import type { QualityStatus } from '@/lib/playlistBuilderInsights';
import type { DistributionBucket } from '@/lib/playlistBuilder';

/** 태그 code → 사람이 읽는 설명(tooltip). */
const TAG_TOOLTIP: Record<string, string> = {
  fit_high: '업종 적합도(Fit)가 높습니다.',
  adaptive_high: '최근 반응(Adaptive)이 좋습니다.',
  completion_high: '완청률이 높습니다.',
  skip_low: '스킵률이 낮습니다.',
  instrumental: '연주곡(보컬 없음)입니다.',
  blocked: '가드레일 차단 트랙입니다.',
  penalized: '가드레일 페널티가 적용된 트랙입니다.',
  low_sample: '학습 표본이 부족합니다(신뢰도 낮음).',
  skip_high: '스킵률이 높습니다.',
  no_audio: '오디오 파일이 없습니다(저장 차단).',
  no_artwork: '커버 이미지가 없습니다.',
  artist_over: '동일 아티스트 비중이 높습니다.',
  genre_over: '동일 장르 비중이 높습니다.',
};

export function TagBadges({ tags, max = 6 }: { tags: RecommendationTag[]; max?: number }) {
  if (tags.length === 0) return null;
  const shown = tags.slice(0, max);
  const extra = tags.length - shown.length;
  return (
    <div className="flex flex-wrap items-center gap-1">
      {shown.map((t) => {
        const tone: AdminToneName = t.kind === 'positive' ? 'success' : 'warning';
        const Icon = t.kind === 'positive' ? Check : AlertTriangle;
        return (
          <AdminTooltip key={t.code} label={TAG_TOOLTIP[t.code] ?? t.label}>
            <AdminBadge tone={tone} variant="subtle" icon={<Icon size={10} aria-hidden />}>
              {t.label}
            </AdminBadge>
          </AdminTooltip>
        );
      })}
      {extra > 0 && (
        <AdminBadge tone="neutral" variant="subtle">
          +{extra}
        </AdminBadge>
      )}
    </div>
  );
}

const STATUS_META: Record<QualityStatus, { tone: AdminToneName; label: string; icon: React.ReactNode; help: string }> = {
  ready: { tone: 'success', label: 'Ready', icon: <Check size={11} aria-hidden />, help: '저장 가능한 상태입니다.' },
  needs_review: {
    tone: 'warning',
    label: 'Needs Review',
    icon: <AlertTriangle size={11} aria-hidden />,
    help: '경고가 있습니다. 확인 후 저장할 수 있습니다.',
  },
  blocked: {
    tone: 'danger',
    label: 'Blocked',
    icon: <Ban size={11} aria-hidden />,
    help: '오류/차단 트랙이 있어 저장할 수 없습니다.',
  },
};

export function QualityStatusBadge({ status }: { status: QualityStatus }) {
  const m = STATUS_META[status];
  return (
    <AdminTooltip label={m.help}>
      <AdminBadge tone={m.tone} variant="solid" size="md" icon={m.icon}>
        {m.label}
      </AdminBadge>
    </AdminTooltip>
  );
}

/** 의존성 없는 분포 Bar(상위 N). */
export function MiniBars({ title, buckets, max = 5 }: { title: string; buckets: DistributionBucket[]; max?: number }) {
  if (buckets.length === 0) return null;
  return (
    <div>
      <p className="mb-1 text-xs font-medium text-ink-mute">{title}</p>
      <ul className="space-y-1">
        {buckets.slice(0, max).map((b) => (
          <li key={b.key} className="flex items-center gap-2 text-[11px]">
            <span className="w-20 shrink-0 truncate" title={b.key}>
              {b.key}
            </span>
            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-line/10">
              <span className="block h-full rounded-full bg-accent/60" style={{ width: `${Math.round(b.ratio * 100)}%` }} />
            </span>
            <span className="w-9 shrink-0 text-right tabular-nums text-ink-dim">{Math.round(b.ratio * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-xs">
      <span className="text-ink-mute">{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
