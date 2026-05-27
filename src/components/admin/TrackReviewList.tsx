import { useCallback, useEffect, useState } from 'react';
import { Music, Check, X, MessageSquareWarning, Play, FileText, Wallet, ChevronDown, ChevronRight, Wand2, Pencil } from 'lucide-react';
import { applyAiMetadata } from '@/lib/aiCuration';
import MetaApproveModal from '@/components/admin/MetaApproveModal';
import { useFreshFetch } from '@/hooks/useFreshFetch';
import {
  listPendingReviewTracks,
  countPendingReviewTracks,
  adminApproveArtistRelease,
  adminRejectArtistRelease,
  adminRequestTrackChanges,
  adminBulkApproveTracks,
  adminBulkRejectTracks,
  adminApproveAllPending,
  dispatchTrackModerationEmails,
  dispatchAllModerationEmails,
  getAdminSetting,
  adminBackfillTrackAudioMeta,
  type PendingReviewTrackRow,
  type PendingReviewCounts,
} from '@/lib/artistApi';
import { toast } from '@/store/toastStore';
import { supabase } from '@/lib/supabase';
import Alert from '@/components/Alert';

const PAGE_SIZE = 50;

// 0076 — 검수 액션을 release_status 기반 RPC 로 통일
// (이전: approve_artist_track / reject_artist_track / hide_artist_track — visibility-only 였음)
type ActionKind = 'approve' | 'reject' | 'changes';

const PAYOUT_TONE: Record<string, string> = {
  verified:
    'bg-emerald-100 text-emerald-900 dark:bg-emerald-500/15 dark:text-emerald-300',
  pending:
    'bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-200',
  rejected: 'bg-red-100 text-red-900 dark:bg-red-500/15 dark:text-red-300',
};

const PAYOUT_LABEL: Record<string, string> = {
  verified: '계좌 ✓',
  pending: '계좌 대기',
  rejected: '계좌 거절',
};

