import { Fragment, useEffect, useState } from 'react';
import { Music, RefreshCw, Search, ExternalLink, Wallet, ChevronDown, ChevronRight } from 'lucide-react';
import { adminListArtistTracks, type AdminTrackRow } from '@/lib/artistApi';
import Alert from '@/components/Alert';
import TrackModerationPanel from './TrackModerationPanel';

type StatusFilter =
  | ''
  | 'pending_review' | 'approved' | 'rejected' | 'hidden'
  // 0074 — DSP release_status 필터 (서버 RPC 가 둘 다 매칭)
  | 'submitted' | 'review_pending' | 'changes_requested' | 'scheduled' | 'released' | 'removed';

function fmtDate(s: string | null | undefined): string {
  if (!s) return '—';
  return new Date(s).toLocaleDateString('ko-KR', { year: '2-digit', month: '2-digit', day: '2-digit' });
}

const STATUS_TONE: Record<string, string> = {
  // visibility_status
  pending_review: 'bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-200',
  approved: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-500/15 dark:text-emerald-300',
  rejected: 'bg-red-100 text-red-900 dark:bg-red-500/15 dark:text-red-300',
  hidden: 'bg-ink/10 text-ink-dim',
  // 0075 — release_status 톤
  draft: 'bg-ink/10 text-ink-dim',
  submitted: 'bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-200',
  review_pending: 'bg-sky-100 text-sky-900 dark:bg-sky-500/15 dark:text-sky-200',
  changes_requested: 'bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-200',
  scheduled: 'bg-sky-100 text-sky-900 dark:bg-sky-500/15 dark:text-sky-200',
  released: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-500/15 dark:text-emerald-300',
  removed: 'bg-red-100 text-red-900 dark:bg-red-500/15 dark:text-red-300',
};

const STATUS_LABEL: Record<string, string> = {
  // visibility_status (fallback)
  pending_review: '심사 대기',
  approved: '승인됨',
  rejected: '거절됨',
  hidden: '숨김',
  // 0075 — release_status (사용자 정의 명칭)
  draft: '초안',
  submitted: '검수 대기',
  review_pending: '검수 중',
  changes_requested: '수정 요청',
  scheduled: '발매 예약',
  released: '공개 중',
  removed: '제거됨',
};

const PAYOUT_TONE: Record<string, string> = {
  verified: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-500/15 dark:text-emerald-300',
  pending: 'bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-200',
  rejected: 'bg-red-100 text-red-900 dark:bg-red-500/15 dark:text-red-300',
};

