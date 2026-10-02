/**
 * 스트리밍 탭 — 성과만 본다.
 *
 * 추이 → 수치 → 곡별 순서는 StreamingAnalyticsSection 이 이미 그렇게 그린다.
 * 통계를 새로 계산하지 않는다. fetchArtistStreamingSummary / fetchArtistDailyStreams
 * 가 주는 값을 그대로 쓴다.
 */
import { BarChart3 } from 'lucide-react';
import type { ArtistStreamingSummaryRow, ArtistDailyStreamRow } from '@/lib/artistApi';
import EmptyState from '@/components/ui/EmptyState';
import { StreamingAnalyticsSection } from '@/components/artist/dashboard/parts';

export default function StreamingTab({
  summary, daily, loading, hasTracks,
}: {
  summary: ArtistStreamingSummaryRow[];
  daily: ArtistDailyStreamRow[];
  loading: boolean;
  hasTracks: boolean;
}) {
  if (!loading && !hasTracks) {
    return (
      <EmptyState
        icon={<BarChart3 size={22} />}
        title="아직 스트리밍 데이터가 없어요"
        desc="음원이 등록되고 재생이 쌓이면 여기에 추이와 곡별 성과가 표시됩니다."
      />
    );
  }
  return <StreamingAnalyticsSection summary={summary} daily={daily} loading={loading} />;
}
