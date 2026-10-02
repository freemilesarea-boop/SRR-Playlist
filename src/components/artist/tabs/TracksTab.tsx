/**
 * 음원 관리 탭 — 업로드와 내 음원 목록을 한곳에 모았다.
 *
 * 업로드 폼은 기본적으로 접어 둔다. 예전에는 대시보드를 열자마자 업로드 폼 전체가
 * 펼쳐져 있어서, 음원 상태만 보려던 사람도 그걸 지나쳐 스크롤해야 했다.
 * 수정(editingTrack) 중일 때는 자동으로 펼친다 — 접힌 채로 두면 수정 폼이 안 보인다.
 *
 * 게이트·업로드·QC 로직은 UploadGate / MyTrackRow 를 그대로 쓴다. 바꾸지 않았다.
 */
import { useEffect, useState } from 'react';
import { Upload, EyeOff, ChevronDown, Music, X } from 'lucide-react';
import type { MyArtistTrackRow, UploadEligibility, PayoutAccount, PayoutAccountMasked } from '@/lib/artistApi';
import type { MyTrackQcRow } from '@/lib/audioQcGuideApi';
import type { ArtistPlanInfo } from '@/lib/artistPlanApi';
import SectionHeader from '@/components/ui/SectionHeader';
import EmptyState from '@/components/ui/EmptyState';
import { UploadGate, MyTrackRow } from '@/components/artist/dashboard/parts';

type Filter = 'all' | 'pending_review' | 'approved' | 'rejected';

const FILTERS: ReadonlyArray<{ key: Filter; label: string }> = [
  { key: 'all', label: '전체' },
  { key: 'pending_review', label: '심사중' },
  { key: 'approved', label: '등록완료' },
  { key: 'rejected', label: '반려' },
];