export default function ArtistTrackManagementList() {
  const [rows, setRows] = useState<AdminTrackRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusFilter>('');
  const [search, setSearch] = useState('');
  const [busyId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await adminListArtistTracks({
        status: status || undefined,
        search: search || undefined,
      });
      setRows(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  useEffect(() => {
    const t = window.setTimeout(load, 300);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-1.5 text-lg font-bold tracking-tight">
            <Music size={16} className="text-accent" /> 음원 관리
          </h2>
          <p className="text-xs text-ink-mute">
            {rows.length}건 · release_status='released' 인 트랙만 정산 대상
          </p>
        </div>
        <button
          onClick={() => void load()}
          className="inline-flex items-center gap-1 rounded-lg bg-bg-card px-3 py-2 text-xs font-semibold ring-1 ring-line/10 hover:bg-bg-hover"
        >
          <RefreshCw size={12} /> 새로고침
        </button>
      </div>

      {error && <Alert tone="error" title="조회 실패">{error}</Alert>}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search
            size={14}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-dim"
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="track_code / 제목 / 아티스트 / ISRC / 이메일"
            className="input pl-9 text-sm"
          />
        </div>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as StatusFilter)}
          className="input w-auto text-sm"
        >
          <option value="">전체 상태</option>
          <optgroup label="visibility">
            <option value="pending_review">심사 대기</option>
            <option value="approved">승인됨</option>
            <option value="rejected">거절됨</option>
            <option value="hidden">숨김</option>
          </optgroup>
          <optgroup label="DSP release">
            <option value="submitted">검수 대기 (submitted)</option>
            <option value="review_pending">검수 중</option>
            <option value="changes_requested">수정 요청</option>
            <option value="scheduled">발매 예정</option>
            <option value="released">공개됨</option>
            <option value="removed">제거됨</option>
          </optgroup>
        </select>
      </div>

      <div className="overflow-hidden rounded-2xl bg-bg-card ring-1 ring-line/10">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1200px] text-sm">
            <thead>
              <tr className="border-b border-line/10 text-[11px] uppercase text-ink-dim [&_th]:whitespace-nowrap">
                <th className="px-3 py-2.5 text-left font-semibold">track_code</th>
                <th className="px-3 py-2.5 text-left font-semibold">제목</th>
                <th className="px-3 py-2.5 text-left font-semibold">아티스트</th>
                <th className="px-3 py-2.5 text-left font-semibold">권리자</th>
                <th className="px-3 py-2.5 text-left font-semibold">ISRC</th>
                <th className="px-3 py-2.5 text-left font-semibold">상태</th>
                <th className="px-3 py-2.5 text-left font-semibold">계좌</th>
                <th className="px-3 py-2.5 text-right font-semibold">등록일</th>
                <th className="w-px px-3 py-2.5 text-right font-semibold">액션</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={9} className="px-3 py-8 text-center text-xs text-ink-mute">
                    불러오는 중…
                  </td>
                </tr>
              )}
              {!loading && rows.length === 0 && !error && (
                <tr>
                  <td colSpan={9} className="px-3 py-8 text-center text-xs text-ink-mute">
                    등록된 음원이 없어요.
                  </td>
                </tr>
              )}
              {rows.map((r) => {
                const payoutKey = r.payout_verification_status ?? 'pending';
                const payoutTone = PAYOUT_TONE[payoutKey] ?? PAYOUT_TONE.pending;
                const isExpanded = expandedId === r.track_id;
                return (
                  <Fragment key={r.track_id}>
                  <tr className="border-b border-line/10 hover:bg-bg-hover">
                    <td className="px-3 py-2.5">
                      <button
                        type="button"
                        onClick={() => setExpandedId(isExpanded ? null : r.track_id)}
                        aria-label="DSP 검수 패널 열기"
                        className="mr-1 inline-flex items-center text-ink-mute hover:text-ink"
                      >
                        {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                      </button>
                      <code className="rounded bg-bg-soft px-1.5 py-0.5 font-mono text-[10px]">
                        {r.track_code ?? '—'}
                      </code>
                    </td>
                    <td className="px-3 py-2.5">
                      <p className="font-medium">{r.title}</p>
                      {r.album_name && (
                        <p className="text-[11px] text-ink-mute">{r.album_name}</p>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <p className="text-xs">{r.artist_name ?? r.artist ?? '—'}</p>
                      <p className="text-[11px] text-ink-dim">{r.artist_email ?? '—'}</p>
                    </td>
                    <td className="px-3 py-2.5 text-xs">{r.rights_holder_name ?? '—'}</td>
                    <td className="px-3 py-2.5">
                      <code className="font-mono text-[11px]">{r.isrc ?? '—'}</code>
                    </td>
                    <td className="px-3 py-2.5">
                      {/* 0075 — release_status 를 주 상태로 표시. hidden 인 경우 별도 표기 */}
                      {(() => {
                        const primary = r.release_status ?? r.visibility_status;
                        const tone = STATUS_TONE[primary] ?? STATUS_TONE.hidden;
                        const label = STATUS_LABEL[primary] ?? primary;
                        return (
                          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${tone}`}>
                            {label}
                          </span>
                        );
                      })()}
                      {r.visibility_status === 'hidden' && r.release_status === 'released' && (
                        <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-ink/10 px-2 py-0.5 text-[10px] font-semibold text-ink-dim">
                          숨김
                        </span>
                      )}
                      {r.release_date && (
                        <p className="mt-1 text-[10px] text-ink-mute">
                          발매일 {fmtDate(r.release_date)}
                        </p>
                      )}
                      {r.rejected_reason && (
                        <p className="mt-1 text-[10px] text-red-700 dark:text-red-300">
                          {r.rejected_reason}
                        </p>
                      )}
                      {r.removed_reason && (
                        <p className="mt-1 text-[10px] text-red-700 dark:text-red-300">
                          제거 사유: {r.removed_reason}
                        </p>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${payoutTone}`}
                      >
                        <Wallet size={9} /> {payoutKey}
                      </span>
                      {r.contract_status !== 'signed' && (
                        <p className="mt-1 text-[10px] text-amber-700 dark:text-amber-300">
                          계약 {r.contract_status ?? 'none'}
                        </p>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right text-xs text-ink-mute">
                      {fmtDate(r.created_at)}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <div className="flex justify-end gap-1">
                        {/* 0076 — row-level visibility-only 액션 (approve/reject/hide) 제거.
                            release_status 와 어긋난 부정합 발생 방지. 모든 액션은 expand
                            패널 (TrackModerationPanel) 의 release_status 기반 RPC 로 통일. */}
                        <button
                          onClick={() => setExpandedId(isExpanded ? null : r.track_id)}
                          disabled={busyId === r.track_id}
                          className="inline-flex items-center gap-1 rounded-md bg-bg-soft px-2 py-1 text-[11px] font-semibold text-ink-mute ring-1 ring-line/10 hover:bg-bg-hover hover:text-ink disabled:opacity-50"
                          title="검수 패널 열기/닫기"
                        >
                          {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                          검수
                        </button>
                        {r.audio_url && (
                          <a
                            href={r.audio_url}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="rounded p-1.5 text-ink-mute hover:bg-ink/10"
                            title="원본 오디오"
                          >
                            <ExternalLink size={14} />
                          </a>
                        )}
                      </div>
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr className="border-b border-line/10 bg-bg-soft/30">
                      <td colSpan={9} className="px-3 py-3">
                        <TrackModerationPanel
                          trackId={r.track_id}
                          trackTitle={r.title}
                          releaseStatus={r.release_status ?? null}
                          visibilityStatus={r.visibility_status}
                          onChanged={load}
                        />
                      </td>
                    </tr>
                  )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
}

