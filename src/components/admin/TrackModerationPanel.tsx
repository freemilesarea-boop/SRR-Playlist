/**
 * TrackModerationPanel — 0074 DSP 검수 파이프라인 패널.
 *
 * 한 트랙에 대해:
 * - release_status 액션 버튼 (approve / request_changes / reject / takedown / restore /
 *   hide_released / unhide_released)
 * - moderation events 로그
 * - email jobs 상태 + 재발송
 * - 반려/수정 사유 템플릿
 *
 * 기존 visibility_status 기반 UI (approve/reject/hide) 와 충돌하지 않게 별도 패널로 노출.
 */

import { useEffect, useState } from 'react';
import { CheckCircle2, XCircle, MessageSquareWarning, Trash2, Undo2, EyeOff, Eye, RefreshCw, Mail } from 'lucide-react';
import {
  adminApproveArtistRelease,
  adminRejectArtistRelease,
  adminRequestTrackChanges,
  adminTakedownTrack,
  adminRestoreTrack,
  adminHideReleasedTrack,
  adminUnhideReleasedTrack,
  adminListTrackModerationEvents,
  adminListTrackModerationEmailJobs,
  adminRequeueTrackModerationEmails,
  dispatchTrackModerationEmails,
  type TrackModerationEvent,
  type TrackModerationEmailJob,
} from '@/lib/artistApi';
import { toast } from '@/store/toastStore';
import Alert from '@/components/Alert';
import { friendlyError } from '@/lib/errorMessages';

const REJECT_TEMPLATES = [
  '권리 확인 불가',
  '메타데이터 부족',
  '음질 문제',
  '중복 업로드',
  'AI 정책 위반 가능성',
  '부적절한 콘텐츠',
  '커버 이미지 문제',
];

const STATUS_LABEL: Record<string, string> = {
  draft: '초안',
  submitted: '검수 대기',
  review_pending: '검수 중',
  changes_requested: '수정 요청',
  approved: '승인됨',
  scheduled: '발매 예정',
  released: '공개됨',
  rejected: '반려됨',
  removed: '제거됨',
};

const STATUS_TONE: Record<string, string> = {
  draft: 'bg-ink/10 text-ink-dim',
  submitted: 'bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-200',
  review_pending: 'bg-sky-100 text-sky-900 dark:bg-sky-500/15 dark:text-sky-200',
  changes_requested: 'bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-200',
  approved: 'bg-sky-100 text-sky-900 dark:bg-sky-500/15 dark:text-sky-200',
  scheduled: 'bg-sky-100 text-sky-900 dark:bg-sky-500/15 dark:text-sky-200',
  released: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-500/15 dark:text-emerald-300',
  rejected: 'bg-red-100 text-red-900 dark:bg-red-500/15 dark:text-red-300',
  removed: 'bg-red-100 text-red-900 dark:bg-red-500/15 dark:text-red-300',
};

interface Props {
  trackId: string;
  trackTitle: string;
  releaseStatus: string | null;
  visibilityStatus: string | null;
  onChanged?: () => void | Promise<void>;
}