export default function TracksTab({
  isApproved, tracks, qcMap, loading,
  eligibility, payout, payoutMasked, billingPaused, userEmail, plan,
  editingTrack, onCancelEdit, onUploaded, onPayoutSubmitted, onEdit, onOpenQcDetail, onChanged,
}: {
  isApproved: boolean;
  tracks: MyArtistTrackRow[];
  qcMap: Map<string, MyTrackQcRow>;
  loading: boolean;
  eligibility: UploadEligibility | null;
  payout: PayoutAccount | null;
  payoutMasked: PayoutAccountMasked | null;
  billingPaused: boolean;
  userEmail: string;
  plan: ArtistPlanInfo | null;
  editingTrack: MyArtistTrackRow | null;
  onCancelEdit: () => void;
  onUploaded: () => void;
  onPayoutSubmitted: () => void;
  onEdit: (t: MyArtistTrackRow) => void;
  onOpenQcDetail: (t: MyArtistTrackRow) => void;
  onChanged: () => void;
}) {
  const [uploadOpen, setUploadOpen] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const [showRejected, setShowRejected] = useState(false);

  // 수정 시작 → 폼을 펼친다. 접혀 있으면 수정 화면이 보이지 않는다.
  useEffect(() => {
    if (editingTrack) setUploadOpen(true);
  }, [editingTrack]);

  const counts = {
    all: tracks.length,
    pending_review: tracks.filter((t) => t.visibility_status === 'pending_review').length,
    approved: tracks.filter((t) => t.visibility_status === 'approved').length,
    rejected: tracks.filter((t) => t.visibility_status === 'rejected').length,
  };

  const visible = filter === 'all'
    ? tracks.filter((t) => t.visibility_status !== 'rejected')
    : tracks.filter((t) => t.visibility_status === filter);
  // '전체' 에서만 반려 음원을 접어서 따로 보여준다. 반려 필터에서는 그 자체가 목록이다.
  const rejectedFolded = filter === 'all'
    ? tracks.filter((t) => t.visibility_status === 'rejected')
    : [];

  const renderRow = (t: MyArtistTrackRow) => (
    <MyTrackRow
      key={t.track_id}
      track={t}
      qc={qcMap.get(t.track_id) ?? null}
      onChanged={onChanged}
      onEdit={() => onEdit(t)}
      onOpenQcDetail={() => onOpenQcDetail(t)}
    />
  );

  return (
    <div className="space-y-4">
      {/* 업로드 */}
      {isApproved ? (
        <section className="space-y-3">
          <SectionHeader
            title="음원 업로드"
            desc={uploadOpen ? undefined : '새 음원을 등록하거나 기존 음원을 수정할 수 있어요.'}
            action={
              <button
                type="button"
                onClick={() => {
                  if (uploadOpen && editingTrack) onCancelEdit();
                  setUploadOpen((v) => !v);
                }}
                aria-expanded={uploadOpen}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold ${
                  uploadOpen
                    ? 'bg-bg-soft text-ink-mute ring-1 ring-line/15'
                    : 'bg-accent text-bg hover:opacity-90'
                }`}
              >
                {uploadOpen ? <><X size={13} /> 닫기</> : <><Upload size={13} /> 음원 업로드</>}
              </button>
            }
          />
          {uploadOpen && (
            <UploadGate
              eligibility={eligibility}
              payout={payout}
              payoutMasked={payoutMasked}
              billingPaused={billingPaused}
              userEmail={userEmail}
              plan={plan}
              editingTrack={editingTrack}
              onCancelEdit={onCancelEdit}
              onUploaded={onUploaded}
              onPayoutSubmitted={onPayoutSubmitted}
            />
          )}
        </section>
      ) : (
        <div className="rounded-2xl bg-bg-card p-4 ring-1 ring-line/10">
          <h2 className="text-sm font-bold">음원 업로드</h2>
          <p className="mt-1 text-xs text-ink-mute">관리자 승인 후 음원 업로드가 가능합니다.</p>
        </div>
      )}

      {/* 필터 */}
      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map((f) => {
          const active = filter === f.key;
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              aria-pressed={active}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                active ? 'bg-accent text-bg' : 'bg-bg-card text-ink-mute ring-1 ring-line/10 hover:text-ink'
              }`}
            >
              {f.label} {counts[f.key]}
            </button>
          );
        })}
      </div>

      {/* 목록 */}
      {loading ? (
        <div className="space-y-2">
          {[0, 1].map((i) => <div key={i} className="h-16 animate-pulse rounded-xl bg-bg-card" />)}
        </div>
      ) : tracks.length === 0 ? (
        <EmptyState
          icon={<Music size={22} />}
          title="아직 업로드한 음원이 없어요"
          desc={isApproved ? '위의 음원 업로드 버튼으로 첫 음원을 등록해보세요.' : '관리자 승인 후 업로드할 수 있습니다.'}
        />
      ) : (
        <>
          {visible.length > 0 ? (
            <ul className="overflow-hidden rounded-2xl bg-bg-card ring-1 ring-line/10">
              {visible.map(renderRow)}
            </ul>
          ) : (
            <p className="rounded-2xl bg-bg-card/60 p-6 text-center text-sm text-ink-mute ring-1 ring-line/10">
              {filter === 'all'
                ? '표시할 음원이 없어요. (반려된 음원은 아래에서 확인할 수 있어요.)'
                : '이 상태에 해당하는 음원이 없어요.'}
            </p>
          )}

          {/* 반려 음원 — '전체' 에서는 기본 접힘 */}
          {rejectedFolded.length > 0 && (
            <div className="rounded-2xl bg-bg-card/50 ring-1 ring-line/10">
              <button
                type="button"
                onClick={() => setShowRejected((v) => !v)}
                aria-expanded={showRejected}
                className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left"
              >
                <span className="flex items-center gap-2 text-sm font-semibold text-ink-mute">
                  <EyeOff size={14} />
                  반려된 음원 {rejectedFolded.length}개
                </span>
                <span className="flex items-center gap-1 text-xs text-ink-mute">
                  {showRejected ? '숨기기' : '펼치기'}
                  <ChevronDown size={14} className={`transition-transform ${showRejected ? 'rotate-180' : ''}`} />
                </span>
              </button>
              {showRejected && (
                <ul className="overflow-hidden border-t border-line/10">{rejectedFolded.map(renderRow)}</ul>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
