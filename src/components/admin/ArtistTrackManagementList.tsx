import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { Music, RefreshCw, Search, ExternalLink, Wallet, ChevronDown, ChevronRight, Trash2, AlertTriangle, ImagePlus, Loader2 } from 'lucide-react';
import { useModalA11y } from '@/hooks/useModalA11y';
import { adminListArtistTracks, adminCountArtistTracks, adminBulkDeleteTracks, adminTakedownTrack, adminRestoreTrack, uploadAdminTrackCover, adminSetTrackCover, type AdminTrackRow } from '@/lib/artistApi';
import RejectReasonSelector from '@/components/admin/RejectReasonSelector';

const PAGE_SIZE = 100;
import { toast } from '@/store/toastStore';
import Alert from '@/components/Alert';
import AutoCover from '@/components/AutoCover';
import TrackModerationPanel from './TrackModerationPanel';
import TrackMetaSelectors from '@/components/artist/TrackMetaSelectors';
import MetaApproveModal from '@/components/admin/MetaApproveModal';
import { friendlyError } from '@/lib/errorMessages';

const APPROVABLE_RS = ['submitted', 'review_pending', 'changes_requested'];
import {
  adminGetTrackTags, adminUpdateTrackTags, validateSelectedMeta, emptySelectedMeta,
  type SelectedMeta,
} from '@/lib/trackMetadataOptions';

const PROTECTED_STATUSES = ['released', 'scheduled', 'approved'];

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