export default function TrackModerationPanel({
  trackId,
  trackTitle,
  releaseStatus,
  visibilityStatus,
  onChanged,
}: Props) {
  const [events, setEvents] = useState<TrackModerationEvent[] | null>(null);
  const [emailJobs, setEmailJobs] = useState<TrackModerationEmailJob[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [actionPanel, setActionPanel] = useState<null | 'reject' | 'changes' | 'takedown'>(null);
  const [reasonText, setReasonText] = useState('');

  async function refresh() {
    setLoading(true);
    try {
      const [e, j] = await Promise.all([
        adminListTrackModerationEvents(trackId),
        adminListTrackModerationEmailJobs(trackId),
      ]);
      setEvents(e);
      setEmailJobs(j);
    } catch (err) {
      toast.error(friendlyError(err, '로그 조회 실패'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackId]);

  /** 0076 — immediateRelease: true=즉시 공개 / false=예약 발매 / null=admin_settings 기본값 */
  async function doApprove(immediateRelease: boolean | null) {
    if (busy) return;
    const confirmMsg = immediateRelease === true
      ? '이 트랙을 즉시 공개할까요? (정산 대상 즉시 포함)'
      : immediateRelease === false
        ? '이 트랙을 발매일까지 예약 상태로 유지할까요?'
        : '이 트랙을 승인할까요? (운영 기본 설정에 따름)';
    if (!confirm(confirmMsg + '\n계약/정산 계좌/아티스트 승인 게이트가 재검증됩니다.')) return;
    setBusy(true);
    try {
      const res = await adminApproveArtistRelease(trackId, immediateRelease);
      toast.success(
        res.status === 'released'
          ? '승인 완료 — 즉시 공개됨'
          : `승인 완료 — 발매 예약 (${res.release_date ?? '발매일 미정'})`,
      );
      void (async () => {
        const r = await dispatchTrackModerationEmails(trackId);
        if (r.ok && (r.sent ?? 0) > 0) toast.success(`알림 메일 ${r.sent}건 발송`);
        else if (!r.ok) toast.warning('알림 메일 발송 실패: ' + (r.error ?? '알 수 없음'));
      })();
      await refresh();
      await onChanged?.();
    } catch (e) {
      toast.error(friendlyError(e, '승인 실패'));
    } finally {
      setBusy(false);
    }
  }

  async function doReject() {
    const reason = reasonText.trim();
    if (!reason) {
      toast.error('반려 사유를 입력해주세요');
      return;
    }
    setBusy(true);
    try {
      await adminRejectArtistRelease(trackId, reason);
      toast.success('반려 처리됨');
      void (async () => {
        const r = await dispatchTrackModerationEmails(trackId);
        if (r.ok && (r.sent ?? 0) > 0) toast.success(`알림 메일 ${r.sent}건 발송`);
        else if (!r.ok) toast.warning('알림 메일 발송 실패: ' + (r.error ?? '알 수 없음'));
      })();
      setActionPanel(null);
      setReasonText('');
      await refresh();
      await onChanged?.();
    } catch (e) {
      toast.error(friendlyError(e, '반려 실패'));
    } finally {
      setBusy(false);
    }
  }

  async function doChanges() {
    const reason = reasonText.trim();
    if (!reason) {
      toast.error('수정 요청 사유를 입력해주세요');
      return;
    }
    setBusy(true);
    try {
      await adminRequestTrackChanges(trackId, reason, 'all');
      toast.success('수정 요청 발송됨');
      void (async () => {
        const r = await dispatchTrackModerationEmails(trackId);
        if (r.ok && (r.sent ?? 0) > 0) toast.success(`알림 메일 ${r.sent}건 발송`);
        else if (!r.ok) toast.warning('알림 메일 발송 실패: ' + (r.error ?? '알 수 없음'));
      })();
      setActionPanel(null);
      setReasonText('');
      await refresh();
      await onChanged?.();
    } catch (e) {
      toast.error(friendlyError(e, '수정 요청 실패'));
    } finally {
      setBusy(false);
    }
  }

  async function doTakedown() {
    const reason = reasonText.trim();
    if (reason.length < 5) {
      toast.error('제거 사유를 최소 5자 이상 입력해주세요');
      return;
    }
    if (!confirm('이 트랙을 영구 제거할까요? (스트리밍/정산 모두 차단됩니다)')) return;
    setBusy(true);
    try {
      await adminTakedownTrack(trackId, reason);
      toast.success('트랙 제거됨');
      void (async () => {
        const r = await dispatchTrackModerationEmails(trackId);
        if (r.ok && (r.sent ?? 0) > 0) toast.success(`알림 메일 ${r.sent}건 발송`);
        else if (!r.ok) toast.warning('알림 메일 발송 실패: ' + (r.error ?? '알 수 없음'));
      })();
      setActionPanel(null);
      setReasonText('');
      await refresh();
      await onChanged?.();
    } catch (e) {
      toast.error(friendlyError(e, '제거 실패'));
    } finally {
      setBusy(false);
    }
  }

  async function doRestore() {
    if (busy) return;
    if (!confirm('이 트랙을 draft 로 복원할까요?')) return;
    setBusy(true);
    try {
      await adminRestoreTrack(trackId);
      toast.success('복원 완료 (draft)');
      await refresh();
      await onChanged?.();
    } catch (e) {
      toast.error(friendlyError(e, '복원 실패'));
    } finally {
      setBusy(false);
    }
  }

  async function doHideReleased() {
    if (busy) return;
    if (!confirm('공개된 트랙을 일시 숨김 처리할까요? (정산은 유지)')) return;
    setBusy(true);
    try {
      await adminHideReleasedTrack(trackId, '관리자 일시 숨김');
      toast.success('숨김 처리됨');
      await refresh();
      await onChanged?.();
    } catch (e) {
      toast.error(friendlyError(e, '숨김 실패'));
    } finally {
      setBusy(false);
    }
  }

  async function doUnhide() {
    if (busy) return;
    setBusy(true);
    try {
      await adminUnhideReleasedTrack(trackId);
      toast.success('공개 복원됨');
      await refresh();
      await onChanged?.();
    } catch (e) {
      toast.error(friendlyError(e, '복원 실패'));
    } finally {
      setBusy(false);
    }
  }

  async function doRequeue(onlyFailed: boolean) {
    if (busy) return;
    setBusy(true);
    try {
      const count = await adminRequeueTrackModerationEmails(trackId, onlyFailed);
      if (count === 0) {
        toast.info('재발송할 대상이 없어요');
      } else {
        toast.success(`${count}건 재발송 큐 등록`);
        const r = await dispatchTrackModerationEmails(trackId);
        if (r.ok) toast.success(`발송 — 성공 ${r.sent ?? 0} / 실패 ${r.failed ?? 0}`);
        else toast.warning('일부 실패: ' + (r.error ?? ''));
      }
      await refresh();
    } catch (e) {
      toast.error(friendlyError(e, '재발송 실패'));
    } finally {
      setBusy(false);
    }
  }

  const status = releaseStatus ?? '';
  const canApprove = status === 'submitted' || status === 'review_pending' || status === 'changes_requested';
  const canReject = status === 'submitted' || status === 'review_pending' || status === 'changes_requested';
  const canRequestChanges = status === 'submitted' || status === 'review_pending';
  const canTakedown = ['draft', 'submitted', 'changes_requested', 'approved', 'scheduled', 'released'].includes(status);
  const canRestore = status === 'removed' || status === 'rejected';
  const canHideReleased = status === 'released' && visibilityStatus !== 'hidden';
  const canUnhide = status === 'released' && visibilityStatus === 'hidden';

  return (
    <div className="space-y-3 rounded-2xl bg-bg-soft/40 p-3 ring-1 ring-line/10">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-bold text-ink">{trackTitle}</span>
        <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_TONE[status] ?? 'bg-ink/10 text-ink-dim'}`}>
          {STATUS_LABEL[status] ?? status}
        </span>
        {visibilityStatus === 'hidden' && (
          <span className="inline-flex rounded-full bg-ink/10 px-2 py-0.5 text-[10px] font-semibold text-ink-dim">
            visibility=hidden
          </span>
        )}
      </div>

      {/* 액션 버튼 */}
      <div className="flex flex-wrap gap-1.5">
        {canApprove && (
          <>
            <ActionBtn icon={<CheckCircle2 size={12} />} tone="success" onClick={() => doApprove(true)} disabled={busy}>
              즉시 공개
            </ActionBtn>
            <ActionBtn icon={<CheckCircle2 size={12} />} tone="neutral" onClick={() => doApprove(false)} disabled={busy}>
              예약 발매
            </ActionBtn>
          </>
        )}
        {canRequestChanges && (
          <ActionBtn icon={<MessageSquareWarning size={12} />} tone="warning" onClick={() => { setActionPanel('changes'); setReasonText(''); }} disabled={busy}>
            수정 요청
          </ActionBtn>
        )}
        {canReject && (
          <ActionBtn icon={<XCircle size={12} />} tone="error" onClick={() => { setActionPanel('reject'); setReasonText(''); }} disabled={busy}>
            반려
          </ActionBtn>
        )}
        {canTakedown && (
          <ActionBtn icon={<Trash2 size={12} />} tone="error" onClick={() => { setActionPanel('takedown'); setReasonText(''); }} disabled={busy}>
            제거 (takedown)
          </ActionBtn>
        )}
        {canRestore && (
          <ActionBtn icon={<Undo2 size={12} />} tone="neutral" onClick={doRestore} disabled={busy}>
            복원
          </ActionBtn>
        )}
        {canHideReleased && (
          <ActionBtn icon={<EyeOff size={12} />} tone="warning" onClick={doHideReleased} disabled={busy}>
            일시 숨김
          </ActionBtn>
        )}
        {canUnhide && (
          <ActionBtn icon={<Eye size={12} />} tone="success" onClick={doUnhide} disabled={busy}>
            공개 복원
          </ActionBtn>
        )}
      </div>

      {/* 사유 입력 패널 */}
      {actionPanel && (
        <div className="space-y-2 rounded-xl bg-bg-card p-3 ring-1 ring-accent/40">
          <p className="text-xs font-bold text-ink">
            {actionPanel === 'reject' && '반려 사유'}
            {actionPanel === 'changes' && '수정 요청 사유'}
            {actionPanel === 'takedown' && '제거 사유 (최소 5자)'}
          </p>
          {actionPanel !== 'takedown' && (
            <div className="flex flex-wrap gap-1">
              {REJECT_TEMPLATES.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setReasonText((prev) => (prev ? prev + '\n' + t : t))}
                  className="rounded-full bg-bg-soft px-2 py-0.5 text-[10px] text-ink-mute ring-1 ring-line/10 hover:text-ink"
                >
                  + {t}
                </button>
              ))}
            </div>
          )}
          <textarea
            rows={3}
            value={reasonText}
            onChange={(e) => setReasonText(e.target.value)}
            placeholder="아티스트에게 전달될 메모"
            className="input text-[12px]"
          />
          <div className="flex gap-2">
            <button type="button" onClick={() => { setActionPanel(null); setReasonText(''); }} className="btn-ghost flex-1 py-1.5 text-xs">
              취소
            </button>
            <button
              type="button"
              onClick={() => {
                if (actionPanel === 'reject') void doReject();
                else if (actionPanel === 'changes') void doChanges();
                else if (actionPanel === 'takedown') void doTakedown();
              }}
              disabled={busy}
              className="btn-primary flex-1 py-1.5 text-xs"
            >
              확정
            </button>
          </div>
        </div>
      )}

      {/* 이벤트 로그 */}
      <details className="rounded-lg bg-bg-card px-3 py-2 ring-1 ring-line/10">
        <summary className="cursor-pointer select-none text-[11px] font-semibold text-ink-mute">
          검수 이벤트 로그 ({events?.length ?? 0})
        </summary>
        {loading && <p className="mt-2 text-[11px] text-ink-mute">불러오는 중…</p>}
        {events && events.length === 0 && <p className="mt-2 text-[11px] text-ink-dim">기록 없음</p>}
        {events && events.length > 0 && (
          <ul className="mt-2 space-y-1 text-[10px]">
            {events.map((e) => (
              <li key={e.event_id} className="flex flex-wrap items-baseline gap-1.5 font-mono leading-snug">
                <span className="text-ink-dim">
                  {new Date(e.created_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}
                </span>
                <span className="font-bold text-ink">{e.action}</span>
                <span className="text-ink-mute">
                  {(e.from_release_status ?? '∅')} → {e.to_release_status ?? '∅'}
                </span>
                {e.note && (
                  <p className="basis-full pl-2 text-ink-mute font-sans">사유: {e.note}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </details>

      {/* 이메일 잡 */}
      <details className="rounded-lg bg-bg-card px-3 py-2 ring-1 ring-line/10">
        <summary className="cursor-pointer select-none text-[11px] font-semibold text-ink-mute flex items-center gap-2">
          <Mail size={11} /> 알림 메일 ({emailJobs?.length ?? 0})
          <span className="ml-auto flex gap-1" onClick={(e) => e.preventDefault()}>
            <button
              type="button"
              onClick={() => void doRequeue(true)}
              disabled={busy || !emailJobs?.some((j) => j.status === 'failed')}
              className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 ring-1 ring-amber-400/30 hover:bg-amber-500/25 disabled:opacity-30 dark:text-amber-200"
            >
              실패만
            </button>
            <button
              type="button"
              onClick={() => void doRequeue(false)}
              disabled={busy || !emailJobs?.length}
              className="rounded bg-bg-soft px-1.5 py-0.5 text-[10px] font-semibold ring-1 ring-line/10 hover:bg-bg-hover disabled:opacity-30"
            >
              전체 재발송
            </button>
            <button
              type="button"
              onClick={() => void refresh()}
              disabled={busy}
              aria-label="새로고침"
              className="rounded bg-bg-soft px-1 py-0.5 ring-1 ring-line/10 hover:bg-bg-hover disabled:opacity-30"
            >
              <RefreshCw size={10} />
            </button>
          </span>
        </summary>
        {emailJobs && emailJobs.length === 0 && <p className="mt-2 text-[11px] text-ink-dim">발송 대상 없음</p>}
        {emailJobs && emailJobs.length > 0 && (
          <ul className="mt-2 space-y-1 text-[10px]">
            {emailJobs.map((j) => (
              <li key={j.job_id} className="flex flex-wrap items-baseline gap-1.5 font-mono leading-snug">
                <span
                  className={`inline-flex rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${
                    j.status === 'sent'
                      ? 'bg-emerald-100 text-emerald-900 dark:bg-emerald-500/15 dark:text-emerald-200'
                      : j.status === 'failed'
                        ? 'bg-red-100 text-red-900 dark:bg-red-500/15 dark:text-red-200'
                        : 'bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-200'
                  }`}
                >
                  {j.status}
                </span>
                <span className="text-ink-mute">{j.kind}</span>
                <span className="truncate text-ink">{j.recipient_email}</span>
                <span className="text-ink-dim">attempts={j.attempts}</span>
                {j.last_error && <p className="basis-full text-red-700 dark:text-red-300">{j.last_error}</p>}
              </li>
            ))}
          </ul>
        )}
        {!emailJobs?.length && (
          <Alert tone="info" className="mt-2 text-[11px]">
            RESEND_API_KEY 가 Edge Function runtime 에 미설정이면 발송이 실패하고 last_error 에 기록됩니다.
            상단 계약 관리의 health check 진단 참조.
          </Alert>
        )}
      </details>
    </div>
  );
}

function ActionBtn({
  icon, tone, onClick, disabled, children,
}: {
  icon: React.ReactNode;
  tone: 'success' | 'warning' | 'error' | 'neutral';
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  const toneClass = {
    success: 'bg-emerald-500/15 text-emerald-700 ring-emerald-400/30 hover:bg-emerald-500/25 dark:text-emerald-200',
    warning: 'bg-amber-500/15 text-amber-700 ring-amber-400/30 hover:bg-amber-500/25 dark:text-amber-200',
    error: 'bg-red-500/15 text-red-700 ring-red-400/30 hover:bg-red-500/25 dark:text-red-200',
    neutral: 'bg-bg-card text-ink-mute ring-line/10 hover:bg-bg-hover hover:text-ink',
  }[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-semibold ring-1 disabled:opacity-50 ${toneClass}`}
    >
      {icon}
      {children}
    </button>
  );
}
