/**
 * AudioHealthPanel — 0082 오디오 상태 + 예약 발매 워커 패널
 *
 * 표시:
 * - 상태 카운트 (ok / unreachable / wrong_mime / empty / error / unknown)
 * - 마지막 검사 시각
 * - 문제 트랙 목록
 *
 * 액션:
 * - "오디오 재검사" — check-audio-health Edge Function 호출 (admin Bearer)
 * - "예약 발매 처리" — process-scheduled-releases Edge Function 호출 (admin Bearer)
 *
 * service_role 키는 프론트에 노출되지 않음. Edge Function 내부에서 환경변수로만 사용.
 */

import { useCallback, useEffect, useState } from 'react';
import { Activity, RefreshCw, ShieldCheck, ShieldAlert, ShieldX, FileWarning, HelpCircle, PlayCircle, Clock } from 'lucide-react';
import {
  adminAudioHealthSummary,
  adminAudioHealthIssues,
  runAudioHealthCheck,
  runProcessScheduledReleases,
  type AudioHealthSummary,
  type AudioHealthIssue,
} from '@/lib/artistApi';
import { toast } from '@/store/toastStore';
import Alert from '@/components/Alert';
import { friendlyError } from '@/lib/errorMessages';

function fmtBytes(n: number | null): string {
  if (n === null || n === undefined) return '—';
  if (n === 0) return '0';
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}

function fmtDate(s: string | null | undefined): string {
  if (!s) return '아직 검사 전';
  return new Date(s).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
}

const HEALTH_TONE: Record<string, string> = {
  ok: 'bg-emerald-500/25 text-emerald-200 dark:text-emerald-300 ring-emerald-400/50',
  unknown: 'bg-ink/10 text-ink-mute ring-line/10',
  unreachable: 'bg-rose-500/25 text-rose-200 dark:text-red-300 ring-rose-400/50',
  wrong_mime: 'bg-amber-500/25 text-amber-200 dark:text-amber-300 ring-amber-400/50',
  empty: 'bg-amber-500/25 text-amber-200 dark:text-amber-300 ring-amber-400/50',
  error: 'bg-rose-500/25 text-rose-200 dark:text-red-300 ring-rose-400/50',
};
const HEALTH_LABEL: Record<string, string> = {
  ok: '정상', unknown: '미검사',
  unreachable: '접근불가', wrong_mime: 'MIME 오류',
  empty: '빈 파일', error: '검사 실패',
};