export default function TrackReviewList() {
  const [rows, setRows] = useState<PendingReviewTrackRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [openLyricsId, setOpenLyricsId] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [artistId, setArtistId] = useState<string | null>(null);
  const [counts, setCounts] = useState<PendingReviewCounts>({ total: 0, by_artist: [] });
  const [modal, setModal] = useState<{
    kind: ActionKind;
    track: PendingReviewTrackRow;
  } | null>(null);
  const [metaModal, setMetaModal] = useState<{ track_id: string; title: string | null } | null>(null);
  // 일괄 선택/처리
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState<'approve' | 'reject' | 'approveAll' | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [data, cnt] = await Promise.all([
        listPendingReviewTracks({ limit: PAGE_SIZE, offset: page * PAGE_SIZE, artistId }),
        countPendingReviewTracks(),
      ]);
      setRows(data);
      setCounts(cnt);
      setSelected(new Set());
    } finally {
      setLoading(false);
    }
  }, [page, artistId]);

  useFreshFetch(load, [page, artistId]);

  // 0155 — 검수 self-heal: 플레이어가 메타데이터를 읽으면 duration/content_type 을 트랙에 백필.
  // 업로드 시 duration 이 기록되지 않아 발매 게이트(duration>0)에 막힌 곡을 자동 복구한다.
  const [healedIds, setHealedIds] = useState<Set<string>>(new Set());
  const healAudioMeta = useCallback(
    async (row: PendingReviewTrackRow, durationSec: number) => {
      if (healedIds.has(row.track_id)) return;
      if (!Number.isFinite(durationSec) || durationSec <= 0) return;
      // 이미 duration 이 있고 content_type 도 mp3 면 백필 불필요
      if ((row.duration ?? 0) > 0 && row.audio_content_type === 'audio/mpeg') return;
      setHealedIds((s) => new Set(s).add(row.track_id));
      try {
        const isMp3 = !!row.audio_url && /\.mp3(\?|$)/i.test(row.audio_url);
        const res = await adminBackfillTrackAudioMeta({
          trackId: row.track_id,
          duration: Math.round(durationSec),
          contentType: isMp3 ? 'audio/mpeg' : null,
        });
        setRows((prev) =>
          prev.map((t) =>
            t.track_id === row.track_id
              ? {
                  ...t,
                  duration: res.duration ?? Math.round(durationSec),
                  audio_content_type: res.content_type ?? t.audio_content_type,
                  audio_health_status: res.audio_health_status ?? t.audio_health_status,
                }
              : t,
          ),
        );
      } catch (e) {
        // 실패해도 조용히 — 다음 로드/수동 재분석에서 재시도
        setHealedIds((s) => {
          const n = new Set(s);
          n.delete(row.track_id);
          return n;
        });
        console.warn('[review] audio meta backfill 실패', (e as Error).message);
      }
    },
    [healedIds],
  );

  // 필터 기준 총건수 (아티스트 필터 시 해당 아티스트 건수, 아니면 전체)
  const filteredTotal = artistId
    ? counts.by_artist.find((a) => a.owner_user_id === artistId)?.n ?? 0
    : counts.total;
  const pageCount = Math.max(1, Math.ceil(filteredTotal / PAGE_SIZE));

  // 액션 처리로 현재 페이지가 범위를 벗어나면 마지막 페이지로 보정
  useEffect(() => {
    if (page > 0 && page >= pageCount) setPage(pageCount - 1);
  }, [page, pageCount]);

  async function overrideQualityWarning(r: PendingReviewTrackRow) {
    setBusyId(r.track_id);
    try {
      const { error } = await supabase.rpc('admin_override_quality_warning', { p_track_id: r.track_id, p_note: null });
      if (error) throw error;
      toast.success('품질 경고 승인(override) 처리됐어요.');
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  }

  async function overwriteWithAi(r: PendingReviewTrackRow) {
    setBusyId(r.track_id);
    try {
      await applyAiMetadata(r.track_id, { moods: r.ai_moods ?? null });
      toast.success('AI 추천 메타데이터로 덮어썼어요. (적합도 재계산 완료)');
      await load();
    } catch (e) {
      toast.error(`적용 실패: ${(e as Error).message}`);
    } finally {
      setBusyId(null);
    }
  }

  async function handleConfirm(
    reason: string,
    adminNote: string,
    /** approve 액션 한정: true=즉시 공개, false=예약 발매 유지, null=admin_settings 기본값 */
    immediateRelease: boolean | null = null,
  ) {
    if (!modal) return;
    const { kind, track } = modal;
    setBusyId(track.track_id);
    try {
      const combinedReason = (reason || '').trim() || (adminNote || '').trim() || '';
      if (kind === 'approve') {
        const res = await adminApproveArtistRelease(track.track_id, immediateRelease);
        toast.success(
          res.status === 'released'
            ? `승인 완료 — 서비스에 즉시 공개되었습니다 (정산 대상 포함)`
            : `승인 완료 — 발매 예약 (${res.release_date ?? track.release_date ?? '발매일 미정'})`,
        );
      } else if (kind === 'reject') {
        if (!combinedReason) {
          toast.error('거절 사유를 입력해주세요');
          return;
        }
        await adminRejectArtistRelease(track.track_id, combinedReason);
        toast.success('거절·삭제 완료 — 서비스에서 즉시 미노출되고 "삭제 음원" 탭으로 이동했습니다');
      } else if (kind === 'changes') {
        if (!combinedReason) {
          toast.error('수정 요청 사유를 입력해주세요');
          return;
        }
        await adminRequestTrackChanges(track.track_id, combinedReason, 'all');
        toast.success('수정 요청 완료 — 아티스트가 수정 후 재제출할 수 있습니다');
      }
      // 알림 메일 자동 발송 (실패해도 검수 자체는 진행됨)
      void (async () => {
        const r = await dispatchTrackModerationEmails(track.track_id);
        if (r.ok && (r.sent ?? 0) > 0) toast.info(`알림 메일 ${r.sent}건 발송`);
      })();
      setModal(null);
      await load();
    } catch (e) {
      // 서버 게이트 거절 사유를 명확히 표시 (PostgREST: message + hint + details)
      const err = e as { message?: string; hint?: string; details?: string; code?: string };
      const msg = err.message ?? String(e);
      const reasonText = err.hint || err.details || msg;
      console.error('[review] action failed', { kind, track_id: track.track_id, code: err.code, message: msg, hint: err.hint, details: err.details });
      toast.error(`처리 실패: ${reasonText}`);
    } finally {
      setBusyId(null);
    }
  }

  const pageIds = rows.map((r) => r.track_id);
  const allPageSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));

  function toggleSelectAllPage() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allPageSelected) pageIds.forEach((id) => next.delete(id));
      else pageIds.forEach((id) => next.add(id));
      return next;
    });
  }
  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  // 선택 곡 일괄 승인
  async function runBulkApprove(immediate: boolean | null) {
    const ids = [...selected];
    if (ids.length === 0) return;
    setBulkBusy(true);
    setBulkProgress(`${ids.length}곡 승인 중…`);
    try {
      const res = await adminBulkApproveTracks(ids, immediate);
      const mail = await dispatchAllModerationEmails();
      const sentMsg = mail.ok && (mail.sent ?? 0) > 0 ? ` — 메일 ${mail.sent}통 발송` : '';
      if (res.failed.length === 0) {
        toast.success(`${res.approved}곡 승인 완료${sentMsg}`);
      } else {
        toast.warning(`승인 ${res.approved}곡 · 실패 ${res.failed.length}곡${sentMsg}`);
      }
      setBulk(null);
      await load();
    } catch (e) {
      toast.error(`일괄 승인 실패: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBulkBusy(false);
      setBulkProgress(null);
    }
  }

  // 선택 곡 일괄 거절
  async function runBulkReject(reason: string) {
    const ids = [...selected];
    if (ids.length === 0) return;
    if (!reason.trim()) {
      toast.error('거절 사유를 입력해주세요');
      return;
    }
    setBulkBusy(true);
    setBulkProgress(`${ids.length}곡 거절 중…`);
    try {
      const res = await adminBulkRejectTracks(ids, reason.trim());
      const mail = await dispatchAllModerationEmails();
      const sentMsg = mail.ok && (mail.sent ?? 0) > 0 ? ` — 메일 ${mail.sent}통 발송` : '';
      if (res.failed.length === 0) {
        toast.success(`${res.rejected}곡 거절 완료${sentMsg}`);
      } else {
        toast.warning(`거절 ${res.rejected}곡 · 실패 ${res.failed.length}곡${sentMsg}`);
      }
      setBulk(null);
      await load();
    } catch (e) {
      toast.error(`일괄 거절 실패: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBulkBusy(false);
      setBulkProgress(null);
    }
  }

  // 현재 필터 전체 승인 (서버 chunk 반복)
  async function runApproveAll(immediate: boolean | null) {
    setBulkBusy(true);
    let approved = 0;
    let failedTotal = 0;
    try {
      // 안전 상한: 최대 1000 chunk(=최대 50만곡)까지 반복
      for (let i = 0; i < 1000; i++) {
        const res = await adminApproveAllPending(artistId, immediate, 200);
        approved += res.approved ?? 0;
        failedTotal += res.failed?.length ?? 0;
        setBulkProgress(`${approved}곡 승인 완료 · 남은 ${res.remaining ?? 0}곡…`);
        if ((res.remaining ?? 0) <= 0 || (res.approved ?? 0) === 0) break;
      }
      const mail = await dispatchAllModerationEmails();
      const sentMsg = mail.ok && (mail.sent ?? 0) > 0 ? ` — ${mail.sent}개 묶음 메일 발송` : '';
      if (failedTotal === 0) toast.success(`${approved}곡 승인 완료${sentMsg}`);
      else toast.warning(`승인 ${approved}곡 · 실패 ${failedTotal}곡${sentMsg}`);
      setBulk(null);
      setPage(0);
      await load();
    } catch (e) {
      toast.error(`전체 승인 실패: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBulkBusy(false);
      setBulkProgress(null);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-1.5 text-lg font-bold tracking-tight">
            <Music size={16} className="text-accent" /> 음원 검수
          </h2>
          <p className="text-xs text-ink-mute">
            심사 대기 총 {counts.total.toLocaleString()}건
            {artistId && <> · 이 아티스트 {filteredTotal.toLocaleString()}건</>}
            {' · '}{page + 1}/{pageCount} 페이지
          </p>
        </div>
        {counts.by_artist.length > 0 && (
          <select
            value={artistId ?? ''}
            onChange={(e) => {
              setArtistId(e.target.value || null);
              setPage(0);
            }}
            className="input w-auto max-w-[220px] text-xs"
          >
            <option value="">전체 아티스트 ({counts.total.toLocaleString()})</option>
            {counts.by_artist.map((a) => (
              <option key={a.owner_user_id ?? a.artist_name} value={a.owner_user_id ?? ''}>
                {a.artist_name} ({a.n})
              </option>
            ))}
          </select>
        )}
      </div>

      {/* 일괄 작업 툴바 */}
      {!loading && rows.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl bg-bg-soft/60 p-2 ring-1 ring-line/10">
          <label className="inline-flex cursor-pointer items-center gap-1.5 px-1 text-xs font-semibold">
            <input type="checkbox" checked={allPageSelected} onChange={toggleSelectAllPage} />
            현재 페이지 전체 선택
          </label>
          <span className="text-[11px] text-ink-mute">{selected.size}곡 선택됨</span>
          <div className="flex-1" />
          <button
            onClick={() => setBulk('approve')}
            disabled={selected.size === 0 || bulkBusy}
            className="inline-flex items-center gap-1 rounded-md bg-emerald-100 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-900 hover:bg-emerald-200 disabled:opacity-40 dark:bg-emerald-500/15 dark:text-emerald-300"
          >
            <Check size={11} /> 선택 승인
          </button>
          <button
            onClick={() => setBulk('reject')}
            disabled={selected.size === 0 || bulkBusy}
            className="inline-flex items-center gap-1 rounded-md bg-red-100 px-2.5 py-1.5 text-[11px] font-semibold text-red-900 hover:bg-red-200 disabled:opacity-40 dark:bg-red-500/15 dark:text-red-300"
          >
            <X size={11} /> 선택 거절
          </button>
          <button
            onClick={() => setBulk('approveAll')}
            disabled={bulkBusy || filteredTotal === 0}
            className="inline-flex items-center gap-1 rounded-md bg-accent px-2.5 py-1.5 text-[11px] font-semibold text-black hover:bg-accent/90 disabled:opacity-40"
          >
            <Check size={11} /> 현재 필터 전체 승인 ({filteredTotal.toLocaleString()})
          </button>
        </div>
      )}
      {bulkProgress && (
        <div className="rounded-lg bg-accent/10 px-3 py-2 text-xs font-semibold text-accent ring-1 ring-accent/20">
          ⏳ {bulkProgress}
        </div>
      )}

      <div className="overflow-hidden rounded-2xl bg-bg-card ring-1 ring-line/10">
        {loading ? (
          <div className="p-8 text-center text-xs text-ink-mute">불러오는 중…</div>
        ) : rows.length === 0 ? (
          <div className="p-8 text-center text-xs text-ink-mute">심사 대기 중인 음원이 없어요.</div>
        ) : (
          <ul className="divide-y divide-line/10">
            {rows.map((r) => {
              const payoutKey = r.payout_verification_status ?? 'pending';
              const payoutTone = PAYOUT_TONE[payoutKey] ?? PAYOUT_TONE.pending;
              const payoutLabel = PAYOUT_LABEL[payoutKey] ?? '계좌 미등록';
              const lyricsOpen = openLyricsId === r.track_id;
              // 승인(발매) 전 필수값 게이트 — 누락 시 승인 버튼 비활성화 (서버 RPC 도 동일 검증)
              const missingMeta: string[] = [];
              if (!r.cover_url || r.cover_url.trim() === '') missingMeta.push('앨범 자켓');
              if (!r.main_genre || r.main_genre.trim() === '') missingMeta.push('장르');
              if (!r.title || r.title.trim() === '') missingMeta.push('제목');
              if (!r.album_name || r.album_name.trim() === '') missingMeta.push('앨범명');
              if (!r.release_date) missingMeta.push('발매일');
              // 0155 — 오디오 재생 가능/발매 게이트 (서버 admin_approve_artist_release 와 동일)
              const hasAudio = !!((r.audio_url && r.audio_url.trim()) || (r.storage_path && r.storage_path.trim()));
              if (!hasAudio) missingMeta.push('음원 파일');
              if (r.audio_health_status === 'conversion_failed') missingMeta.push('MP3 변환 실패');
              if (r.audio_content_type && r.audio_content_type !== 'audio/mpeg') missingMeta.push('비-MP3 음원');
              if (!r.duration || r.duration <= 0) missingMeta.push('재생 길이(메타 추출 중)');
              const canApprove = missingMeta.length === 0;
              return (
                <li key={r.track_id} className="space-y-2 p-3">
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={selected.has(r.track_id)}
                      onChange={() => toggleSelect(r.track_id)}
                      className="mt-1 shrink-0"
                      aria-label="선택"
                    />
                    <div className="h-14 w-14 shrink-0 overflow-hidden rounded-md bg-bg-hover">
                      {r.cover_url ? (
                        <img src={r.cover_url} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-ink-dim">
                          <Music size={14} />
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <p className="truncate text-sm font-semibold">{r.title}</p>
                      {r.track_code && (
                        <code className="inline-block rounded bg-bg-soft px-1.5 py-0.5 font-mono text-[10px] text-ink-mute">
                          {r.track_code}
                        </code>
                      )}
                      <p className="truncate text-xs text-ink-mute">
                        {r.artist_name ?? r.artist ?? '—'}
                        {r.album_name && <span className="text-ink-dim"> · {r.album_name}</span>}
                      </p>
                      {r.rights_holder_name && (
                        <p className="text-[11px] text-ink-dim">
                          권리자: <span className="text-ink-mute">{r.rights_holder_name}</span>
                          {r.isrc && (
                            <span className="ml-2">
                              ISRC: <code className="font-mono">{r.isrc}</code>
                            </span>
                          )}
                        </p>
                      )}
                      <p className="text-[11px] text-ink-dim">
                        업로드: {new Date(r.created_at).toLocaleString('ko-KR')}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-900 dark:bg-amber-500/15 dark:text-amber-200">
                        심사 대기
                      </span>
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${payoutTone}`}
                        title={r.payout_bank_name ?? '—'}
                      >
                        <Wallet size={9} />
                        {payoutLabel}
                      </span>
                      {r.owner_trust_tier && (
                        <span
                          title={r.owner_trust_tier === 'low'
                            ? '주의 업로더 — 자동배치 제외 · AI 추천 메타 우선 · 직접 메타 반영 금지 권장'
                            : r.owner_trust_tier === 'medium'
                              ? '일반 검수 (불일치/guardrail 시 경고 강화)'
                              : 'AI 메타 일치 시 빠른 승인 가능'}
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                            r.owner_trust_tier === 'low'
                              ? 'bg-rose-100 text-rose-900 dark:bg-rose-500/15 dark:text-rose-300'
                              : r.owner_trust_tier === 'medium'
                                ? 'bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-200'
                                : 'bg-emerald-100 text-emerald-900 dark:bg-emerald-500/15 dark:text-emerald-300'
                          }`}
                        >
                          신뢰도 {r.owner_trust_score ?? 100}
                          {r.owner_trust_tier === 'low' && ' · 주의'}
                          {r.owner_trust_tier === 'high' && (r.mismatch_score ?? 0) < 0.3 && !r.q_clipping && ' · 빠른승인 가능'}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-1.5 text-[11px]">
                    {r.main_genre && (
                      <Tag label="메인" value={r.main_genre} tone="bg-accent/15 text-accent" />
                    )}
                    {r.sub_genre && (
                      <Tag label="서브" value={r.sub_genre} tone="bg-ink/5 text-ink-mute" />
                    )}
                    {r.mood && <Tag label="분위기" value={r.mood} tone="bg-ink/5 text-ink-mute" />}
                    {r.suitable_store && (
                      <Tag
                        label="매장"
                        value={r.suitable_store}
                        tone="bg-sky-100 text-sky-900 dark:bg-blue-500/15 dark:text-blue-200"
                      />
                    )}
                  </div>

                  {r.admin_note && (
                    <p className="rounded bg-bg-soft px-2 py-1 text-[11px] text-ink-mute">
                      📝 이전 관리자 메모: {r.admin_note}
                    </p>
                  )}

                  {r.audio_url && (
                    <audio
                      src={r.audio_url}
                      controls
                      preload="metadata"
                      className="h-8 w-full"
                      onLoadedMetadata={(e) => {
                        const d = e.currentTarget.duration;
                        if (Number.isFinite(d) && d > 0) void healAudioMeta(r, d);
                      }}
                    />
                  )}

                  {/* 0155 — 재생 가능/발매 게이트 진단 */}
                  <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
                    <DiagChip ok={hasAudio} label={hasAudio ? '음원 O' : '음원 X'} />
                    <DiagChip
                      ok={!!r.duration && r.duration > 0}
                      label={r.duration && r.duration > 0 ? `재생 ${Math.floor(r.duration / 60)}:${String(Math.floor(r.duration % 60)).padStart(2, '0')}` : '재생 길이 추출 중…'}
                    />
                    <DiagChip
                      ok={!r.audio_content_type || r.audio_content_type === 'audio/mpeg'}
                      label={r.audio_content_type ? (r.audio_content_type === 'audio/mpeg' ? 'MP3' : r.audio_content_type) : 'type ?'}
                    />
                    <DiagChip
                      ok={r.audio_health_status !== 'conversion_failed'}
                      label={`health: ${r.audio_health_status ?? 'unknown'}`}
                    />
                  </div>

                  {/* 0167 — Loudness 품질 게이트 측정값 */}
                  {r.q_integrated_lufs != null && (
                    <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
                      <DiagChip ok={!!r.q_passed} label={r.q_passed ? '품질 Pass' : '품질 Fail'} />
                      {/* 기준: 등록 가능 LUFS -16~-8 (권장 -14~-10) */}
                      <DiagChip ok={r.q_integrated_lufs >= -16 && r.q_integrated_lufs <= -8} label={`${r.q_integrated_lufs} LUFS`} />
                      {/* TP: 등록 차단은 >0 (실측 클리핑) 만. -1~0 은 코덱 오버슈트 경고 */}
                      <DiagChip ok={r.q_true_peak == null || r.q_true_peak <= 0} label={`${r.q_true_peak ?? '?'} dBTP`} />
                      {r.q_true_peak != null && r.q_true_peak > -1 && r.q_true_peak <= 0 && (
                        <span className="rounded bg-amber-500/15 px-1.5 py-0.5 font-semibold text-amber-600">TP 경고(코덱 오버슈트 의심)</span>
                      )}
                      {r.q_loudness_range != null && <span className="rounded bg-ink/5 px-1.5 py-0.5 text-ink-dim">LRA {r.q_loudness_range}</span>}
                      <DiagChip ok={!r.q_clipping} label={r.q_clipping ? 'clipping' : 'no clip'} />
                      {r.q_true_peak != null && r.q_true_peak > -1 && r.q_true_peak <= 0 && (
                        <button
                          type="button"
                          disabled={busyId === r.track_id}
                          onClick={() => void overrideQualityWarning(r)}
                          className="rounded bg-emerald-500/15 px-1.5 py-0.5 font-semibold text-emerald-600 hover:bg-emerald-500/25 disabled:opacity-50"
                        >
                          품질경고 승인
                        </button>
                      )}
                    </div>
                  )}

                  {/* 0161 — AI 큐레이션 판정 연결 */}
                  {r.ai_status && r.ai_status !== 'pending' && (
                    <div className={`rounded-md p-2 text-[11px] ${(r.mismatch_score ?? 0) >= 0.5 ? 'bg-rose-500/10 ring-1 ring-rose-500/20' : 'bg-bg-hover/40'}`}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-semibold">
                          AI: 에너지 {r.ai_energy_level ?? '-'} · 무드 {(r.ai_moods ?? []).join(',') || '-'}
                          {r.mismatch_score != null && (
                            <span className={`ml-2 ${(r.mismatch_score) >= 0.5 ? 'text-rose-600' : 'text-ink-mute'}`}>
                              불일치 {Math.round(r.mismatch_score * 100)}%
                            </span>
                          )}
                        </span>
                        {(r.mismatch_score ?? 0) >= 0.4 && (
                          <button
                            onClick={() => void overwriteWithAi(r)}
                            disabled={busyId === r.track_id}
                            className="inline-flex items-center gap-1 rounded bg-accent/15 px-2 py-1 text-[10px] font-semibold text-accent hover:bg-accent/25 disabled:opacity-50"
                          >
                            <Wand2 size={10} /> AI 추천값으로 덮어쓰기
                          </button>
                        )}
                      </div>
                      {(r.mismatch_score ?? 0) >= 0.5 && (
                        <p className="mt-1 font-semibold text-rose-600">⚠ 등록 메타데이터와 실제 음원 특성이 크게 다릅니다. 승인 전 확인하세요.</p>
                      )}
                      {r.ai_explanation && <p className="mt-1 text-ink-mute">{r.ai_explanation}</p>}
                    </div>
                  )}

                  {r.lyrics && (
                    <div className="rounded-md bg-bg-hover/40 p-2">
                      <button
                        type="button"
                        onClick={() => setOpenLyricsId(lyricsOpen ? null : r.track_id)}
                        className="flex w-full items-center gap-1.5 text-[11px] font-semibold text-ink-mute hover:text-ink"
                      >
                        {lyricsOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                        <FileText size={11} />
                        가사 ({r.lyrics.length}자)
                      </button>
                      {lyricsOpen && (
                        <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap text-[11px] leading-relaxed text-ink-mute">
                          {r.lyrics}
                        </pre>
                      )}
                    </div>
                  )}

                  {!canApprove && (
                    <p className="rounded bg-red-100 px-2 py-1 text-[11px] font-semibold text-red-900 dark:bg-red-500/15 dark:text-red-300">
                      ⚠ 필수값 누락: {missingMeta.join(', ')} — 보완 전까지 승인 불가
                    </p>
                  )}

                  <div className="flex flex-wrap justify-end gap-1.5">
                    <button
                      onClick={() => setMetaModal({ track_id: r.track_id, title: r.title })}
                      disabled={busyId === r.track_id}
                      className="inline-flex items-center gap-1 rounded-md bg-indigo-100 px-2.5 py-1 text-[11px] font-semibold text-indigo-900 hover:bg-indigo-200 disabled:opacity-50 dark:bg-indigo-500/15 dark:text-indigo-300 dark:hover:bg-indigo-500/25"
                    >
                      <Pencil size={11} /> 메타 수정/승인
                    </button>
                    <button
                      onClick={() => setModal({ kind: 'approve', track: r })}
                      disabled={busyId === r.track_id || !canApprove}
                      title={canApprove ? undefined : `필수값 누락: ${missingMeta.join(', ')}`}
                      className="inline-flex items-center gap-1 rounded-md bg-emerald-100 px-2.5 py-1 text-[11px] font-semibold text-emerald-900 hover:bg-emerald-200 disabled:opacity-50 dark:bg-emerald-500/15 dark:text-emerald-300 dark:hover:bg-emerald-500/25"
                    >
                      <Check size={11} /> 승인
                    </button>
                    <button
                      onClick={() => setModal({ kind: 'reject', track: r })}
                      disabled={busyId === r.track_id}
                      className="inline-flex items-center gap-1 rounded-md bg-red-100 px-2.5 py-1 text-[11px] font-semibold text-red-900 hover:bg-red-200 disabled:opacity-50 dark:bg-red-500/15 dark:text-red-300 dark:hover:bg-red-500/25"
                    >
                      <X size={11} /> 거절·삭제
                    </button>
                    <button
                      onClick={() => setModal({ kind: 'changes', track: r })}
                      disabled={busyId === r.track_id}
                      className="inline-flex items-center gap-1 rounded-md bg-amber-100 px-2.5 py-1 text-[11px] font-semibold text-amber-900 hover:bg-amber-200 disabled:opacity-50 dark:bg-amber-500/15 dark:text-amber-200 dark:hover:bg-amber-500/25"
                    >
                      <MessageSquareWarning size={11} /> 수정 요청
                    </button>
                    {r.audio_url && (
                      <a
                        href={r.audio_url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="inline-flex items-center gap-1 rounded-md bg-ink/5 px-2.5 py-1 text-[11px] font-semibold text-ink-mute hover:bg-ink/10"
                      >
                        <Play size={11} /> 원본
                      </a>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {pageCount > 1 && (
        <div className="flex items-center justify-center gap-3 text-xs">
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0 || loading}
            className="rounded-md bg-bg-soft px-3 py-1.5 font-semibold ring-1 ring-line/10 disabled:opacity-40"
          >
            이전
          </button>
          <span className="text-ink-mute">{page + 1} / {pageCount}</span>
          <button
            onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
            disabled={page >= pageCount - 1 || loading}
            className="rounded-md bg-bg-soft px-3 py-1.5 font-semibold ring-1 ring-line/10 disabled:opacity-40"
          >
            다음
          </button>
        </div>
      )}

      {modal && (
        <ReviewActionModal
          kind={modal.kind}
          trackTitle={modal.track.title}
          trackCode={modal.track.track_code}
          releaseDate={modal.track.release_date ?? null}
          busy={busyId === modal.track.track_id}
          onCancel={() => setModal(null)}
          onConfirm={handleConfirm}
        />
      )}

      {metaModal && (
        <MetaApproveModal
          trackId={metaModal.track_id}
          title={metaModal.title}
          canApprove={true}
          onClose={() => setMetaModal(null)}
          onDone={() => { setMetaModal(null); void load(); }}
        />
      )}

      {bulk && (
        <BulkActionModal
          kind={bulk}
          count={bulk === 'approveAll' ? filteredTotal : selected.size}
          busy={bulkBusy}
          onCancel={() => !bulkBusy && setBulk(null)}
          onApprove={(immediate) => (bulk === 'approveAll' ? runApproveAll(immediate) : runBulkApprove(immediate))}
          onReject={(reason) => runBulkReject(reason)}
        />
      )}
    </div>
  );
}

function BulkActionModal({
  kind,
  count,
  busy,
  onCancel,
  onApprove,
  onReject,
}: {
  kind: 'approve' | 'reject' | 'approveAll';
  count: number;
  busy: boolean;
  onCancel: () => void;
  onApprove: (immediate: boolean | null) => void;
  onReject: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  const isReject = kind === 'reject';
  const title = isReject ? '선택 일괄 거절' : kind === 'approveAll' ? '현재 필터 전체 승인' : '선택 일괄 승인';
  return (
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center"
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md space-y-3 rounded-t-3xl bg-bg-soft p-5 ring-1 ring-line/15 sm:rounded-3xl"
      >
        <h3 className="text-base font-bold">{title}</h3>
        <Alert tone={isReject ? 'error' : 'warning'}>
          {kind === 'approveAll' ? (
            <p>현재 필터의 심사 대기 <b>{count.toLocaleString()}곡</b>을 승인합니다. 계속할까요?</p>
          ) : (
            <p>선택한 <b>{count.toLocaleString()}곡</b>을 {isReject ? '거절' : '승인'}합니다. 계속할까요?</p>
          )}
          <p className="mt-1 text-[11px] opacity-80">
            메일은 업로드 묶음(앨범)당 1통만 발송됩니다.
          </p>
        </Alert>
        {isReject && (
          <label className="block space-y-1">
            <span className="text-xs font-semibold text-ink-mute">아티스트에게 노출될 거절 사유 (전체 공통)</span>
            <textarea
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="input"
              placeholder="예: 권리 확인 불가, 메타데이터 부족 등"
            />
          </label>
        )}
        <div className="flex flex-wrap justify-end gap-2 pt-1">
          <button onClick={onCancel} disabled={busy} className="btn-ghost px-3 py-2 text-xs">
            취소
          </button>
          {isReject ? (
            <button
              onClick={() => onReject(reason)}
              disabled={busy || !reason.trim()}
              className="rounded-lg bg-red-500 px-4 py-2 text-xs font-bold text-white hover:bg-red-600 disabled:opacity-60"
            >
              {busy ? '처리 중…' : `${count.toLocaleString()}곡 거절`}
            </button>
          ) : (
            <>
              <button
                onClick={() => onApprove(false)}
                disabled={busy}
                className="rounded-lg bg-sky-600 px-3 py-2 text-xs font-bold text-white hover:bg-sky-700 disabled:opacity-60"
              >
                {busy ? '처리 중…' : '예약 발매'}
              </button>
              <button
                onClick={() => onApprove(true)}
                disabled={busy}
                className="rounded-lg bg-emerald-500 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-600 disabled:opacity-60"
              >
                {busy ? '처리 중…' : '즉시 공개'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ReviewActionModal({
  kind,
  trackTitle,
  trackCode,
  releaseDate,
  busy,
  onCancel,
  onConfirm,
}: {
  kind: ActionKind;
  trackTitle: string;
  trackCode: string | null;
  releaseDate: string | null;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (reason: string, adminNote: string, immediateRelease: boolean | null) => void;
}) {
  const [reason, setReason] = useState('');
  const [adminNote, setAdminNote] = useState('');
  const [defaultImmediate, setDefaultImmediate] = useState<boolean>(true);

  useEffect(() => {
    if (kind !== 'approve') return;
    void (async () => {
      try {
        const v = await getAdminSetting<boolean>('default_immediate_release');
        if (typeof v === 'boolean') setDefaultImmediate(v);
      } catch {
        // ignore — 기본값 true 유지
      }
    })();
  }, [kind]);

  const titles: Record<ActionKind, string> = {
    approve: '승인 처리',
    reject: '거절·삭제 처리',
    changes: '수정 요청',
  };
  const tones: Record<ActionKind, 'success' | 'error' | 'warning'> = {
    approve: 'success',
    reject: 'error',
    changes: 'warning',
  };
  const buttonColor: Record<ActionKind, string> = {
    approve: 'bg-emerald-500 hover:bg-emerald-600',
    reject: 'bg-red-500 hover:bg-red-600',
    changes: 'bg-amber-500 hover:bg-amber-600',
  };

  // release_date 가 과거면 즉시 공개만 가능 (서버도 강제)
  const releaseDatePast = releaseDate ? new Date(releaseDate) <= new Date(new Date().toDateString()) : false;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center"
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md space-y-3 rounded-t-3xl bg-bg-soft p-5 ring-1 ring-line/15 sm:rounded-3xl"
      >
        <h3 className="text-base font-bold">{titles[kind]}</h3>
        <Alert tone={tones[kind]}>
          <p className="font-semibold">{trackTitle}</p>
          {trackCode && (
            <p className="mt-0.5 font-mono text-[11px] opacity-80">{trackCode}</p>
          )}
          {releaseDate && (
            <p className="mt-0.5 text-[11px] opacity-80">발매일 {releaseDate}</p>
          )}
        </Alert>
        {(kind === 'reject' || kind === 'changes') && (
          <label className="block space-y-1">
            <span className="text-xs font-semibold text-ink-mute">
              {kind === 'reject'
                ? '거절 사유 (거절 시 즉시 서비스 미노출 → "삭제 음원" 탭으로 이동)'
                : '아티스트에게 노출될 수정 요청 사유'}
            </span>
            <textarea
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="input"
              placeholder={
                kind === 'reject'
                  ? '예: 권리 확인 불가, 메타데이터 부족, 음질 문제, AI 정책 위반 가능성 등'
                  : '예: 가사 보완 필요, 커버 이미지 재업로드 등'
              }
            />
          </label>
        )}
        {kind === 'approve' && (
          <>
            <Alert tone="info">
              <p className="text-xs leading-relaxed">
                승인 시 계약 / 정산 계좌 / 아티스트 승인 게이트가 재검증됩니다.<br/>
                {releaseDatePast
                  ? '발매일이 오늘 이하 — 즉시 공개만 가능합니다.'
                  : <>기본값: <b>{defaultImmediate ? '즉시 공개' : '예약 발매'}</b> (운영 설정)</>}
              </p>
            </Alert>
          </>
        )}
        {kind !== 'approve' && (
          <label className="block space-y-1">
            <span className="text-xs font-semibold text-ink-mute">내부 관리자 메모 (선택)</span>
            <textarea
              rows={2}
              value={adminNote}
              onChange={(e) => setAdminNote(e.target.value)}
              className="input"
              placeholder="다음 검수자가 참고할 메모"
            />
          </label>
        )}
        <div className="flex flex-wrap justify-end gap-2 pt-1">
          <button onClick={onCancel} disabled={busy} className="btn-ghost px-3 py-2 text-xs">
            취소
          </button>
          {kind === 'approve' ? (
            <>
              {!releaseDatePast && (
                <button
                  onClick={() => onConfirm('', '', false)}
                  disabled={busy}
                  className="rounded-lg bg-sky-600 px-3 py-2 text-xs font-bold text-white hover:bg-sky-700 disabled:opacity-60"
                >
                  {busy ? '처리 중…' : '예약 발매 유지'}
                </button>
              )}
              <button
                onClick={() => onConfirm('', '', true)}
                disabled={busy}
                className="rounded-lg bg-emerald-500 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-600 disabled:opacity-60"
              >
                {busy ? '처리 중…' : '즉시 공개'}
              </button>
            </>
          ) : (
            <button
              onClick={() => onConfirm(reason, adminNote, null)}
              disabled={busy}
              className={`rounded-lg px-4 py-2 text-xs font-bold text-white disabled:opacity-60 ${buttonColor[kind]}`}
            >
              {busy ? '처리 중…' : `${titles[kind]}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Tag({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium ${tone}`}>
      <span className="text-[9px] uppercase tracking-wider opacity-70">{label}</span>
      {value}
    </span>
  );
}

// 0155 — 검수 페이지 재생 가능/발매 게이트 진단 칩
function DiagChip({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-semibold ${
        ok
          ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300'
          : 'bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-200'
      }`}
    >
      {ok ? '✓' : '⏳'} {label}
    </span>
  );
}