export default function ArtistTrackManagementList({ removedView = false }: { removedView?: boolean } = {}) {
  const [rows, setRows] = useState<AdminTrackRow[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [lastBatchSize, setLastBatchSize] = useState<number>(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [restoreBusyId, setRestoreBusyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusFilter>('');
  const [search, setSearch] = useState('');
  const [busyId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [delModal, setDelModal] = useState(false);
  const [delHard, setDelHard] = useState(false);
  const [delBusy, setDelBusy] = useState(false);
  const [delReason, setDelReason] = useState('');
  const [deletableOnly, setDeletableOnly] = useState(false);
  const [coverBusyId, setCoverBusyId] = useState<string | null>(null);
  const [tagModal, setTagModal] = useState<{ trackId: string; title: string } | null>(null);
  const [metaModal, setMetaModal] = useState<{ track_id: string; title: string | null; canApprove: boolean } | null>(null);
  const [tagMeta, setTagMeta] = useState<SelectedMeta>(emptySelectedMeta);
  const [tagBusy, setTagBusy] = useState(false);

  const delDialogRef = useRef<HTMLDivElement>(null);
  const tagDialogRef = useRef<HTMLDivElement>(null);
  useModalA11y(delDialogRef, { onClose: () => !delBusy && setDelModal(false), enabled: delModal });
  useModalA11y(tagDialogRef, { onClose: () => !tagBusy && setTagModal(null), enabled: !!tagModal });

  async function openTagEditor(trackId: string, title: string) {
    setTagModal({ trackId, title });
    setTagMeta(emptySelectedMeta());
    try {
      const t = await adminGetTrackTags(trackId);
      setTagMeta({
        genre_tags: t.genre_tags, mood_tags: t.mood_tags,
        business_type_tags: t.business_type_tags, vocal_type: t.vocal_type,
        recommended_dayparts: t.recommended_dayparts,
      });
    } catch (e) {
      toast.error(friendlyError(e, '태그 조회 실패'));
    }
  }
  async function saveTags() {
    if (!tagModal) return;
    const err = validateSelectedMeta(tagMeta);
    if (err) { toast.error(err); return; }
    setTagBusy(true);
    try {
      await adminUpdateTrackTags(tagModal.trackId, tagMeta);
      toast.success('태그가 수정됐어요.');
      setTagModal(null);
      await load();
    } catch (e) {
      toast.error(friendlyError(e, '태그 수정 실패'));
    } finally {
      setTagBusy(false);
    }
  }

  async function restoreTrack(trackId: string) {
    setRestoreBusyId(trackId);
    try {
      await adminRestoreTrack(trackId);
      toast.success('음원을 복구했어요. (검수/발매 흐름으로 복귀)');
      await load();
    } catch (e) {
      toast.error(`복구 실패: ${friendlyError(e)}`);
    } finally {
      setRestoreBusyId(null);
    }
  }

  async function replaceCover(trackId: string, file: File | null) {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('이미지 파일만 업로드할 수 있어요.');
      return;
    }
    setCoverBusyId(trackId);
    try {
      const up = await uploadAdminTrackCover(file);
      if (!up.ok || !up.url) {
        toast.error(`커버 업로드 실패: ${up.error ?? '알 수 없음'}`);
        return;
      }
      await adminSetTrackCover(trackId, up.url);
      toast.success('커버가 등록됐어요.');
      await load();
    } catch (e) {
      toast.error(`커버 등록 실패: ${friendlyError(e)}`);
    } finally {
      setCoverBusyId(null);
    }
  }

  const requestSeqRef = useRef(0);
  const filterKey = `${removedView ? 'removed' : status || 'all'}|${search}`;

  async function load() {
    setLoading(true);
    setError(null);
    const seq = ++requestSeqRef.current;
    const queryStatus = removedView ? 'removed' : status || undefined;
    const querySearch = search || undefined;
    try {
      const [data, count] = await Promise.all([
        adminListArtistTracks({ status: queryStatus, search: querySearch, limit: PAGE_SIZE, offset: 0 }),
        adminCountArtistTracks({ status: queryStatus, search: querySearch }).catch((e) => {
          console.warn('[ArtistTrackMgmt] count RPC failed (fallback to batch-size 기준 hasMore):', e);
          return 0;
        }),
      ]);
      if (seq !== requestSeqRef.current) return; // 더 최신 요청이 들어오면 폐기
      console.debug('[ArtistTrackMgmt] load page=1', { offset: 0, returned: data.length, total: count, status: queryStatus ?? null, search: querySearch ?? null });
      setRows(data);
      setTotal(count);
      setLastBatchSize(data.length);
    } catch (e) {
      if (seq !== requestSeqRef.current) return;
      setError(friendlyError(e));
    } finally {
      if (seq === requestSeqRef.current) setLoading(false);
    }
  }

  // hasMore: count 가 신뢰 가능하면 그것을 우선, 아니면 마지막 배치가 PAGE_SIZE 가득 찼는지로 판정
  const hasMore = (total > 0 ? rows.length < total : lastBatchSize >= PAGE_SIZE);

  async function loadMore() {
    if (loading || loadingMore || !hasMore) return;
    setLoadingMore(true);
    const seq = requestSeqRef.current; // 추가 로드는 현재 요청 시퀀스 유지
    const offset = rows.length;
    const queryStatus = removedView ? 'removed' : status || undefined;
    const querySearch = search || undefined;
    try {
      const more = await adminListArtistTracks({
        status: queryStatus, search: querySearch, limit: PAGE_SIZE, offset,
      });
      if (seq !== requestSeqRef.current) return;
      console.debug('[ArtistTrackMgmt] loadMore', { offset, returned: more.length, totalSoFar: rows.length + more.length, total });
      // 중복 방지 — 이미 있는 id 는 스킵
      const have = new Set(rows.map((r) => r.track_id));
      setRows((prev) => [...prev, ...more.filter((r) => !have.has(r.track_id))]);
      setLastBatchSize(more.length);
    } catch (e) {
      toast.error(`추가 로드 실패: ${friendlyError(e)}`);
    } finally {
      setLoadingMore(false);
    }
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }
  // 발매(released/scheduled/approved) 음원은 물리삭제 불가 → 공개중단(takedown)으로 처리.
  // 미발매(draft/submitted/rejected 등)는 삭제 가능. 둘 다 선택은 허용한다.
  function isProtected(r: AdminTrackRow): boolean {
    return PROTECTED_STATUSES.includes(r.release_status ?? '');
  }
  const visibleRows = deletableOnly ? rows.filter((r) => !isProtected(r)) : rows;
  const allVisibleSelected =
    visibleRows.length > 0 && visibleRows.every((r) => selected.has(r.track_id));

  // 헤더/툴바 전체 선택 — 현재 보이는 모든 곡 토글 (발매곡 포함: takedown 대상)
  function toggleSelectAll() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) visibleRows.forEach((r) => next.delete(r.track_id));
      else visibleRows.forEach((r) => next.add(r.track_id));
      return next;
    });
  }
  // "삭제 가능만 선택" — 미발매(삭제 가능) 곡만 선택
  function selectDeletable() {
    setSelected(new Set(rows.filter((r) => !isProtected(r)).map((r) => r.track_id)));
  }

  const selectedRows = rows.filter((r) => selected.has(r.track_id));
  const selectedProtected = selectedRows.filter(isProtected).length; // takedown 대상
  const selectedDeletable = selectedRows.filter((r) => !isProtected(r)).length; // 삭제 대상
  const reasonValid = delReason.trim().length >= 5;

  // 선택 처리: 발매곡 → 공개중단(takedown), 미발매곡 → 삭제. 사유 5자 이상 필수.
  async function runProcess() {
    const protectedIds = selectedRows.filter(isProtected).map((r) => r.track_id);
    const deletableIds = selectedRows.filter((r) => !isProtected(r)).map((r) => r.track_id);
    if (protectedIds.length + deletableIds.length === 0) return;
    if (!reasonValid) {
      toast.error('처리 사유를 5자 이상 입력해주세요.');
      return;
    }
    const reason = delReason.trim();
    if (import.meta.env.DEV) {
      console.debug('[track-manage] process', { takedown: protectedIds, delete: deletableIds, hard: delHard, reason });
    }
    setDelBusy(true);
    let takedownOk = 0;
    const fails: string[] = [];
    try {
      // 1) 발매곡 공개중단 (물리삭제 금지 → release_status='removed')
      for (const id of protectedIds) {
        try {
          await adminTakedownTrack(id, reason);
          takedownOk += 1;
        } catch (e) {
          fails.push(`${id.slice(0, 8)}: ${friendlyError(e)}`);
        }
      }
      // 2) 미발매곡 삭제
      let deletedCount = 0;
      let skippedCount = 0;
      if (deletableIds.length > 0) {
        const res = await adminBulkDeleteTracks(deletableIds, delHard ? 'hard' : 'soft', reason);
        deletedCount = res.deleted_count;
        skippedCount = res.skipped_count;
        res.failed.forEach((f) => fails.push(`${f.track_id.slice(0, 8)}: ${f.error}`));
      }

      const parts: string[] = [];
      if (takedownOk > 0) parts.push(`공개중단 ${takedownOk}곡`);
      if (deletedCount > 0) parts.push(`삭제 ${deletedCount}곡${delHard ? '(완전)' : ''}`);
      if (parts.length > 0) toast.success(parts.join(' · ') + ' 처리됨');
      if (skippedCount > 0) toast.info(`${skippedCount}곡은 발매/정산 이력으로 건너뜀`);
      if (fails.length > 0) {
        toast.error(`${fails.length}곡 처리 실패: ${fails.slice(0, 2).join(' / ')}${fails.length > 2 ? ' …' : ''}`);
      }
      if (parts.length === 0 && fails.length === 0 && skippedCount === 0) {
        toast.info('처리할 항목이 없습니다.');
      }
      setDelModal(false);
      setDelHard(false);
      setDelReason('');
      await load();
    } catch (e) {
      toast.error(`처리 실패: ${friendlyError(e)}`);
    } finally {
      setDelBusy(false);
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

  // 필터(status/search/removedView)가 바뀌면 선택 초기화 — 보이지 않는 곡 잠금 방지
  useEffect(() => {
    setSelected(new Set());
     
  }, [filterKey]);

  // 하단 sentinel — 무한 스크롤 추가 로드
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const onLoadMore = useCallback(() => { void loadMore(); }, [rows.length, total, lastBatchSize, loading, loadingMore, status, search, removedView, hasMore]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) onLoadMore();
    }, { rootMargin: '600px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [onLoadMore]);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-1.5 text-lg font-bold tracking-tight">
            <Music size={16} className="text-accent" /> {removedView ? '삭제 음원' : '음원 관리'}
          </h2>
          <p className="text-xs text-ink-mute">
            {(() => {
              const fmt = (n: number) => n.toLocaleString('ko-KR');
              const knownTotal = total || rows.length;
              const head = hasMore
                ? `현재 ${fmt(rows.length)}곡 로드 / 총 ${fmt(knownTotal)}곡${total > 0 ? '' : '+'}`
                : `전체 ${fmt(knownTotal)}곡 로드 완료`;
              const suffix = removedView
                ? ' · 관리자가 삭제/공개중단(removed)한 음원 · 서비스 전역 미노출'
                : ' · 검수 대기·승인·예정·공개·반려·숨김 모두 포함 (삭제/중단은 별도 탭)';
              return head + suffix;
            })()}
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
          <option value="">전체 상태 (검수·승인·발매 모두 포함)</option>
          <optgroup label="발매 단계">
            <option value="submitted">검수 대기</option>
            <option value="review_pending">검수 중</option>
            <option value="changes_requested">수정 요청</option>
            <option value="approved">승인됨</option>
            <option value="scheduled">발매 예정</option>
            <option value="released">발매 완료</option>
          </optgroup>
          <optgroup label="검수 결과">
            <option value="pending_review">심사 대기 (visibility)</option>
            <option value="rejected">반려</option>
            <option value="hidden">숨김</option>
          </optgroup>
          <optgroup label="중단/삭제">
            <option value="removed">삭제/중단</option>
          </optgroup>
        </select>
      </div>

      {/* 일괄 선택/삭제 툴바 (삭제 음원 보기에서는 숨김) */}
      {!removedView && !loading && rows.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl bg-bg-soft/60 p-2 ring-1 ring-line/10">
          <label className="inline-flex cursor-pointer items-center gap-1.5 px-1 text-xs font-semibold">
            <input type="checkbox" checked={allVisibleSelected} onChange={toggleSelectAll} />
            전체 선택
          </label>
          <button
            onClick={selectDeletable}
            className="rounded-md bg-bg-card px-2 py-1 text-[11px] font-semibold ring-1 ring-line/10 hover:bg-bg-hover"
          >
            미발매(삭제 가능)만 선택
          </button>
          <label className="inline-flex cursor-pointer items-center gap-1.5 px-1 text-[11px] text-ink-mute">
            <input type="checkbox" checked={deletableOnly} onChange={(e) => setDeletableOnly(e.target.checked)} />
            미발매만 보기
          </label>
          <span className="text-[11px] text-ink-mute">{selected.size}곡 선택됨</span>
          <div className="flex-1" />
          <button
            onClick={() => setDelModal(true)}
            disabled={selected.size === 0}
            className="inline-flex items-center gap-1 rounded-md bg-red-100 px-2.5 py-1.5 text-[11px] font-semibold text-red-900 hover:bg-red-200 disabled:opacity-40 dark:bg-red-500/15 dark:text-red-300"
          >
            <Trash2 size={12} /> 선택 처리 (삭제/공개중단)
          </button>
        </div>
      )}

      <div className="overflow-hidden rounded-2xl bg-bg-card ring-1 ring-line/10">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1200px] text-sm">
            <thead>
              <tr className="border-b border-line/10 text-[11px] uppercase text-ink-dim [&_th]:whitespace-nowrap">
                <th className="w-px px-3 py-2.5 text-left font-semibold">
                  <input type="checkbox" checked={allVisibleSelected} onChange={toggleSelectAll} aria-label="전체 선택" />
                </th>
                <th className="w-px px-3 py-2.5 text-left font-semibold">커버</th>
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
                  <td colSpan={11} className="px-3 py-8 text-center text-xs text-ink-mute">
                    불러오는 중…
                  </td>
                </tr>
              )}
              {!loading && visibleRows.length === 0 && !error && (
                <tr>
                  <td colSpan={11} className="px-3 py-8 text-center text-xs text-ink-mute">
                    {deletableOnly && rows.length > 0
                      ? '삭제 가능한(대기/실패/거절) 음원이 없어요.'
                      : '등록된 음원이 없어요.'}
                  </td>
                </tr>
              )}
              {visibleRows.map((r) => {
                const payoutKey = r.payout_verification_status ?? 'pending';
                const payoutTone = PAYOUT_TONE[payoutKey] ?? PAYOUT_TONE.pending;
                const isExpanded = expandedId === r.track_id;
                const protectedRow = isProtected(r);
                return (
                  <Fragment key={r.track_id}>
                  <tr className="border-b border-line/10 hover:bg-bg-hover">
                    <td className="px-3 py-2.5">
                      <input
                        type="checkbox"
                        checked={selected.has(r.track_id)}
                        onChange={() => toggleSelect(r.track_id)}
                        title={protectedRow ? '발매곡 — 선택 시 공개 중단(takedown)으로 처리됩니다.' : '선택 — 삭제 대상'}
                        aria-label="선택"
                      />
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="h-10 w-10 overflow-hidden rounded-md bg-bg-hover ring-1 ring-line/10">
                        <AutoCover title={r.title} category={r.artist} imageUrl={r.cover_url} size="sm" />
                      </div>
                    </td>
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
                        {removedView && (
                          <button
                            onClick={() => void restoreTrack(r.track_id)}
                            disabled={restoreBusyId === r.track_id}
                            className="inline-flex items-center gap-1 rounded-md bg-emerald-100 px-2 py-1 text-[11px] font-semibold text-emerald-900 hover:bg-emerald-200 disabled:opacity-50 dark:bg-emerald-500/15 dark:text-emerald-300"
                            title="검수/발매 흐름으로 복구"
                          >
                            {restoreBusyId === r.track_id ? <Loader2 size={12} className="animate-spin" /> : '복구'}
                          </button>
                        )}
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
                        <button
                          onClick={() => void openTagEditor(r.track_id, r.title)}
                          className="inline-flex items-center gap-1 rounded-md bg-bg-soft px-2 py-1 text-[11px] font-semibold text-ink-mute ring-1 ring-line/10 hover:bg-bg-hover hover:text-ink"
                          title="장르/무드/매장/시간대 태그 수정"
                        >
                          태그
                        </button>
                        <button
                          onClick={() => setMetaModal({ track_id: r.track_id, title: r.title, canApprove: APPROVABLE_RS.includes(r.release_status ?? '') })}
                          className="inline-flex items-center gap-1 rounded-md bg-indigo-500/25 px-2 py-1 text-[11px] font-semibold text-indigo-200 ring-1 ring-indigo-400/40 hover:bg-indigo-500/35"
                          title="메타 수정 + (가능 시)승인"
                        >
                          메타/승인
                        </button>
                        <label
                          className="inline-flex cursor-pointer items-center rounded p-1.5 text-ink-mute hover:bg-ink/10"
                          title={r.cover_url ? '커버 교체' : '커버 등록'}
                        >
                          {coverBusyId === r.track_id ? (
                            <Loader2 size={14} className="animate-spin" />
                          ) : (
                            <ImagePlus size={14} />
                          )}
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            disabled={coverBusyId === r.track_id}
                            onChange={(e) => {
                              void replaceCover(r.track_id, e.target.files?.[0] ?? null);
                              e.currentTarget.value = '';
                            }}
                          />
                        </label>
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
                      <td colSpan={11} className="px-3 py-3">
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

      {/* 무한 스크롤 sentinel + 항상 노출 "더 불러오기" 버튼 (Observer 불안정 대비) */}
      {!loading && rows.length > 0 && (
        <div ref={sentinelRef} className="flex flex-col items-center justify-center gap-2 py-4 text-xs text-ink-mute">
          {loadingMore && (
            <span className="inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> 추가 로드 중… (offset {rows.length.toLocaleString('ko-KR')})</span>
          )}
          {!loadingMore && hasMore && (
            <button
              onClick={onLoadMore}
              className="rounded-full bg-accent/15 px-4 py-2 font-semibold text-accent ring-1 ring-accent/30 hover:bg-accent/25"
            >
              더 불러오기 · 현재 {rows.length.toLocaleString('ko-KR')}곡 로드 {total > 0 ? `/ 총 ${total.toLocaleString('ko-KR')}곡` : ''}
            </button>
          )}
          {!loadingMore && !hasMore && (
            <span>전체 {(total || rows.length).toLocaleString('ko-KR')}곡 로드 완료</span>
          )}
        </div>
      )}

      {delModal && (
        <div
          ref={delDialogRef}
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-[80] flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center"
          onClick={() => !delBusy && setDelModal(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md space-y-3 rounded-t-3xl bg-bg-soft p-5 ring-1 ring-line/15 sm:rounded-3xl"
          >
            <h3 className="flex items-center gap-2 text-base font-bold">
              <AlertTriangle size={18} className="text-rose-300" /> 음원 선택 처리
            </h3>
            <Alert tone="error">
              <p>선택한 <b>{selected.size}곡</b>을 처리합니다.</p>
              {selectedProtected > 0 && (
                <p className="mt-1 text-[11px]">
                  · 발매곡 <b>{selectedProtected}곡</b> → <b>공개 중단(takedown)</b> 처리 (정산/계약/권리·데이터 보존, 물리삭제 아님)
                </p>
              )}
              {selectedDeletable > 0 && (
                <p className="mt-0.5 text-[11px]">
                  · 미발매곡 <b>{selectedDeletable}곡</b> → <b>삭제</b> 처리
                </p>
              )}
            </Alert>
            <div className="space-y-1">
              <p className="text-[11px] font-semibold text-ink-mute">처리 사유 — 표준 분류 선택 (5자 이상)</p>
              {/* X6.65 — 표준 사유 dropdown 강제 (cluster 학습 정확도) */}
              <RejectReasonSelector
                onChange={setDelReason}
                disabled={delBusy}
                notePlaceholder="예: 아티스트 요청으로 공개 중단 / 테스트 업로드 정리"
              />
              {!reasonValid && delReason.length > 0 && (
                <span className="text-[10px] text-rose-300">사유를 5자 이상 입력해주세요.</span>
              )}
            </div>
            {selectedDeletable > 0 && (
              <label className="flex cursor-pointer items-start gap-2 rounded-lg bg-bg-card p-3 text-xs ring-1 ring-line/10">
                <input
                  type="checkbox"
                  checked={delHard}
                  onChange={(e) => setDelHard(e.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  <b>완전 삭제 (hard)</b> — 미발매곡을 DB에서 제거하고 스토리지 파일을 정리 대상으로 표시.
                  해제 시 <b>보관 삭제(soft)</b>: 숨기고 복구 가능. (발매곡은 항상 공개중단으로만 처리)
                </span>
              </label>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => { setDelModal(false); setDelReason(''); }} disabled={delBusy} className="btn-ghost px-3 py-2 text-xs">
                취소
              </button>
              <button
                onClick={() => void runProcess()}
                disabled={delBusy || !reasonValid}
                className="rounded-lg bg-rose-600 px-4 py-2 text-xs font-bold text-white hover:bg-rose-700 disabled:opacity-50"
              >
                {delBusy ? '처리 중…' : `${selected.size}곡 처리`}
              </button>
            </div>
          </div>
        </div>
      )}
      {tagModal && (
        <div
          ref={tagDialogRef}
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-[80] flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center"
          onClick={() => !tagBusy && setTagModal(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-bg-soft p-5 ring-1 ring-line/15 sm:rounded-3xl animate-slide-up"
          >
            <h3 className="mb-3 text-base font-bold">태그 수정 · {tagModal.title}</h3>
            <TrackMetaSelectors value={tagMeta} onChange={setTagMeta} disabled={tagBusy} />
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setTagModal(null)} disabled={tagBusy} className="btn-ghost px-3 py-2 text-xs">취소</button>
              <button onClick={() => void saveTags()} disabled={tagBusy} className="btn-primary px-4 py-2 text-xs">
                {tagBusy ? '저장 중…' : '태그 저장'}
              </button>
            </div>
          </div>
        </div>
      )}
      {metaModal && (
        <MetaApproveModal trackId={metaModal.track_id} title={metaModal.title} canApprove={metaModal.canApprove}
          onClose={() => setMetaModal(null)} onDone={() => { setMetaModal(null); void load(); }} />
      )}
    </div>
  );
}