export default function AudioHealthPanel() {
  const [summary, setSummary] = useState<AudioHealthSummary | null>(null);
  const [issues, setIssues] = useState<AudioHealthIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [checkBusy, setCheckBusy] = useState(false);
  const [releasesBusy, setReleasesBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [sum, iss] = await Promise.all([
        adminAudioHealthSummary(),
        adminAudioHealthIssues(100),
      ]);
      setSummary(sum);
      setIssues(iss);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function onRunHealthCheck() {
    if (checkBusy) return;
    setCheckBusy(true);
    try {
      const r = await runAudioHealthCheck({ limit: 50, recheck_after_hours: 24 });
      if (!r.ok) {
        toast.error('헬스체크 실패: ' + (r.error ?? '알 수 없음'));
      } else if ((r.processed ?? 0) === 0) {
        toast.info('재검사 대상이 없어요 (모두 최근 24시간 내 검사됨)');
      } else {
        const s = r.summary ?? {};
        toast.success(
          `헬스체크 완료 — 처리 ${r.processed} · ok ${s.ok ?? 0} · 오류 ${(s.unreachable ?? 0) + (s.error ?? 0) + (s.wrong_mime ?? 0) + (s.empty ?? 0)}`,
        );
      }
      await load();
    } finally {
      setCheckBusy(false);
    }
  }

  async function onRunScheduledReleases() {
    if (releasesBusy) return;
    if (!confirm('예약 발매 시간이 지난 트랙을 일괄 released 로 전환할까요?')) return;
    setReleasesBusy(true);
    try {
      const r = await runProcessScheduledReleases();
      if (!r.ok) {
        toast.error('예약 발매 처리 실패: ' + (r.error ?? '알 수 없음'));
      } else if ((r.processed ?? 0) === 0) {
        toast.info('처리할 예약 발매가 없어요');
      } else {
        toast.success(`예약 발매 — released ${r.released ?? 0} / 실패 ${r.failed ?? 0}`);
      }
      await load();
    } finally {
      setReleasesBusy(false);
    }
  }

  if (error) {
    return (
      <Alert tone="error" title="오디오 상태 조회 실패">
        {error}
        <button onClick={() => void load()} className="mt-2 underline">다시 시도</button>
      </Alert>
    );
  }

  const issueCount = summary
    ? summary.unreachable + summary.wrong_mime + summary.empty + summary.error
    : 0;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-1.5 text-sm font-bold tracking-tight">
            <Activity size={14} className="text-accent" /> 오디오 상태 + 운영 워커
          </h3>
          <p className="text-[10px] text-ink-dim">
            마지막 검사: {fmtDate(summary?.last_check_at)}
          </p>
        </div>
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={onRunScheduledReleases}
            disabled={releasesBusy}
            className="inline-flex items-center gap-1 rounded-lg bg-sky-100 px-3 py-1.5 text-xs font-semibold text-sky-200 ring-1 ring-sky-400/50 hover:bg-sky-200 disabled:opacity-50 dark:bg-sky-500/25 dark:text-sky-200 dark:hover:bg-sky-500/25"
          >
            <PlayCircle size={12} /> {releasesBusy ? '처리 중…' : '예약 발매 처리'}
          </button>
          <button
            type="button"
            onClick={onRunHealthCheck}
            disabled={checkBusy}
            className="inline-flex items-center gap-1 rounded-lg bg-accent/15 px-3 py-1.5 text-xs font-semibold text-accent ring-1 ring-accent/30 hover:bg-accent/25 disabled:opacity-50"
          >
            <RefreshCw size={12} className={checkBusy ? 'animate-spin' : ''} />
            {checkBusy ? '검사 중…' : '오디오 재검사'}
          </button>
        </div>
      </div>

      {/* 상태 카운트 카드 */}
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        <Stat icon={<ShieldCheck size={12} />} label="정상"
          value={summary?.ok ?? 0} tone="ok" />
        <Stat icon={<HelpCircle size={12} />} label="미검사"
          value={summary?.unknown ?? 0} tone="unknown" />
        <Stat icon={<ShieldX size={12} />} label="접근불가"
          value={summary?.unreachable ?? 0} tone="unreachable" />
        <Stat icon={<FileWarning size={12} />} label="MIME 오류"
          value={summary?.wrong_mime ?? 0} tone="wrong_mime" />
        <Stat icon={<FileWarning size={12} />} label="빈 파일"
          value={summary?.empty ?? 0} tone="empty" />
        <Stat icon={<ShieldAlert size={12} />} label="검사 실패"
          value={summary?.error ?? 0} tone="error" />
      </div>

      {/* 문제 트랙 목록 */}
      <div className="overflow-hidden rounded-2xl bg-bg-card ring-1 ring-line/10">
        <div className="border-b border-line/10 px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-ink-dim">
          문제 트랙 ({issueCount})
        </div>
        {loading && (
          <div className="p-6 text-center text-xs text-ink-mute">불러오는 중…</div>
        )}
        {!loading && issues.length === 0 && (
          <div className="p-6 text-center text-xs text-ink-mute">
            현재 오디오 문제가 발견된 트랙이 없습니다. <Clock size={11} className="inline" />{' '}
            정기 재검사가 필요하면 위 버튼을 눌러주세요.
          </div>
        )}
        {!loading && issues.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[800px] text-xs">
              <thead className="border-b border-line/10 text-[10px] uppercase text-ink-dim">
                <tr>
                  <th className="px-3 py-2 text-left">track_code</th>
                  <th className="px-3 py-2 text-left">제목</th>
                  <th className="px-3 py-2 text-left">아티스트</th>
                  <th className="px-3 py-2 text-left">상태</th>
                  <th className="px-3 py-2 text-left">MIME / 크기</th>
                  <th className="px-3 py-2 text-left">오류 메시지</th>
                  <th className="px-3 py-2 text-right">검사 시각</th>
                </tr>
              </thead>
              <tbody>
                {issues.map((it) => (
                  <tr key={it.track_id} className="border-b border-line/10 last:border-b-0 hover:bg-bg-hover">
                    <td className="px-3 py-2 font-mono text-[10px]">{it.track_code ?? '—'}</td>
                    <td className="px-3 py-2 font-medium">{it.title}</td>
                    <td className="px-3 py-2 text-ink-mute">{it.artist ?? '—'}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${HEALTH_TONE[it.audio_health_status] ?? HEALTH_TONE.unknown}`}>
                        {HEALTH_LABEL[it.audio_health_status] ?? it.audio_health_status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-[11px] text-ink-mute">
                      {it.audio_content_type ?? '—'}
                      <span className="ml-1 text-ink-dim">{fmtBytes(it.audio_content_length)}</span>
                    </td>
                    <td className="px-3 py-2 text-[11px] text-rose-200 dark:text-red-300">
                      {it.audio_health_error ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-right text-[10px] text-ink-dim">
                      {it.audio_health_checked_at
                        ? new Date(it.audio_health_checked_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

function Stat({
  icon, label, value, tone,
}: {
  icon: React.ReactNode; label: string; value: number; tone: keyof typeof HEALTH_TONE;
}) {
  return (
    <div className={`rounded-xl p-2.5 ring-1 ${HEALTH_TONE[tone] ?? HEALTH_TONE.unknown}`}>
      <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider opacity-80">
        {icon} {label}
      </div>
      <p className="mt-0.5 text-lg font-extrabold tabular-nums">{value.toLocaleString()}</p>
    </div>
  );
}
